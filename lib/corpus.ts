import { type Corpus, type Row, TABLES } from "./browser-db";
import { specScores, type SpecScore } from "./score";

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const find = (rows: Row[], key: string) => rows.find((row) => row.id === key);
const unique = <T,>(values: T[]): T[] => [...new Set(values)];
const camel = (row: Row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()), value]));
export function sources(c: Corpus) {
  return c.sources.map((row) => ({ ...camel(row), coverageTags: JSON.parse(String(row.coverage_tags)) }));
}
export function vehicle(c: Corpus, row: Row, score?: SpecScore) {
  const model = find(c.models, String(row.model_id));
  const evidence = c.observations.filter((o) => o.variant_id === row.id);
  return { ...camel(row), make: model ? find(c.makes, String(model.make_id))?.name : null, model: model?.name,
    observationCount: evidence.length, sourceCount: unique(evidence.map((o) => o.source_id)).length,
    specScore: score?.score ?? null, scoreCoverage: score?.coverage ?? 0, scoreCriteria: score?.criteria ?? [],
    scoreClusters: score?.clusters ?? [] };
}
export function observation(c: Corpus, row: Row) {
  const source = find(c.sources, String(row.source_id));
  return { ...camel(row), sourceName: source?.name, authorityRank: source?.authority_rank };
}
export function overview(c: Corpus) {
  return {
    counts: { makes: c.makes.length, models: c.models.length, variants: c.variants.length,
      observations: c.observations.length, conflicts: c.conflicts.filter((r) => r.status === "open").length,
      markets: unique(c.variants.map((v) => v.market)).length },
    sources: sources(c),
    runs: [...c.ingestion_runs].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))).slice(0, 8)
      .map((r) => ({ ...camel(r), sourceName: find(c.sources, String(r.source_id))?.name })),
    coverage: unique(c.observations.map((o) => o.attribute_key)).map((key) => {
      const rows = c.observations.filter((o) => o.attribute_key === key);
      return { attributeKey: key, observations: rows.length, vehicles: unique(rows.map((o) => o.variant_id)).length,
        sources: unique(rows.map((o) => o.source_id)).length };
    }).sort((a, b) => b.vehicles - a.vehicles),
  };
}
// The catalogue holds tens of thousands of seeded identities; the response is a page,
// and the total count keeps the unlisted remainder visible instead of silently truncated.
export function catalog(c: Corpus, query = "", market = "", limit = 200) {
  const q = query.trim().toLowerCase();
  const scores = specScores(c);
  const presence = new Map<string, number>();
  for (const v of c.variants) presence.set(String(v.model_id), (presence.get(String(v.model_id)) || 0) + 1);
  const rank = (v: Row) => scores.get(v.id)?.score ?? -1;
  const matched = c.variants.filter((v) => (!market || v.market === market) && String(v.canonical_name).toLowerCase().includes(q))
    .sort((a, b) => rank(b) - rank(a)
      || Number(scores.get(b.id)?.coverage ?? 0) - Number(scores.get(a.id)?.coverage ?? 0)
      || (presence.get(String(b.model_id)) || 0) - (presence.get(String(a.model_id)) || 0)
      || Number(b.model_year ?? 0) - Number(a.model_year ?? 0)
      || String(a.canonical_name).localeCompare(String(b.canonical_name)));
  return { vehicles: matched.slice(0, Math.max(1, Math.min(500, limit))).map((v) => vehicle(c, v, scores.get(v.id))),
    total: matched.length, scored: [...scores.values()].filter((s) => s.score !== null).length,
    markets: unique(c.variants.map((v) => v.market)).sort() };
}
export function compare(c: Corpus, ids: string[]) {
  const scores = specScores(c);
  const rows = unique(ids).slice(0, 4).map((key) => find(c.variants, key)).filter((r): r is Row => !!r);
  const evidence = c.observations.filter((o) => rows.some((v) => v.id === o.variant_id));
  evidence.sort((a, b) => Number(find(c.sources, String(a.source_id))?.authority_rank ?? 999) - Number(find(c.sources, String(b.source_id))?.authority_rank ?? 999)
    || Number(b.confidence) - Number(a.confidence) || a.id.localeCompare(b.id));
  return { vehicles: rows.map((v) => vehicle(c, v, scores.get(v.id))), attributes: unique(evidence.map((o) => String(o.attribute_key))).sort().map((key) => ({
    attributeKey: key, values: rows.map((v) => { const o = evidence.find((item) => item.variant_id === v.id && item.attribute_key === key); return o ? observation(c, o) : null; }),
  })) };
}

