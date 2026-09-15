import { withCorpus } from "./browser-db";
import { addObservation, catalog, compare, mergeBackup, observation, overview, validateBackup } from "./corpus";
import { ingestModels, type NhtsaModel } from "./ingest";

// In-process data interface. These paths never become HTTP requests or require a server.
export async function atlasRequest(path: string, init?: RequestInit): Promise<Response> {
  try {
    const url = new URL(path, "https://motoratlas.invalid");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let data: unknown;
    switch (url.pathname) {
      case "/overview": data = await withCorpus(false, overview); break;
      case "/catalog": data = await withCorpus(false, (c) => catalog(c, url.searchParams.get("q") || "", url.searchParams.get("market") || "", Number(url.searchParams.get("limit")) || 200)); break;
      case "/compare": data = await withCorpus(false, (c) => compare(c, (url.searchParams.get("ids") || "").split(",").filter(Boolean))); break;
      case "/observations": data = await withCorpus(true, (c) => addObservation(c, body)); break;
      case "/ingest/nhtsa": data = await ingest(body); break;
      default:
        if (!url.pathname.startsWith("/vehicle/")) throw new Error("Unknown data operation.");
        data = await withCorpus(false, (c) => ({ observations: c.observations.filter((o) => o.variant_id === url.pathname.slice(9)).map((o) => observation(c, o)) }));
    }
    return Response.json(data);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Operation failed." }, { status: 400 }); }
}

async function ingest(body: { make?: string; year?: number }) {
  const make = String(body.make || "").trim();
  const year = Number(body.year);
  if (!/^[a-zA-Z0-9 .&'-]{2,50}$/.test(make)) throw new Error("Enter a valid manufacturer name.");
  if (!Number.isInteger(year) || year < 1981 || year > new Date().getUTCFullYear() + 1) throw new Error("Enter a valid model year.");
  const runId = crypto.randomUUID();
  await withCorpus(true, (c) => c.ingestion_runs.push({ id: runId, source_id: "nhtsa-vpic", adapter: "models-for-make-year", status: "running",
    scope: `${make} ${year}`, fetched: 0, inserted: 0, updated: 0, rejected: 0, started_at: new Date().toISOString(), finished_at: null, error: null }));
  try {
    const endpoint = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(45000), credentials: "omit" });
    if (!response.ok) throw new Error(`NHTSA returned HTTP ${response.status}. Try again later.`);
    const payload = await response.json() as { Results?: NhtsaModel[] };
    if (!Array.isArray(payload.Results) || !payload.Results.length) throw new Error("NHTSA returned no models for that manufacturer and year.");
    const results = payload.Results;
    const totals = await withCorpus(true, (c) => {
      const totals = ingestModels(c, results, year);
      Object.assign(c.ingestion_runs.find((r) => r.id === runId)!, totals, { status: "completed", fetched: results.length, finished_at: new Date().toISOString() });
      return totals;
    });
    return { runId, make, year, imported: totals.inserted + totals.updated, ...totals };
  } catch (error) {
    await withCorpus(true, (c) => Object.assign(c.ingestion_runs.find((r) => r.id === runId)!, { status: "failed",
      error: error instanceof Error ? error.message : "Import failed", finished_at: new Date().toISOString() }));
    throw error;
  }
}

export async function exportBackup() {
  const tables = await withCorpus(false, (c) => c);
  const blob = new Blob([JSON.stringify({ format: "motoratlas", version: 1, exportedAt: new Date().toISOString(), tables }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `motoratlas-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importBackup(file: File) {
  if (file.size > 50 * 1024 * 1024) throw new Error("Backup exceeds the 50 MB import limit.");
  const incoming = validateBackup(JSON.parse(await file.text()));
  return withCorpus(true, (c) => mergeBackup(c, incoming));
}

const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";

async function vpic<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(`${VPIC}${path}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000), credentials: "omit" });
  if (!response.ok) throw new Error(`NHTSA returned HTTP ${response.status}. Try again later.`);
  const payload = await response.json() as { Results?: T[] };
  if (!Array.isArray(payload.Results)) throw new Error("NHTSA returned an unexpected response.");
  return payload.Results;
}

export type BulkProgress = { done: number; total: number; make: string; inserted: number; updated: number };

// Refreshes every US car manufacturer across a year range without asking the operator to
// name vehicles. One ledger entry covers the run; each manufacturer commits on its own so
// an interrupted run keeps the identities it already resolved.
export async function bulkIngestNhtsa(from: number, to: number, onProgress: (progress: BulkProgress) => void, signal?: AbortSignal) {
  const limit = new Date().getUTCFullYear() + 1;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1981 || to > limit || from > to) throw new Error(`Choose a year range between 1981 and ${limit}.`);
  const makes = (await vpic<{ MakeId: number; MakeName: string }>("/GetMakesForVehicleType/car?format=json", signal))
    .filter((row) => Number.isInteger(row.MakeId) && row.MakeId > 0 && row.MakeName?.trim())
    .map((row) => ({ id: row.MakeId, name: row.MakeName.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!makes.length) throw new Error("NHTSA returned no manufacturers.");
  const years = Array.from({ length: to - from + 1 }, (_, index) => from + index);
  const runId = crypto.randomUUID();
  const totals = { fetched: 0, inserted: 0, updated: 0, rejected: 0 };
  await withCorpus(true, (c) => c.ingestion_runs.push({ id: runId, source_id: "nhtsa-vpic", adapter: "bulk-car-makes", status: "running",
    scope: `All US car makes ${from}-${to}`, fetched: 0, inserted: 0, updated: 0, rejected: 0, started_at: new Date().toISOString(), finished_at: null, error: null }));
  try {
    for (const [position, make] of makes.entries()) {
      signal?.throwIfAborted();
      const batches = await Promise.all(years.map(async (year) => ({ year, results: await vpic<NhtsaModel>(`/GetModelsForMakeIdYear/makeId/${make.id}/modelyear/${year}?format=json`, signal) })));
      const usable = batches.filter((batch) => batch.results.length);
      totals.fetched += usable.reduce((count, batch) => count + batch.results.length, 0);
      if (usable.length) await withCorpus(true, (c) => {
        for (const batch of usable) {
          const result = ingestModels(c, batch.results, batch.year);
          totals.inserted += result.inserted; totals.updated += result.updated; totals.rejected += result.rejected;
        }
        Object.assign(c.ingestion_runs.find((r) => r.id === runId)!, totals);
      });
      onProgress({ done: position + 1, total: makes.length, make: make.name, inserted: totals.inserted, updated: totals.updated });
    }
    await withCorpus(true, (c) => Object.assign(c.ingestion_runs.find((r) => r.id === runId)!, totals, { status: "completed", finished_at: new Date().toISOString() }));
    return totals;
  } catch (error) {
    const aborted = signal?.aborted || (error instanceof Error && error.name === "AbortError");
    await withCorpus(true, (c) => Object.assign(c.ingestion_runs.find((r) => r.id === runId)!, totals, { status: aborted ? "stopped" : "failed",
      error: aborted ? "Stopped by operator" : error instanceof Error ? error.message : "Bulk import failed", finished_at: new Date().toISOString() }));
    if (aborted) return totals;
    throw error;
  }
}
