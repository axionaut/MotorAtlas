# MotorAtlas engineering rules

Read `ARCHITECTURE.md` before changing identity, ingestion, provenance, conflict, or scoring logic.

## Product invariants

1. The canonical entity is a market-specific model-year variant, not merely a model name.
2. Never overwrite a factual value with another source's value. Insert another observation.
3. Every observation retains source, market, method, retrieval time, confidence, unit, and original value.
4. Resolve display precedence by source authority and confidence while preserving all competing evidence.
5. External source IDs belong in `source_crosswalks`; never use scraped display names as durable identity.
6. Adapters must be idempotent and record an `ingestion_runs` ledger entry.
7. Free, legally reusable, machine-readable sources form the backbone. Free-to-read commercial sites are research references only.
8. Keep claimed, regulatory, measured, owner-reported, and derived values distinct.
9. Crash scores require agency, protocol version, test year, market, and applicable configuration before comparison.
10. Scoring remains downstream of data coverage and validation. Never manufacture a score from absent evidence.

## Safe continuation order

NHTSA vPIC → EPA FuelEconomy → EEA CO₂ → VehiclesDB → Wikidata lineage → national registries → OEM document extraction → safety agencies → measured tests → scoring.

## Before committing

Run `pnpm run build`. After schema edits, run `pnpm run db:generate`, inspect the generated SQL, and append `PRAGMA optimize;` when new indexes are created.
