import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { emptyCorpus, withCorpus, type Corpus } from "../lib/browser-db";
import { addObservation, compare, mergeBackup, validateBackup } from "../lib/corpus";
import { ingestMarketModels, ingestModels } from "../lib/ingest";
import { atlasRequest } from "../lib/browser-api";

const models = [{ Make_ID: 448, Make_Name: "Toyota", Model_ID: 2208, Model_Name: "Corolla" }, { Make_ID: 448, Make_Name: "Toyota", Model_ID: 2209, Model_Name: "Camry" }];
function fixture(): Corpus {
  const c = emptyCorpus();
  c.sources.push({ id: "nhtsa-vpic", name: "NHTSA", authority_rank: 1, coverage_tags: "[]", homepage_url: "https://vpic.nhtsa.dot.gov/" },
    { id: "oem", name: "OEM", authority_rank: 2, coverage_tags: "[]", homepage_url: "https://example.com/" },
    { id: "vehiclesdb", name: "VehiclesDB", authority_rank: 4, coverage_tags: "[]", homepage_url: "https://vehiclesdb.com/" });
  ingestModels(c, models, 2026);
  return c;
}
const evidence = (c: Corpus, value: string, sourceId = "oem", confidence = 90) => ({ variantId: c.variants[0].id, attributeKey: "power_kw", value, unit: "kW", sourceId, method: "documented", confidence });

test("repeat imports preserve identities and evidence; another model-year stays distinct", () => {
  const c = fixture(); const original = structuredClone(c.variants);
  addObservation(c, evidence(c, "100"));
  assert.deepEqual(ingestModels(c, models, 2026), { inserted: 0, updated: 2, rejected: 0 });
  assert.equal(c.variants.length, 2); assert.equal(c.observations.length, 1);
  assert.equal(c.variants[0].id, original[0].id);
  assert.equal(c.variants[0].completeness, 4);
  ingestModels(c, models, 2025); assert.equal(c.variants.length, 4);
  assert.equal(c.models.length, 2); assert.equal(c.makes.length, 1);
  assert.equal(c.source_crosswalks.filter((r) => r.entity_type === "variant").length, 4);
});

test("conflicting observations preserve provenance and display by authority then confidence", () => {
  const c = fixture(); addObservation(c, evidence(c, "100", "oem", 99));
  const added = addObservation(c, evidence(c, "101", "nhtsa-vpic", 70));
  addObservation(c, evidence(c, "102", "nhtsa-vpic", 90));
  assert.equal(added.conflictCreated, true); assert.equal(c.observations.length, 3);
  assert.equal(c.conflicts.length, 3);
  for (const row of c.observations) { assert.ok(row.retrieved_at); assert.ok(row.raw_value); assert.equal(row.market, "US"); assert.equal(row.method, "documented"); }
  const result = compare(c, c.variants.map((v) => v.id));
  assert.equal(result.attributes[0].values[0]?.valueNumber, 102);
  assert.equal(result.attributes[0].values[1], null);
});

test("backup round trip is additive and does not replace facts", () => {
  const c = fixture(); addObservation(c, evidence(c, "100"));
  const backup = validateBackup(JSON.parse(JSON.stringify({ format: "motoratlas", version: 1, tables: c })));
  const restored = emptyCorpus(); assert.ok(mergeBackup(restored, backup) > 0);
  assert.deepEqual(restored, c); assert.equal(mergeBackup(restored, backup), 0);
  const changed = structuredClone(backup); changed.observations[0].raw_value = "999";
  assert.throws(() => mergeBackup(restored, changed), /overlaps changed/);
  assert.equal(restored.observations[0].raw_value, "100");
  const broken = structuredClone(backup); broken.observations[0].source_id = "missing";
  assert.throws(() => validateBackup({ format: "motoratlas", version: 1, tables: broken }), /Broken backup reference/);
});

test("invalid evidence is rejected before mutation", () => {
  const c = fixture();
  assert.throws(() => addObservation(c, { ...evidence(c, "100"), sourceUrl: "javascript:alert(1)" }), /https or http/);
  assert.throws(() => addObservation(c, { ...evidence(c, "100"), confidence: NaN }), /Confidence/);
  assert.equal(c.observations.length, 0);
});

test("IndexedDB writes persist, failed transactions roll back, and concurrent writes survive", async () => {
  await Promise.all([1, 2].map((n) => withCorpus(true, (c) => c.makes.push({ id: `test-${n}`, name: `Test ${n}` }))));
  assert.equal(await withCorpus(false, (c) => c.makes.length), 2);
  await assert.rejects(withCorpus(true, (c) => { c.makes.push({ id: "discard", name: "Discard" }); throw new Error("cancel"); }), /cancel/);
  assert.equal(await withCorpus(false, (c) => c.makes.some((r) => r.id === "discard")), false);
});

test("browser ingestion records success, repeat counts, and failed network runs", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ Results: models });
    const call = () => atlasRequest("/ingest/nhtsa", { method: "POST", body: JSON.stringify({ make: "Toyota", year: 2026 }) });
    assert.equal((await (await call()).json()).inserted, 2);
    const repeat = await (await call()).json(); assert.equal(repeat.inserted, 0); assert.equal(repeat.updated, 2);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal((await call()).status, 400);
    const runs = await withCorpus(false, (c) => c.ingestion_runs);
    assert.deepEqual(runs.map((r) => r.status).sort(), ["completed", "completed", "failed"]);
    assert.equal(runs.find((r) => r.status === "failed")?.error, "offline");
  } finally { globalThis.fetch = original; }
});

const marketModels = [{ mk: "Toyota", ms: "toyota", md: "Corolla", ds: "corolla", body: "sedan", markets: ["DE", "GB", "US"] },
  { mk: "Škoda", ms: "skoda", md: "Octavia", ds: "octavia", body: "liftback", markets: ["DE", "NL"] }];

test("global market presence reuses identities and never duplicates a covered market", () => {
  const c = fixture(); // NHTSA has already created US 2026 identities for Corolla and Camry.
  const first = ingestMarketModels(c, marketModels);
  assert.equal(first.inserted, 4); // DE + GB for Corolla, DE + NL for Octavia; US already covered.
  assert.equal(c.makes.length, 2); // Toyota is matched by name, Škoda is new.
  assert.equal(c.models.length, 3);
  assert.equal(c.variants.filter((v) => v.market === "US").length, 2);
  assert.deepEqual(ingestMarketModels(c, marketModels), { inserted: 0, updated: 5, rejected: 0 });
  assert.equal(c.variants.length, 6);
  const corolla = c.models.find((m) => m.name === "Corolla")!;
  assert.equal(c.source_crosswalks.filter((x) => x.entity_id === corolla.id).length, 2); // one per source
  assert.ok(c.variants.some((v) => v.market === "DE" && v.model_year === null && v.body_style === "sedan"));
  validateBackup({ format: "motoratlas", version: 1, tables: c });
});

test("a later dated pull enriches a market already present without erasing it", () => {
  const c = fixture();
  ingestMarketModels(c, marketModels);
  const before = c.variants.length;
  ingestModels(c, [{ Make_ID: 448, Make_Name: "Toyota", Model_ID: 2208, Model_Name: "Corolla" }], 2024);
  assert.equal(c.variants.length, before + 1);
  assert.equal(c.variants.filter((v) => v.market === "DE").length, 2);
});