export function addObservation(c: Corpus, body: Record<string, unknown>) {
  const variant = find(c.variants, String(body.variantId));
  const source = find(c.sources, String(body.sourceId));
  const attribute = String(body.attributeKey || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const raw = String(body.value ?? "").trim();
  const unit = String(body.unit || "").trim() || null;
  const confidence = Number(body.confidence);
  const method = String(body.method || "documented");
  const sourceUrl = String(body.sourceUrl || "").trim() || null;
  if (!variant || !source || !raw) throw new Error("Vehicle, source and value are required.");
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(attribute)) throw new Error("Use an attribute name such as torque_nm or airbags.");
  if (!Number.isFinite(confidence) || confidence < 1 || confidence > 100) throw new Error("Confidence must be between 1 and 100.");
  if (!["documented", "claimed", "regulatory", "measured", "owner_reported", "derived"].includes(method)) throw new Error("Choose an evidence method.");
  if (sourceUrl && !["https:", "http:"].includes(new URL(sourceUrl).protocol)) throw new Error("Source URL must use https or http.");
  const number = Number(raw.replace(/,/g, ""));
  const numeric = Number.isFinite(number) && /^-?[\d,.]+$/.test(raw);
  const row: Row = { id: id(), variant_id: variant.id, attribute_key: attribute, value_text: numeric ? null : raw, value_number: numeric ? number : null,
    unit, source_id: source.id, source_url: sourceUrl, market: variant.market, method, effective_from: null, effective_to: null,
    retrieved_at: now(), confidence, raw_value: raw, checksum: null };
  const peers = c.observations.filter((o) => o.variant_id === variant.id && o.attribute_key === attribute);
  c.observations.push(row);
  let conflictCreated = false;
  for (const peer of peers) if (String(peer.value_number ?? peer.value_text) !== String(row.value_number ?? row.value_text) || peer.unit !== row.unit) {
    c.conflicts.push({ id: id(), variant_id: variant.id, attribute_key: attribute, observation_a_id: peer.id, observation_b_id: row.id,
      status: "open", resolution_note: null, created_at: now(), resolved_at: null });
    conflictCreated = true;
  }
  const attributes = unique(c.observations.filter((o) => o.variant_id === variant.id).map((o) => o.attribute_key)).length;
  variant.completeness = Math.min(100, attributes * 4);
  variant.review_status = attributes >= 10 ? "profiled" : "enriching";
  variant.updated_at = now();
  return { observationId: row.id, conflictCreated };
}

