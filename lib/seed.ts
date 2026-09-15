import { withCorpus, type Corpus } from "./browser-db";
import { identityIndex, ingestMarketModels, ingestModels, type MarketModel, type NhtsaModel } from "./ingest";

export type SeedDescriptor = { id: string; file: string; sourceId: string; adapter: string; label: string };

// Year-bearing national identities load first so global market presence stays year-open
// only where no dated identity already covers that market.
export const SEEDS: SeedDescriptor[] = [
  { id: "nhtsa-car-identities", file: "seed/nhtsa-car-identities.json", sourceId: "nhtsa-vpic", adapter: "seed-model-years", label: "US model-year identities" },
  { id: "vehiclesdb-markets", file: "seed/vehiclesdb-markets.json", sourceId: "vehiclesdb", adapter: "seed-market-presence", label: "Global market presence" },
];

type SeedPayload = { format?: string; version?: number; source?: string; generatedAt?: string; years?: [number, number]; records?: unknown[] };
const marker = (seed: SeedDescriptor, payload: SeedPayload) => `seed:${seed.id}@${payload.generatedAt || "unknown"}`;

function validate(seed: SeedDescriptor, payload: SeedPayload) {
  if (payload?.format !== "motoratlas-seed" || payload.version !== 1 || payload.source !== seed.sourceId || !Array.isArray(payload.records) || !payload.records.length)
    throw new Error(`The bundled ${seed.label.toLowerCase()} file is not a valid MotorAtlas seed.`);
  return payload;
}

// Applies one seed inside the caller's transaction. Identity resolution is idempotent,
// so re-applying a seed updates crosswalks instead of duplicating vehicles.
export function applySeed(c: Corpus, seed: SeedDescriptor, payload: SeedPayload) {
  validate(seed, payload);
  const index = identityIndex(c);
  const totals = { inserted: 0, updated: 0, rejected: 0 };
  const add = (result: { inserted: number; updated: number; rejected: number }) => {
    totals.inserted += result.inserted; totals.updated += result.updated; totals.rejected += result.rejected;
  };
  if (seed.adapter === "seed-model-years") {
    const byYear = new Map<number, NhtsaModel[]>();
    for (const record of payload.records as Array<{ y: number; mi: number; mn: string; di: number; dn: string }>) {
      if (!Number.isInteger(record?.y)) { totals.rejected++; continue; }
      const group = byYear.get(record.y) || [];
      group.push({ Make_ID: record.mi, Make_Name: record.mn, Model_ID: record.di, Model_Name: record.dn });
      byYear.set(record.y, group);
    }
    for (const [year, group] of [...byYear].sort((a, b) => a[0] - b[0])) add(ingestModels(c, group, year, index));
  } else {
    add(ingestMarketModels(c, payload.records as MarketModel[], seed.sourceId, index));
  }
  c.ingestion_runs.push({ id: crypto.randomUUID(), source_id: seed.sourceId, adapter: seed.adapter, status: "completed",
    scope: marker(seed, payload), fetched: payload.records!.length, inserted: totals.inserted, updated: totals.updated,
    rejected: totals.rejected, started_at: new Date().toISOString(), finished_at: new Date().toISOString(), error: null });
  return totals;
}

const seedUrl = (file: string) => {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/";
  return `${base}${file}`;
};

export const seedApplied = (c: Corpus, seed: SeedDescriptor, payload: SeedPayload) =>
  c.ingestion_runs.some((run) => run.scope === marker(seed, payload) && run.status === "completed");

// Loads every bundled seed that this browser has not stored yet. Network failure is not
// fatal: the app still opens with whatever identities the browser already holds.
export async function loadSeeds(report?: (message: string) => void) {
  let applied = 0;
  for (const seed of SEEDS) {
    let payload: SeedPayload;
    try {
      const response = await fetch(seedUrl(seed.file), { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = validate(seed, await response.json() as SeedPayload);
    } catch { continue; }
    if (await withCorpus(false, (c) => seedApplied(c, seed, payload))) continue;
    report?.(`Loading ${seed.label.toLowerCase()}…`);
    applied += await withCorpus(true, (c) => {
      if (seedApplied(c, seed, payload)) return 0;
      const totals = applySeed(c, seed, payload);
      return totals.inserted;
    });
  }
  return applied;
}
