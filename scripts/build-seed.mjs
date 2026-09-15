// Generates the bundled NHTSA identity seed shipped in public/seed/.
// Run: pnpm run seed  (network required; NHTSA vPIC is public and CORS-enabled)
import { mkdir, writeFile } from "node:fs/promises";

const API = "https://vpic.nhtsa.dot.gov/api/vehicles";
const FROM = Number(process.env.SEED_FROM || 2015);
const TO = Number(process.env.SEED_TO || 2026);
const CONCURRENCY = Number(process.env.SEED_CONCURRENCY || 6);
const OUT = new URL("../public/seed/nhtsa-car-identities.json", import.meta.url);

async function json(path, attempt = 0) {
  try {
    const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.Results)) throw new Error("Malformed NHTSA payload");
    return payload.Results;
  } catch (error) {
    if (attempt >= 4) throw new Error(`${path}: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** attempt));
    return json(path, attempt + 1);
  }
}

// Bounded worker pool; NHTSA throttles aggressive clients.
async function pool(items, worker) {
  const queue = [...items.entries()];
  const results = [];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) results[job[0]] = await worker(job[1], job[0]);
  }));
  return results;
}

const makes = (await json("/GetMakesForVehicleType/car?format=json"))
  .filter((row) => Number.isInteger(row.MakeId) && row.MakeId > 0 && row.MakeName?.trim())
  .map((row) => ({ id: row.MakeId, name: row.MakeName.trim() }))
  .sort((a, b) => a.id - b.id);
console.error(`${makes.length} car makes · years ${FROM}-${TO}`);

const years = Array.from({ length: TO - FROM + 1 }, (_, index) => FROM + index);
const jobs = makes.flatMap((make) => years.map((year) => ({ make, year })));
let done = 0;
const batches = await pool(jobs, async ({ make, year }) => {
  const rows = await json(`/GetModelsForMakeIdYear/makeId/${make.id}/modelyear/${year}?format=json`);
  if (++done % 100 === 0) console.error(`  ${done}/${jobs.length} make-years`);
  return rows.filter((row) => Number.isInteger(row.Model_ID) && row.Model_ID > 0 && row.Model_Name?.trim() && row.Make_Name?.trim())
    .map((row) => ({ y: year, mi: row.Make_ID, mn: row.Make_Name.trim(), di: row.Model_ID, dn: row.Model_Name.trim() }));
});

const seen = new Set();
const records = batches.flat().filter((row) => {
  const key = `${row.di}:${row.y}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}).sort((a, b) => a.y - b.y || a.mi - b.mi || a.di - b.di);

await mkdir(new URL("./", OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({
  format: "motoratlas-seed", version: 1, source: "nhtsa-vpic", market: "US",
  years: [FROM, TO], generatedAt: new Date().toISOString(),
  makes: makes.length, records,
}));
console.error(`wrote ${records.length} identities to ${OUT.pathname}`);
