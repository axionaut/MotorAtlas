import { getRawDb } from "@/db";
import { errorMessage, json } from "@/lib/http";

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const variantId = String(body.variantId || "");
    const attributeKey = String(body.attributeKey || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const rawValue = String(body.value ?? "").trim();
    const unit = String(body.unit || "").trim() || null;
    const sourceId = String(body.sourceId || "");
    const sourceUrl = String(body.sourceUrl || "").trim() || null;
    const confidence = Math.max(1, Math.min(100, Number(body.confidence) || 80));
    const method = String(body.method || "documented").trim();
    if (!variantId || !sourceId || !rawValue) throw new Error("Vehicle, source and value are required.");
    if (!KEY_PATTERN.test(attributeKey)) throw new Error("Use an attribute name such as torque_nm or airbags.");
    if (sourceUrl) new URL(sourceUrl);

    const db = getRawDb();
    const vehicle = await db.prepare("SELECT market FROM variants WHERE id=?").bind(variantId).first<{ market: string }>();
    if (!vehicle) throw new Error("Vehicle not found.");
    const source = await db.prepare("SELECT id FROM sources WHERE id=?").bind(sourceId).first();
    if (!source) throw new Error("Source not found.");

    const valueNumber = Number(rawValue.replace(/,/g, ""));
    const numeric = Number.isFinite(valueNumber) && /^-?[\d,.]+$/.test(rawValue);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO observations
      (id, variant_id, attribute_key, value_text, value_number, unit, source_id, source_url,
       market, method, effective_from, effective_to, retrieved_at, confidence, raw_value, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL)`)
      .bind(id, variantId, attributeKey, numeric ? null : rawValue, numeric ? valueNumber : null,
        unit, sourceId, sourceUrl, vehicle.market, method, now, confidence, rawValue).run();

    const peers = await db.prepare(`SELECT id, value_text AS valueText, value_number AS valueNumber, unit
      FROM observations WHERE variant_id=? AND attribute_key=? AND id<>?`)
      .bind(variantId, attributeKey, id).all();
    let conflictCreated = false;
    for (const peer of peers.results as Record<string, unknown>[]) {
      const peerValue = peer.valueNumber ?? peer.valueText;
      const currentValue = numeric ? valueNumber : rawValue;
      if (String(peerValue) !== String(currentValue) || String(peer.unit || "") !== String(unit || "")) {
        const conflictId = crypto.randomUUID();
        await db.prepare(`INSERT INTO conflicts
          (id, variant_id, attribute_key, observation_a_id, observation_b_id, status, resolution_note, created_at, resolved_at)
          VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, NULL)`)
          .bind(conflictId, variantId, attributeKey, String(peer.id), id, now).run();
        conflictCreated = true;
        break;
      }
    }

    await db.prepare(`UPDATE variants SET
      completeness = MIN(100, (SELECT COUNT(DISTINCT attribute_key) * 4 FROM observations WHERE variant_id=?)),
      review_status = CASE WHEN (SELECT COUNT(DISTINCT attribute_key) FROM observations WHERE variant_id=?) >= 10 THEN 'profiled' ELSE 'enriching' END,
      updated_at=? WHERE id=?`).bind(variantId, variantId, now, variantId).run();

    return json({ observationId: id, conflictCreated });
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: 400 });
  }
}
