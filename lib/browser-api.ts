import { withCorpus } from "./browser-db";
import { addObservation, catalog, compare, ingestModels, mergeBackup, observation, overview, validateBackup, type NhtsaModel } from "./corpus";

// In-process data interface. These paths never become HTTP requests or require a server.
export async function atlasRequest(path: string, init?: RequestInit): Promise<Response> {
  try {
    const url = new URL(path, "https://motoratlas.invalid");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let data: unknown;
    switch (url.pathname) {
      case "/overview": data = await withCorpus(false, overview); break;
      case "/catalog": data = await withCorpus(false, (c) => catalog(c, url.searchParams.get("q") || "", url.searchParams.get("market") || "")); break;
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
