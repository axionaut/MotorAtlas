import { getRawDb } from "@/db";
import { ensureSourceCatalog } from "@/lib/bootstrap";
import { errorMessage, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSourceCatalog();
    const db = getRawDb();
    const [counts, sourceRows, runRows, coverageRows] = await Promise.all([
      db.prepare(`SELECT
        (SELECT COUNT(*) FROM makes) AS makes,
        (SELECT COUNT(*) FROM models) AS models,
        (SELECT COUNT(*) FROM variants) AS variants,
        (SELECT COUNT(*) FROM observations) AS observations,
        (SELECT COUNT(*) FROM conflicts WHERE status = 'open') AS conflicts,
        (SELECT COUNT(DISTINCT market) FROM variants) AS markets`).first(),
      db.prepare(`SELECT id, name, source_type AS sourceType, geography, license,
        reuse_status AS reuseStatus, access_mode AS accessMode, authority_rank AS authorityRank,
        coverage_tags AS coverageTags, homepage_url AS homepageUrl, adapter_status AS adapterStatus
        FROM sources ORDER BY authority_rank, name`).all(),
      db.prepare(`SELECT r.id, s.name AS sourceName, r.adapter, r.status, r.scope,
        r.fetched, r.inserted, r.updated, r.rejected, r.started_at AS startedAt, r.finished_at AS finishedAt
        FROM ingestion_runs r JOIN sources s ON s.id = r.source_id
        ORDER BY r.started_at DESC LIMIT 8`).all(),
      db.prepare(`SELECT attribute_key AS attributeKey, COUNT(*) AS observations,
        COUNT(DISTINCT variant_id) AS vehicles, COUNT(DISTINCT source_id) AS sources
        FROM observations GROUP BY attribute_key ORDER BY vehicles DESC, attribute_key LIMIT 20`).all(),
    ]);

    const sources = sourceRows.results.map((row: Record<string, unknown>) => ({
      ...row,
      coverageTags: JSON.parse(String(row.coverageTags || "[]")),
    }));

    return json({ counts, sources, runs: runRows.results, coverage: coverageRows.results });
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: 500 });
  }
}
