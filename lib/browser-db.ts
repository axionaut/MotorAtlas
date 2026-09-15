import { SOURCE_CATALOG } from "./source-catalog";

export const TABLES = ["sources", "makes", "models", "generations", "variants", "observations", "source_crosswalks", "ingestion_runs", "conflicts"] as const;
export type Table = typeof TABLES[number];
export type Row = { id: string; [key: string]: string | number | null };
export type Corpus = Record<Table, Row[]>;
export const emptyCorpus = (): Corpus => ({ sources: [], makes: [], models: [], generations: [], variants: [], observations: [], source_crosswalks: [], ingestion_runs: [], conflicts: [] });
let connection: Promise<IDBDatabase> | undefined;

// A seeded corpus is tens of thousands of rows, so reads serve a cached snapshot instead
// of re-reading every store per request. Writes replace it and tell other tabs to drop
// theirs. Read callbacks must not mutate their corpus; only write callbacks may.
let cache: Corpus | undefined;
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("motoratlas-corpus");
if (channel) { channel.onmessage = () => { cache = undefined; }; (channel as unknown as { unref?: () => void }).unref?.(); }

function openDb() {
  if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("motoratlas-corpus", 1);
    request.onupgradeneeded = () => {
      for (const name of TABLES) request.result.createObjectStore(name, { keyPath: "id" });
      const sources = request.transaction!.objectStore("sources");
      for (const source of SOURCE_CATALOG) sources.add({
        id: source.id, name: source.name, source_type: source.sourceType, geography: source.geography,
        license: source.license, reuse_status: source.reuseStatus, access_mode: source.accessMode,
        authority_rank: source.authorityRank, coverage_tags: JSON.stringify(source.coverageTags),
        homepage_url: source.homepageUrl, adapter_status: source.adapterStatus, created_at: new Date().toISOString(),
      });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { connection = undefined; reject(new Error("Browser storage is unavailable. Allow site storage and reload.")); };
    request.onblocked = () => { connection = undefined; reject(new Error("Close other MotorAtlas tabs, then reload to update storage.")); };
  });
  return connection;
}

// Only rows the callback added or changed are written back. A seeded corpus holds tens of
// thousands of identities; rewriting every row on every save would stall the UI.
const snapshot = (corpus: Corpus) => {
  const rows = new Map<string, string>();
  for (const name of TABLES) for (const row of corpus[name]) rows.set(name + "|" + row.id, JSON.stringify(row));
  return rows;
};
function persist(tx: IDBTransaction, corpus: Corpus, before: Map<string, string>) {
  for (const name of TABLES) {
    const store = tx.objectStore(name);
    for (const row of corpus[name]) {
      const key = name + "|" + row.id;
      const current = JSON.stringify(row);
      if (before.get(key) !== current) store.put(row);
    }
  }
}

// Read and mutate within one IndexedDB transaction, including across browser tabs.
// A rejected callback aborts every write; callers see success only after commit.
export async function withCorpus<T>(write: boolean, callback: (corpus: Corpus) => T): Promise<T> {
  if (!write && cache) return callback(cache);
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction([...TABLES], write ? "readwrite" : "readonly");
    const corpus = emptyCorpus();
    let pending = TABLES.length;
    let result: T;
    let failure: unknown;
    tx.oncomplete = () => { cache = corpus; if (write) channel?.postMessage("changed"); resolve(result); };
    tx.onabort = () => { cache = undefined; reject(failure || tx.error || new Error("Could not save data. Check available browser storage.")); };
    tx.onerror = () => { failure ??= tx.error; };
    for (const name of TABLES) {
      const request = tx.objectStore(name).getAll();
      request.onsuccess = () => {
        corpus[name] = request.result;
        if (--pending !== 0) return;
        try {
          const before = write ? snapshot(corpus) : null;
          result = callback(corpus);
          if (before) persist(tx, corpus, before);
        } catch (error) { failure = error; tx.abort(); }
      };
    }
  });
}
