import type { Corpus, Row } from "./browser-db";

const id = () => crypto.randomUUID();
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

// Identity resolution runs over indexes, not linear scans: a bundled seed carries
// tens of thousands of identities and every lookup happens inside one transaction.
type IdentityIndex = {
  crosswalks: Map<string, string>;
  rows: { make: Map<string, Row>; model: Map<string, Row>; variant: Map<string, Row> };
  makesByName: Map<string, Row>;
  modelsByName: Map<string, Row>;
  variantsByKey: Map<string, Row>;
  marketPresence: Set<string>;
};

export function identityIndex(c: Corpus): IdentityIndex {
  const index: IdentityIndex = {
    crosswalks: new Map(), rows: { make: new Map(), model: new Map(), variant: new Map() },
    makesByName: new Map(), modelsByName: new Map(), variantsByKey: new Map(), marketPresence: new Set(),
  };
  for (const xw of c.source_crosswalks) index.crosswalks.set(`${xw.source_id}|${xw.entity_type}|${xw.external_id}`, String(xw.entity_id));
  for (const make of c.makes) { index.rows.make.set(make.id, make); index.makesByName.set(slug(String(make.name)), make); }
  for (const model of c.models) { index.rows.model.set(model.id, model); index.modelsByName.set(`${model.make_id}|${slug(String(model.name))}`, model); }
  for (const variant of c.variants) {
    index.rows.variant.set(variant.id, variant);
    index.variantsByKey.set(`${variant.model_id}|${variant.market}|${variant.model_year ?? ""}`, variant);
    index.marketPresence.add(`${variant.model_id}|${variant.market}`);
  }
  return index;
}

// A crosswalk records "this source calls our identity X by that external key".
// Identities are shared across sources; the external key never becomes the identity.
function link(c: Corpus, index: IdentityIndex, entity: "make" | "model" | "variant", sourceId: string, external: string, row: Row, market: string, timestamp: string) {
  const key = `${sourceId}|${entity}|${external}`;
  if (index.crosswalks.has(key)) return;
  index.crosswalks.set(key, row.id);
  c.source_crosswalks.push({ id: id(), source_id: sourceId, entity_type: entity, entity_id: row.id, external_id: external, market, created_at: timestamp });
}

function resolve(c: Corpus, index: IdentityIndex, entity: "make" | "model" | "variant", sourceId: string, external: string,
  natural: Map<string, Row> | null, naturalKey: string, create: () => Row, rows: Row[], market: string, timestamp: string) {
  const existingId = index.crosswalks.get(`${sourceId}|${entity}|${external}`);
  if (existingId) {
    const existing = index.rows[entity].get(existingId);
    if (!existing) throw new Error("Source crosswalk references a missing identity.");
    return { row: existing, created: false };
  }
  const matched = natural?.get(naturalKey);
  const row = matched ?? create();
  if (!matched) { rows.push(row); index.rows[entity].set(row.id, row); natural?.set(naturalKey, row); }
  link(c, index, entity, sourceId, external, row, market, timestamp);
  return { row, created: !matched };
}

export type NhtsaModel = { Make_ID: number; Make_Name: string; Model_ID: number; Model_Name: string };

// NHTSA vPIC: United States model-year identities.
export function ingestModels(c: Corpus, results: NhtsaModel[], year: number, index = identityIndex(c)) {
  let inserted = 0, updated = 0, rejected = 0;
  const seen = new Set<number>();
  const timestamp = new Date().toISOString();
  for (const item of results) {
    if (!Number.isInteger(item.Make_ID) || item.Make_ID <= 0 || !Number.isInteger(item.Model_ID) || item.Model_ID <= 0
      || !item.Make_Name?.trim() || !item.Model_Name?.trim() || seen.has(item.Model_ID)) { rejected++; continue; }
    seen.add(item.Model_ID);
    const makeName = item.Make_Name.trim(), modelName = item.Model_Name.trim();
    const make = resolve(c, index, "make", "nhtsa-vpic", String(item.Make_ID), index.makesByName, slug(makeName),
      () => ({ id: id(), name: makeName, country_code: null, created_at: timestamp }), c.makes, "US", timestamp).row;
    const model = resolve(c, index, "model", "nhtsa-vpic", String(item.Model_ID), index.modelsByName, `${make.id}|${slug(modelName)}`,
      () => ({ id: id(), make_id: make.id, name: modelName, vehicle_type: null, created_at: timestamp }), c.models, "US", timestamp).row;
    const variant = resolve(c, index, "variant", "nhtsa-vpic", `${item.Model_ID}:US:${year}`, index.variantsByKey, `${model.id}|US|${year}`,
      () => ({ id: id(), model_id: model.id, generation_id: null, market: "US", model_year: year,
        trim: null, body_style: null, powertrain: null, transmission: null, drive_type: null,
        canonical_name: `${year} ${make.name} ${model.name} · US`, completeness: 5, review_status: "identity_only",
        created_at: timestamp, updated_at: timestamp }), c.variants, "US", timestamp);
    index.marketPresence.add(`${model.id}|US`);
    if (variant.created) inserted++; else updated++;
  }
  if (!inserted && !updated) throw new Error("NHTSA returned no valid vehicle identities.");
  return { inserted, updated, rejected };
}

