import { getRawDb } from "@/db";
import { errorMessage, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const db = getRawDb();
    const vehicle = await db.prepare(`SELECT v.*, mk.name AS make, m.name AS model
      FROM variants v JOIN models m ON m.id=v.model_id JOIN makes mk ON mk.id=m.make_id
      WHERE v.id=?`).bind(id).first();
    if (!vehicle) return json({ error: "Vehicle not found" }, { status: 404 });

    const observations = await db.prepare(`SELECT o.id, o.attribute_key AS attributeKey,
      o.value_text AS valueText, o.value_number AS valueNumber, o.unit, o.market,
      o.method, o.confidence, o.source_url AS sourceUrl, o.retrieved_at AS retrievedAt,
      s.name AS sourceName, s.authority_rank AS authorityRank
      FROM observations o JOIN sources s ON s.id=o.source_id
      WHERE o.variant_id=? ORDER BY o.attribute_key, s.authority_rank, o.confidence DESC`).bind(id).all();
    return json({ vehicle, observations: observations.results });
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: 500 });
  }
}
