// Generates the bundled global market-presence seed from VehiclesDB (CC BY 4.0).
// Run: pnpm run seed  (network required)
import { mkdir, writeFile } from "node:fs/promises";

const RELEASE = process.env.VEHICLESDB_RELEASE || "v2026.09.1";
const SOURCE = `https://github.com/vehiclesdb/vehiclesdb/releases/download/${RELEASE}/vehicles.json`;
const OUT = new URL("../public/seed/vehiclesdb-markets.json", import.meta.url);

const response = await fetch(SOURCE, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error(`VehiclesDB returned HTTP ${response.status}`);
const payload = await response.json();
if (!Array.isArray(payload.makes)) throw new Error("Malformed VehiclesDB payload");

const records = [];
for (const make of payload.makes) {
  for (const model of make.models || []) {
    if (model.kind !== "car" || !make.slug || !model.slug || !make.name?.trim() || !model.name?.trim()) continue;
    const markets = [...new Set((model.availability || []).map((code) => String(code).trim().toUpperCase()))].filter((code) => /^[A-Z]{2}$/.test(code)).sort();
    if (!markets.length) continue;
    records.push({ mk: make.name.trim(), ms: make.slug, md: model.name.trim(), ds: model.slug, body: model.body_type || null, markets });
  }
}
records.sort((a, b) => a.ms.localeCompare(b.ms) || a.ds.localeCompare(b.ds));

await mkdir(new URL("./", OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({
  format: "motoratlas-seed", version: 1, source: "vehiclesdb", release: payload.version || RELEASE,
  license: payload.license || "CC-BY-4.0", attribution: payload.attribution?.text || "Vehicle data by VehiclesDB",
  attributionUrl: payload.attribution?.url || "https://vehiclesdb.com",
  generatedAt: new Date().toISOString(), records,
}));
console.error(`wrote ${records.length} models · ${records.reduce((n, r) => n + r.markets.length, 0)} market identities`);
