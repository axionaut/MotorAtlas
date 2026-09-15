import { getRawDb } from "@/db";
import { ensureSourceCatalog, slug } from "@/lib/bootstrap";
import { errorMessage, json } from "@/lib/http";

type NhtsaModel = { Make_ID: number; Make_Name: string; Model_ID: number; Model_Name: string };

export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  let make = "";
  let year = 0;
  try {
    const body = await request.json() as { make?: string; year?: number };
    make = String(body.make || "").trim();
    year = Number(body.year);
    const maximumYear = new Date().getUTCFullYear() + 1;
    if (!/^[a-zA-Z0-9 .&'-]{2,50}$/.test(make)) throw new Error("Enter a valid manufacturer name.");
    if (!Number.isInteger(year) || year < 1981 || year > maximumYear) throw new Error(`Year must be between 1981 and ${maximumYear}.`);

    await ensureSourceCatalog();
    const db = getRawDb();
    await db.prepare(`INSERT INTO ingestion_runs
      (id, source_id, adapter, status, scope, fetched, inserted, updated, rejected, started_at)
      VALUES (?, 'nhtsa-vpic', 'models-for-make-year', 'running', ?, 0, 0, 0, 0, ?)`)
      .bind(runId, `${make} ${year}`, startedAt).run();

    const endpoint = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`;
    const response = await fetch(endpoint, { headers: { Accept: "application/json", "User-Agent": "MotorAtlas/1.0" } });
    if (!response.ok) throw new Error(`NHTSA returned HTTP ${response.status}.`);
    const payload = await response.json() as { Results?: NhtsaModel[] };
    const results = Array.isArray(payload.Results) ? payload.Results : [];
    if (!results.length) throw new Error("NHTSA returned no models for that manufacturer and year.");

    const canonicalMake = results[0]?.Make_Name?.trim() || make;
    const makeId = `make-${results[0]?.Make_ID || slug(canonicalMake)}`;
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      db.prepare(`INSERT INTO makes (id, name, country_code, created_at) VALUES (?, ?, NULL, ?)
        ON CONFLICT(name) DO UPDATE SET name=excluded.name`).bind(makeId, canonicalMake, now),
    ];

    for (const item of results) {
      const modelName = String(item.Model_Name || "").trim();
      if (!modelName) continue;
      const modelId = `model-nhtsa-${item.Model_ID}`;
      const variantId = `variant-us-${year}-${item.Model_ID}`;
      const crosswalkId = `xw-nhtsa-model-${item.Model_ID}`;
      statements.push(
        db.prepare(`INSERT INTO models (id, make_id, name, vehicle_type, created_at)
          VALUES (?, ?, ?, 'passenger_car', ?)
          ON CONFLICT(id) DO UPDATE SET make_id=excluded.make_id, name=excluded.name`)
          .bind(modelId, makeId, modelName, now),
        db.prepare(`INSERT INTO variants
          (id, model_id, generation_id, market, model_year, trim, body_style, powertrain,
           transmission, drive_type, canonical_name, completeness, review_status, created_at, updated_at)
          VALUES (?, ?, NULL, 'US', ?, NULL, NULL, NULL, NULL, NULL, ?, 5, 'identity_only', ?, ?)
          ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name, updated_at=excluded.updated_at`)
          .bind(variantId, modelId, year, `${year} ${canonicalMake} ${modelName} · US`, now, now),
        db.prepare(`INSERT INTO source_crosswalks
          (id, source_id, entity_type, entity_id, external_id, market, created_at)
          VALUES (?, 'nhtsa-vpic', 'model', ?, ?, 'US', ?)
          ON CONFLICT(source_id, entity_type, external_id) DO UPDATE SET entity_id=excluded.entity_id`)
          .bind(crosswalkId, modelId, String(item.Model_ID), now),
      );
    }

    for (let index = 0; index < statements.length; index += 75) {
      await db.batch(statements.slice(index, index + 75));
    }

    await db.prepare(`UPDATE ingestion_runs SET status='completed', fetched=?, inserted=?, finished_at=? WHERE id=?`)
      .bind(results.length, results.length, new Date().toISOString(), runId).run();
    return json({ runId, make: canonicalMake, year, imported: results.length });
  } catch (error) {
    try {
      const db = getRawDb();
      await db.prepare(`UPDATE ingestion_runs SET status='failed', error=?, finished_at=? WHERE id=?`)
        .bind(errorMessage(error), new Date().toISOString(), runId).run();
    } catch { /* The run may not exist if validation failed. */ }
    return json({ error: errorMessage(error), make, year }, { status: 400 });
  }
}
