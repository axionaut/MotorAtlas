import { getRawDb } from "@/db";
import { errorMessage, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ids = (new URL(request.url).searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 4);
    if (!ids.length) return json({ vehicles: [], attributes: [] });
    const db = getRawDb();
    const placeholders = ids.map(() => "?").join(",");
    const vehicles = await db.prepare(`SELECT v.id, v.canonical_name AS canonicalName, v.market,
      v.model_year AS modelYear, v.trim, v.body_style AS bodyStyle, v.powertrain,
      v.transmission, v.drive_type AS driveType, v.completeness
      FROM variants v WHERE v.id IN (${placeholders})`).bind(...ids).all();
    const observations = await db.prepare(`SELECT o.variant_id AS variantId, o.attribute_key AS attributeKey,
      o.value_text AS valueText, o.value_number AS valueNumber, o.unit,
      s.name AS sourceName, s.authority_rank AS authorityRank, o.confidence
      FROM observations o JOIN sources s ON s.id=o.source_id
      WHERE o.variant_id IN (${placeholders})
      ORDER BY o.attribute_key, s.authority_rank, o.confidence DESC`).bind(...ids).all();

    const best = new Map<string, Record<string, unknown>>();
    for (const row of observations.results as Record<string, unknown>[]) {
      const key = `${row.variantId}:${row.attributeKey}`;
      if (!best.has(key)) best.set(key, row);
    }
    const attributeKeys = [...new Set((observations.results as Record<string, unknown>[]).map((row) => String(row.attributeKey)))].sort();
    const attributes = attributeKeys.map((attributeKey) => ({
      attributeKey,
      values: ids.map((variantId) => best.get(`${variantId}:${attributeKey}`) || null),
    }));
    const orderedVehicles = ids.map((id) => (vehicles.results as Record<string, unknown>[]).find((row) => row.id === id)).filter(Boolean);
    return json({ vehicles: orderedVehicles, attributes });
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: 500 });
  }
}
