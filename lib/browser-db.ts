import { SOURCE_CATALOG } from "./source-catalog";

export const TABLES = ["sources", "makes", "models", "generations", "variants", "observations", "source_crosswalks", "ingestion_runs", "conflicts"] as const;
export type Table = typeof TABLES[number];
export type Row = { id: string; [key: string]: string | number | null };
export type Corpus = Record<Table, Row[]>;
export const emptyCorpus = (): Corpus => ({ sources: [], makes: [], models: [], generations: [], variants: [], observations: [], source_crosswalks: [], ingestion_runs: [], conflicts: [] });
let connection: Promise<IDBDatabase> | undefined;

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

// Read and mutate within one IndexedDB transaction, including across browser tabs.
// A rejected callback aborts every write; callers see success only after commit.
export async function withCorpus<T>(write: boolean, callback: (corpus: Corpus) => T): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction([...TABLES], write ? "readwrite" : "readonly");
    const corpus = emptyCorpus();
    let pending = TABLES.length;
    let result: T;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error("Could not save data. Check available browser storage."));
    tx.onerror = () => { failure ??= tx.error; };
    for (const name of TABLES) {
      const request = tx.objectStore(name).getAll();
      request.onsuccess = () => {
        corpus[name] = request.result;
        if (--pending !== 0) return;
        try {
          result = callback(corpus);
          if (write) for (const table of TABLES) for (const row of corpus[table]) tx.objectStore(table).put(row);
        } catch (error) { failure = error; tx.abort(); }
      };
    }
  });
}
