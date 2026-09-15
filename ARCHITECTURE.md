# MotorAtlas architecture

MotorAtlas is a static React 19 application built with Vite and Tailwind 4, published on GitHub Pages at https://axionaut.github.io/MotorAtlas/. It has no server endpoints, sign-in provider, ChatGPT dependency, or Cloudflare runtime.

## Runtime and persistence

The browser renders the UI, reads/writes IndexedDB, and fetches NHTSA directly using its public CORS-enabled API. lib/browser-api.ts provides an in-process interface; its operation paths are never HTTP requests. No backend proxy or credentials are required.

The motoratlas-corpus IndexedDB database has nine stores: sources, makes, models, generations, variants, observations, source_crosswalks, ingestion_runs, conflicts. Each store uses id as its key. Sources are initialized only when the database is first created. Transactions serialize writes across tabs and commit all identity/evidence changes atomically. A failed transaction leaves stored data unchanged.

Data belongs to each browser installation. This release does not provide a shared editable cloud corpus or automatic cross-device synchronization. Export/import transfers a versioned JSON backup with all provenance. Imports validate references and merge additively; conflicting record IDs abort without overwriting stored records.

The previous hosted D1 database was inspected during migration on 2026-09-15: all eight non-source tables were empty; only the ten source registry rows existed. The registry is preserved in lib/source-catalog.ts. No old service is consulted at runtime.

## Identity graph

make → model → generation → market/model-year variant

The variant is the comparison unit. External source IDs live in source_crosswalks; internal identity keys are UUIDs. NHTSA model-year pulls create US identity-only placeholders with unknown trim, body, powertrain and generation. They do not pretend to resolve detailed configurations. Crosswalks for make, model and US model-year identity make repeat pulls idempotent without resetting attached evidence.

## Evidence model

Each observation records variant, attribute, value, unit, source, source URL, market, method, effective dates, retrieval time, confidence and original value. Another source's assertion creates a separate observation. Competing values and units produce conflict records without deleting either observation.

Comparison chooses lowest source authority rank, then highest confidence, with a stable ID tie-break. Missing evidence stays empty. Unit conversion, protocol-aware safety comparison and explicit conflict resolution remain future work. Completeness is a simple attribute-coverage indicator, not a vehicle quality score.

Authority precedence: regulatory; OEM/government register; safety agencies; open catalogues; knowledge graphs; measured tests; editorial/user evidence. Claimed, regulatory, measured, owner-reported and derived methods remain distinct.

## Ingestion

1. Record a running ingestion ledger entry.
2. Fetch and validate NHTSA results with a bounded timeout.
3. Resolve source crosswalks and create missing identities.
4. Atomically persist identities, crosswalks and accurate inserted/updated/rejected counts.
5. Record failures in the ledger. Network work happens outside the database transaction.

A tab closed during a request can leave its ledger entry marked running; it never implies completed ingestion.

## Release

GitHub Actions installs locked dependencies, runs data tests, type-checks and builds static assets, then publishes dist using GitHub Pages. The /MotorAtlas/ base path is explicit. No SQL migrations or server deployment are involved.

## Next production slices

NHTSA VIN decode → EPA enrichment → EEA → VehiclesDB → Wikidata lineage → national registries → OEM extraction → safety agencies → measured tests → scoring after measured coverage thresholds. Add units, uncertain-identity review, conflict resolution and shared-data synchronization as explicit future changes.
