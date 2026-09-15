import { getRawDb } from "@/db";
import { errorMessage, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getRawDb();
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "").trim();
    const market = (url.searchParams.get("market") || "").trim();
    const params: unknown[] = [];
    const where: string[] = [];

    if (query) {
      where.push("(v.canonical_name LIKE ? OR mk.name LIKE ? OR m.name LIKE ?)");
      const like = `%${query}%`;
      params.push(like, like, like);
    }
    if (market) {
      where.push("v.market = ?");
      params.push(market);
    }

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const result = await db.prepare(`SELECT
      v.id, v.canonical_name AS canonicalName, mk.name AS make, m.name AS model,
      v.market, v.model_year AS modelYear, v.trim, v.body_style AS bodyStyle,
      v.powertrain, v.transmission, v.drive_type AS driveType,
      v.completeness, v.review_status AS reviewStatus,
      COUNT(o.id) AS observationCount, COUNT(DISTINCT o.source_id) AS sourceCount
      FROM variants v
      JOIN models m ON m.id = v.model_id
      JOIN makes mk ON mk.id = m.make_id
      LEFT JOIN observations o ON o.variant_id = v.id
      ${clause}
      GROUP BY v.id
      ORDER BY v.model_year DESC, mk.name, m.name
      LIMIT 200`).bind(...params).all();

    const markets = await db.prepare("SELECT DISTINCT market FROM variants ORDER BY market").all();
    return json({ vehicles: result.results, markets: markets.results.map((row: Record<string, unknown>) => row.market) });
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: 500 });
  }
}
