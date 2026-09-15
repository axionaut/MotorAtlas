import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { emptyCorpus } from "../lib/browser-db";
import { validateBackup } from "../lib/corpus";
import { SEEDS, applySeed, seedApplied } from "../lib/seed";
import { SOURCE_CATALOG } from "../lib/source-catalog";

const read = async (file: string) => JSON.parse(await readFile(new URL(`../public/${file}`, import.meta.url), "utf8"));

test("the bundled catalogue loads a multi-market corpus once and stays idempotent", async () => {
  const c = emptyCorpus();
  for (const source of SOURCE_CATALOG) c.sources.push({ id: source.id, name: source.name, authority_rank: source.authorityRank,
    coverage_tags: JSON.stringify(source.coverageTags), homepage_url: source.homepageUrl });

  const payloads = [];
  for (const seed of SEEDS) {
    const payload = await read(seed.file);
    payloads.push(payload);
    assert.equal(seedApplied(c, seed, payload), false);
    applySeed(c, seed, payload);
    assert.equal(seedApplied(c, seed, payload), true);
  }

  const markets = new Set(c.variants.map((v) => v.market));
  assert.ok(markets.size >= 10, `expected a multi-market corpus, got ${[...markets].join(",")}`);
  assert.ok(markets.has("US") && markets.has("DE") && markets.has("GB"));
  assert.ok(c.variants.length > 20000, `expected a seeded catalogue, got ${c.variants.length} variants`);
  assert.ok(c.makes.length > 300 && c.models.length > 5000);
  assert.ok(c.variants.some((v) => v.market === "US" && v.model_year !== null));
  assert.ok(c.variants.some((v) => v.market !== "US" && v.model_year === null));
  validateBackup({ format: "motoratlas", version: 1, tables: c });

  const identities = c.variants.length, models = c.models.length;
  for (const [position, seed] of SEEDS.entries()) applySeed(c, seed, payloads[position]);
  assert.equal(c.variants.length, identities);
  assert.equal(c.models.length, models);
});
