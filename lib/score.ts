import type { Corpus, Row } from "./browser-db";

// A spec score ranks only what evidence supports. Each criterion names the attribute keys
// that satisfy it, the direction that is better, and the weight it carries. Nothing is
// imputed: a criterion without an observation contributes no score and lowers coverage.
export type Criterion = { key: string; label: string; attributes: string[]; higherIsBetter: boolean; weight: number };

export const CRITERIA: Criterion[] = [
  { key: "safety", label: "Safety", attributes: ["safety_rating", "ncap_overall_stars", "euro_ncap_stars"], higherIsBetter: true, weight: 25 },
  { key: "efficiency", label: "Efficiency", attributes: ["fuel_consumption_l_100km", "combined_l_100km"], higherIsBetter: false, weight: 20 },
  { key: "emissions", label: "Emissions", attributes: ["co2_g_km", "co2_tailpipe_g_km"], higherIsBetter: false, weight: 15 },
  { key: "power", label: "Power", attributes: ["power_kw", "power_ps"], higherIsBetter: true, weight: 15 },
  { key: "range", label: "Usable range", attributes: ["range_km", "electric_range_km"], higherIsBetter: true, weight: 10 },
  { key: "torque", label: "Torque", attributes: ["torque_nm"], higherIsBetter: true, weight: 10 },
  { key: "occupant_protection", label: "Occupant protection", attributes: ["airbags"], higherIsBetter: true, weight: 5 },
];

const TOTAL_WEIGHT = CRITERIA.reduce((sum, criterion) => sum + criterion.weight, 0);
export type SpecScore = { score: number | null; coverage: number; criteria: Array<{ key: string; label: string; value: number; sourceId: string; normalised: number }> };

// The best-supported observation wins a criterion: lowest source authority rank, then
// highest confidence, then a stable id. This mirrors how comparison picks a value.
function preferred(rows: Row[], authority: Map<string, number>) {
  return [...rows].sort((a, b) => (authority.get(String(a.source_id)) ?? 999) - (authority.get(String(b.source_id)) ?? 999)
    || Number(b.confidence) - Number(a.confidence) || a.id.localeCompare(b.id))[0];
}

// Scores are relative to the corpus: a criterion is normalised against the observed range
// for that criterion, so a score says "better than the field", never "good in absolute terms".
export function specScores(c: Corpus): Map<string, SpecScore> {
  const authority = new Map(c.sources.map((source) => [source.id, Number(source.authority_rank)]));
  const attributeOf = new Map<string, Criterion>();
  for (const criterion of CRITERIA) for (const attribute of criterion.attributes) attributeOf.set(attribute, criterion);

  const collected = new Map<string, Map<string, Row[]>>();
  const spread = new Map<string, { min: number; max: number }>();
  for (const row of c.observations) {
    const criterion = attributeOf.get(String(row.attribute_key));
    if (!criterion || row.value_number == null) continue;
    const value = Number(row.value_number);
    if (!Number.isFinite(value)) continue;
    const perVariant = collected.get(String(row.variant_id)) || new Map<string, Row[]>();
    perVariant.set(criterion.key, [...(perVariant.get(criterion.key) || []), row]);
    collected.set(String(row.variant_id), perVariant);
    const range = spread.get(criterion.key);
    spread.set(criterion.key, { min: Math.min(range?.min ?? value, value), max: Math.max(range?.max ?? value, value) });
  }

  const scores = new Map<string, SpecScore>();
  for (const [variantId, perVariant] of collected) {
    let weighted = 0, covered = 0;
    const criteria: SpecScore["criteria"] = [];
    for (const criterion of CRITERIA) {
      const rows = perVariant.get(criterion.key);
      if (!rows?.length) continue;
      const row = preferred(rows, authority);
      const value = Number(row.value_number);
      const range = spread.get(criterion.key)!;
      // A criterion observed on a single vehicle cannot rank it against a field of one.
      const normalised = range.max === range.min ? 0.5 : (value - range.min) / (range.max - range.min);
      const oriented = criterion.higherIsBetter ? normalised : 1 - normalised;
      weighted += oriented * criterion.weight;
      covered += criterion.weight;
      criteria.push({ key: criterion.key, label: criterion.label, value, sourceId: String(row.source_id), normalised: Math.round(oriented * 100) });
    }
    scores.set(variantId, covered ? { score: Math.round((weighted / covered) * 100), coverage: Math.round((covered / TOTAL_WEIGHT) * 100), criteria } : { score: null, coverage: 0, criteria });
  }
  return scores;
}
