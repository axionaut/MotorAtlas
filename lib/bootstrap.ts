import { getRawDb } from "@/db";
import { SOURCE_CATALOG } from "@/lib/source-catalog";

export async function ensureSourceCatalog() {
  const db = getRawDb();
  const now = new Date().toISOString();
  const statements = SOURCE_CATALOG.map((source) => db.prepare(`
    INSERT INTO sources (
      id, name, source_type, geography, license, reuse_status, access_mode,
      authority_rank, coverage_tags, homepage_url, adapter_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, source_type=excluded.source_type, geography=excluded.geography,
      license=excluded.license, reuse_status=excluded.reuse_status, access_mode=excluded.access_mode,
      authority_rank=excluded.authority_rank, coverage_tags=excluded.coverage_tags,
      homepage_url=excluded.homepage_url, adapter_status=excluded.adapter_status
  `).bind(
    source.id, source.name, source.sourceType, source.geography, source.license,
    source.reuseStatus, source.accessMode, source.authorityRank,
    JSON.stringify(source.coverageTags), source.homepageUrl, source.adapterStatus, now
  ));
  await db.batch(statements);
}

export function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