export type MarketModel = { mk: string; ms: string; md: string; ds: string; body: string | null; markets: string[] };

// VehiclesDB: which models are sold in which markets. Model years are unknown here,
// so these identities stay year-open and defer to year-bearing sources per market.
export function ingestMarketModels(c: Corpus, records: MarketModel[], sourceId = "vehiclesdb", index = identityIndex(c)) {
  let inserted = 0, updated = 0, rejected = 0;
  const timestamp = new Date().toISOString();
  for (const item of records) {
    const makeName = String(item.mk || "").trim(), modelName = String(item.md || "").trim();
    const markets = Array.isArray(item.markets) ? item.markets.filter((market) => /^[A-Z]{2}$/.test(market)) : [];
    if (!makeName || !modelName || !item.ms || !item.ds || !markets.length) { rejected++; continue; }
    const make = resolve(c, index, "make", sourceId, item.ms, index.makesByName, slug(makeName),
      () => ({ id: id(), name: makeName, country_code: null, created_at: timestamp }), c.makes, "", timestamp).row;
    const model = resolve(c, index, "model", sourceId, `${item.ms}:${item.ds}`, index.modelsByName, `${make.id}|${slug(modelName)}`,
      () => ({ id: id(), make_id: make.id, name: modelName, vehicle_type: "car", created_at: timestamp }), c.models, "", timestamp).row;
    for (const market of markets) {
      // A market already covered by year-specific identities needs no year-open duplicate.
      if (!index.variantsByKey.has(`${model.id}|${market}|`) && index.marketPresence.has(`${model.id}|${market}`)) { updated++; continue; }
      const variant = resolve(c, index, "variant", sourceId, `${item.ms}:${item.ds}:${market}`, index.variantsByKey, `${model.id}|${market}|`,
        () => ({ id: id(), model_id: model.id, generation_id: null, market, model_year: null,
          trim: null, body_style: item.body || null, powertrain: null, transmission: null, drive_type: null,
          canonical_name: `${make.name} ${model.name} · ${market}`, completeness: 3, review_status: "identity_only",
          created_at: timestamp, updated_at: timestamp }), c.variants, market, timestamp);
      index.marketPresence.add(`${model.id}|${market}`);
      if (variant.created) inserted++; else updated++;
    }
  }
  if (!inserted && !updated) throw new Error("The market catalogue contained no valid vehicle identities.");
  return { inserted, updated, rejected };
}

export type DatedMarketModel = { make: string; model: string; year: number; market: string; body?: string | null; externalId: string };

// A safety agency names a make, a model and a test year in one market. That is a dated
// market identity, resolved against whatever identities other sources already created.
export function ingestDatedMarketModels(c: Corpus, records: DatedMarketModel[], sourceId: string, index = identityIndex(c)) {
  let inserted = 0, updated = 0, rejected = 0;
  const timestamp = new Date().toISOString();
  for (const item of records) {
    const makeName = String(item.make || "").trim(), modelName = String(item.model || "").trim();
    const market = String(item.market || "").trim().toUpperCase();
    const year = Number(item.year);
    if (!makeName || !modelName || !/^[A-Z]{2}$/.test(market) || !Number.isInteger(year) || year < 1981 || !item.externalId) { rejected++; continue; }
    const make = resolve(c, index, "make", sourceId, `make:${makeName}`, index.makesByName, slug(makeName),
      () => ({ id: id(), name: makeName, country_code: null, created_at: timestamp }), c.makes, market, timestamp).row;
    const model = resolve(c, index, "model", sourceId, `model:${makeName}:${modelName}`, index.modelsByName, `${make.id}|${slug(modelName)}`,
      () => ({ id: id(), make_id: make.id, name: modelName, vehicle_type: "car", created_at: timestamp }), c.models, market, timestamp).row;
    const variant = resolve(c, index, "variant", sourceId, item.externalId, index.variantsByKey, `${model.id}|${market}|${year}`,
      () => ({ id: id(), model_id: model.id, generation_id: null, market, model_year: year,
        trim: null, body_style: item.body || null, powertrain: null, transmission: null, drive_type: null,
        canonical_name: `${year} ${make.name} ${model.name} · ${market}`, completeness: 5, review_status: "identity_only",
        created_at: timestamp, updated_at: timestamp }), c.variants, market, timestamp);
    index.marketPresence.add(`${model.id}|${market}`);
    if (variant.created) inserted++; else updated++;
  }
  if (!inserted && !updated) throw new Error("The assessment set contained no valid vehicle identities.");
  return { inserted, updated, rejected };
}

// Resolves the identity a source's external key already points at, for attaching evidence.
export function variantFor(index: IdentityIndex, sourceId: string, externalId: string) {
  const entityId = index.crosswalks.get(`${sourceId}|variant|${externalId}`);
  return entityId ? index.rows.variant.get(entityId) : undefined;
}
