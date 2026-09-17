import type { Corpus, Row } from "./browser-db";

// A spec score ranks only what evidence supports. Criteria are organized into 4
// consumer-facing clusters (Performance, Energy, Safety, Utility), each with clear
// weights and attribute keys. Nothing is imputed: a criterion without an observation
// contributes no score and lowers coverage.
export type CriterionCluster = "performance" | "energy" | "safety" | "utility";

export const CLUSTERS: Record<CriterionCluster, { label: string; description: string }> = {
  safety: { label: "Safety & Protection", description: "Crash test assessments, occupant protection and airbags" },
  performance: { label: "Performance & Dynamics", description: "Power, torque, acceleration and top speed" },
  energy: { label: "Range & Efficiency", description: "Electric range, fuel/energy efficiency and emissions" },
  utility: { label: "Dimensions & Utility", description: "Cargo volume, boot space and practical utility" },
};

export type Criterion = {
  key: string;
  cluster: CriterionCluster;
  label: string;
  attributes: string[];
  higherIsBetter: boolean;
  weight: number;
};

export const CRITERIA: Criterion[] = [
  // Safety & Protection (30%)
  { key: "safety", cluster: "safety", label: "Safety assessment", attributes: ["safety_rating", "ncap_overall_stars", "euro_ncap_stars"], higherIsBetter: true, weight: 20 },
  { key: "occupant_protection", cluster: "safety", label: "Occupant protection", attributes: ["child_occupant_score", "occupant_protection_percent", "airbags"], higherIsBetter: true, weight: 10 },

  // Performance & Dynamics (35%)
  { key: "power", cluster: "performance", label: "Power", attributes: ["power_kw", "power_ps", "power_hp"], higherIsBetter: true, weight: 15 },
  { key: "torque", cluster: "performance", label: "Torque", attributes: ["torque_nm"], higherIsBetter: true, weight: 10 },
  { key: "acceleration", cluster: "performance", label: "Acceleration (0-100)", attributes: ["acceleration_0_100_s", "zero_to_sixty_mph_s"], higherIsBetter: false, weight: 5 },
  { key: "top_speed", cluster: "performance", label: "Top speed", attributes: ["top_speed_kmh", "top_speed_mph"], higherIsBetter: true, weight: 5 },

  // Range & Efficiency (30%)
  { key: "range", cluster: "energy", label: "Usable range", attributes: ["range_km", "electric_range_km", "range_miles"], higherIsBetter: true, weight: 15 },
  { key: "efficiency", cluster: "energy", label: "Efficiency", attributes: ["fuel_consumption_l_100km", "combined_l_100km", "consumption_kwh_100km"], higherIsBetter: false, weight: 10 },
  { key: "emissions", cluster: "energy", label: "Emissions", attributes: ["co2_g_km", "co2_tailpipe_g_km"], higherIsBetter: false, weight: 5 },

  // Dimensions & Utility (5%)
  { key: "cargo", cluster: "utility", label: "Cargo capacity", attributes: ["cargo_volume_l", "boot_space_l", "cargo_volume_cu_ft"], higherIsBetter: true, weight: 5 },
];

export const TOTAL_WEIGHT = CRITERIA.reduce((sum, criterion) => sum + criterion.weight, 0);

export const CLUSTER_WEIGHTS: Record<CriterionCluster, number> = {
  safety: CRITERIA.filter((c) => c.cluster === "safety").reduce((s, c) => s + c.weight, 0),
  performance: CRITERIA.filter((c) => c.cluster === "performance").reduce((s, c) => s + c.weight, 0),
  energy: CRITERIA.filter((c) => c.cluster === "energy").reduce((s, c) => s + c.weight, 0),
  utility: CRITERIA.filter((c) => c.cluster === "utility").reduce((s, c) => s + c.weight, 0),
};

export type ClusterScore = {
  cluster: CriterionCluster;
  label: string;
  score: number | null;
  coverage: number;
};

export type SpecScore = {
  score: number | null;
  coverage: number;
  clusters: ClusterScore[];
  criteria: Array<{
    key: string;
    cluster: CriterionCluster;
    label: string;
    value: number;
    sourceId: string;
    normalised: number;
  }>;
};

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

  const clusterOrder: CriterionCluster[] = ["safety", "performance", "energy", "utility"];
  const scores = new Map<string, SpecScore>();

  for (const [variantId, perVariant] of collected) {
    let totalWeighted = 0, totalCovered = 0;
    const criteria: SpecScore["criteria"] = [];
    const clusterBuckets: Record<CriterionCluster, { weighted: number; covered: number }> = {
      safety: { weighted: 0, covered: 0 },
      performance: { weighted: 0, covered: 0 },
      energy: { weighted: 0, covered: 0 },
      utility: { weighted: 0, covered: 0 },
    };

    for (const criterion of CRITERIA) {
      const rows = perVariant.get(criterion.key);
      if (!rows?.length) continue;
      const row = preferred(rows, authority);
      const value = Number(row.value_number);
      const range = spread.get(criterion.key)!;
      // A criterion observed on a single vehicle cannot rank it against a field of one.
      const normalised = range.max === range.min ? 0.5 : (value - range.min) / (range.max - range.min);
      const oriented = criterion.higherIsBetter ? normalised : 1 - normalised;
      const criterionWeighted = oriented * criterion.weight;

      totalWeighted += criterionWeighted;
      totalCovered += criterion.weight;

      clusterBuckets[criterion.cluster].weighted += criterionWeighted;
      clusterBuckets[criterion.cluster].covered += criterion.weight;

      criteria.push({
        key: criterion.key,
        cluster: criterion.cluster,
        label: criterion.label,
        value,
        sourceId: String(row.source_id),
        normalised: Math.round(oriented * 100),
      });
    }

    const clusters: ClusterScore[] = clusterOrder.map((cl) => {
      const b = clusterBuckets[cl];
      const maxWeight = CLUSTER_WEIGHTS[cl];
      return {
        cluster: cl,
        label: CLUSTERS[cl].label,
        score: b.covered ? Math.round((b.weighted / b.covered) * 100) : null,
        coverage: maxWeight ? Math.round((b.covered / maxWeight) * 100) : 0,
      };
    });

    scores.set(
      variantId,
      totalCovered
        ? {
            score: Math.round((totalWeighted / totalCovered) * 100),
            coverage: Math.round((totalCovered / TOTAL_WEIGHT) * 100),
            clusters,
            criteria,
          }
        : { score: null, coverage: 0, clusters, criteria }
    );
  }
  return scores;
}