export function validateBackup(input: unknown): Corpus {
  const backup = input as { format?: string; version?: number; tables?: Corpus };
  if (backup?.format !== "motoratlas" || backup.version !== 1 || !backup.tables) throw new Error("Choose a MotorAtlas v1 backup.");
  const c = backup.tables;
  for (const table of TABLES) {
    if (!Array.isArray(c[table])) throw new Error(`Backup is missing ${table}.`);
    const ids = new Set<string>();
    for (const row of c[table]) {
      if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id) || Object.values(row).some((v) => v !== null && typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v)))) throw new Error(`Invalid or duplicate record in ${table}.`);
      ids.add(row.id);
    }
  }
  const requireText = (rows: Row[], fields: string[]) => { for (const row of rows) for (const field of fields) if (typeof row[field] !== "string" || !row[field]) throw new Error(`Backup record is missing ${field}.`); };
  requireText(c.sources, ["name", "coverage_tags", "homepage_url"]);
  requireText(c.makes, ["name"]); requireText(c.models, ["name", "make_id"]);
  requireText(c.variants, ["model_id", "market", "canonical_name", "review_status"]);
  requireText(c.observations, ["variant_id", "source_id", "attribute_key", "market", "method", "retrieved_at", "raw_value"]);
  requireText(c.source_crosswalks, ["source_id", "entity_type", "entity_id", "external_id"]);
  requireText(c.ingestion_runs, ["source_id", "status", "started_at"]);
  requireText(c.conflicts, ["variant_id", "attribute_key", "observation_a_id", "observation_b_id", "status"]);
  for (const s of c.sources) {
    if (!Number.isFinite(s.authority_rank) || !Array.isArray(JSON.parse(String(s.coverage_tags)))) throw new Error("Invalid source metadata.");
    if (!["https:", "http:"].includes(new URL(String(s.homepage_url)).protocol)) throw new Error("Invalid source URL.");
  }
  for (const o of c.observations) {
    if (!Number.isFinite(o.confidence) || Number(o.confidence) < 1 || Number(o.confidence) > 100 || (o.value_number == null && typeof o.value_text !== "string")) throw new Error("Invalid evidence value or confidence.");
    if (o.source_url && !["https:", "http:"].includes(new URL(String(o.source_url)).protocol)) throw new Error("Invalid evidence URL.");
  }
  // Reference checks run over id sets: a seeded corpus holds tens of thousands of rows
  // and linear scans per reference would stall the import.
  const keys = new Map<Row[], Set<string>>();
  const idsOf = (rows: Row[]) => { let set = keys.get(rows); if (!set) { set = new Set(rows.map((row) => row.id)); keys.set(rows, set); } return set; };
  const refs = (rows: Row[], key: string, targets: Row[], optional = false) => {
    const ids = idsOf(targets);
    for (const row of rows) if (!(optional && row[key] == null) && !ids.has(String(row[key]))) throw new Error(`Broken backup reference: ${key}.`);
  };
  refs(c.models, "make_id", c.makes); refs(c.generations, "model_id", c.models);
  refs(c.variants, "model_id", c.models); refs(c.variants, "generation_id", c.generations, true);
  refs(c.observations, "variant_id", c.variants); refs(c.observations, "source_id", c.sources);
  refs(c.ingestion_runs, "source_id", c.sources); refs(c.conflicts, "variant_id", c.variants);
  refs(c.conflicts, "observation_a_id", c.observations); refs(c.conflicts, "observation_b_id", c.observations);
  refs(c.source_crosswalks, "source_id", c.sources);
  const links = new Set<string>();
  for (const xw of c.source_crosswalks) {
    const target = ({ make: c.makes, model: c.models, generation: c.generations, variant: c.variants } as Record<string, Row[]>)[String(xw.entity_type)];
    const key = JSON.stringify([xw.source_id, xw.entity_type, xw.external_id]);
    if (!target || !idsOf(target).has(String(xw.entity_id)) || links.has(key)) throw new Error("Invalid or duplicate source crosswalk.");
    links.add(key);
  }
  return c;
}

// Merge is additive. A colliding record aborts the entire import rather than
// silently replacing evidence, identities, or provenance already on this device.
export function mergeBackup(c: Corpus, incoming: Corpus) {
  const signature = (row: Row) => JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
  let added = 0;
  for (const table of TABLES) {
    const stored = new Map(c[table].map((row) => [row.id, row]));
    for (const row of incoming[table]) {
      const existing = stored.get(row.id);
      if (existing) {
        if (table === "sources") continue; // Installed source authority stays authoritative.
        if (signature(existing) !== signature(row)) throw new Error("Backup overlaps changed records. Restore it in a separate browser to keep both versions.");
      } else { c[table].push(row); stored.set(row.id, row); added++; }
    }
  }
  validateBackup({ format: "motoratlas", version: 1, tables: c });
  return added;
}
