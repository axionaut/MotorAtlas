# MotorAtlas architecture

MotorAtlas is a static React 19 application built with Vite and Tailwind 4, published on GitHub Pages at https://axionaut.github.io/MotorAtlas/. It has no server endpoints, sign-in provider, ChatGPT dependency, or Cloudflare runtime.

## Runtime and persistence

The browser renders the UI, reads/writes IndexedDB, and fetches NHTSA directly using its public CORS-enabled API. lib/browser-api.ts provides an in-process interface; its operation paths are never HTTP requests. No backend proxy or credentials are required.

Writes are differential: withCorpus stores only rows a callback added or changed, so a seeded corpus does not rewrite tens of thousands of rows on every save. Catalogue responses are paged (200 rows by default) and report the full match count.

The motoratlas-corpus IndexedDB database has nine stores: sources, makes, models, generations, variants, observations, source_crosswalks, ingestion_runs, conflicts. Each store uses id as its key. Sources are initialized only when the database is first created. Transactions serialize writes across tabs and commit all identity/evidence changes atomically. A failed transaction leaves stored data unchanged.

Data belongs to each browser installation. This release does not provide a shared editable cloud corpus or automatic cross-device synchronization. Export/import transfers a versioned JSON backup with all provenance. Imports validate references and merge additively; conflicting record IDs abort without overwriting stored records.

The previous hosted D1 database was inspected during migration on 2026-09-15: all eight non-source tables were empty; only the ten source registry rows existed. The registry is preserved in lib/source-catalog.ts. No old service is consulted at runtime.

## Bundled catalogue

The application ships a generated seed so a fresh browser opens with a comparable, multi-market catalogue instead of an empty schema. public/seed holds two files, built by `pnpm run seed`:

- `nhtsa-car-identities.json` — NHTSA vPIC car makes for 2015-2026, giving dated United States identities.
- `vehiclesdb-markets.json` — VehiclesDB (CC BY 4.0) car models and the markets that register them, giving global presence across ar, ca, de, es, fi, gb, ie, lu, my, nl, nz, th, ua and us.

lib/seed.ts applies each file on first load inside one transaction and records the applied seed version in the ingestion ledger, so seeds never load twice and a regenerated seed upgrades identities without duplicating them. A failed fetch is not fatal: the app opens with whatever the browser already holds.

VehiclesDB has no model years, so its identities are year-open (`model_year` null) and are created only for markets no dated identity already covers. Dated national adapters enrich a market later without erasing its presence record. CC BY 4.0 requires the visible VehiclesDB credit in the application footer; it is a licence condition, not decoration.

## Identity graph

make → model → generation → market/model-year variant

The variant is the comparison unit. External source IDs live in source_crosswalks; internal identity keys are UUIDs. NHTSA model-year pulls create US identity-only placeholders with unknown trim, body, powertrain and generation. They do not pretend to resolve detailed configurations. Crosswalks for make, model and US model-year identity make repeat pulls idempotent without resetting attached evidence.

## Evidence model

Each observation records variant, attribute, value, unit, source, source URL, market, method, effective dates, retrieval time, confidence and original value. Another source's assertion creates a separate observation. Competing values and units produce conflict records without deleting either observation.

Comparison chooses lowest source authority rank, then highest confidence, with a stable ID tie-break. Missing evidence stays empty. Unit conversion, protocol-aware safety comparison and explicit conflict resolution remain future work. Completeness is a simple attribute-coverage indicator, not a vehicle quality score.

Authority precedence: regulatory; OEM/government register; safety agencies; open catalogues; knowledge graphs; measured tests; editorial/user evidence. Claimed, regulatory, measured, owner-reported and derived methods remain distinct.

## Spec score

lib/score.ts grades a variant against seven weighted criteria: safety 25, efficiency 20, emissions 15, power 15, usable range 10, torque 10, occupant protection 5. Each criterion lists the attribute keys that satisfy it and whether higher or lower is better.
lib/score.ts grades a variant across four consumer-facing clusters with individual sub-scores and weights:
- **Safety & Protection (30%)**: Safety assessment (`safety_rating`, `ncap_overall_stars`, `euro_ncap_stars`) 20, Occupant protection (`child_occupant_score`, `occupant_protection_percent`, `airbags`) 10.
- **Performance & Dynamics (35%)**: Power (`power_kw`, `power_ps`, `power_hp`) 15, Torque (`torque_nm`) 10, Acceleration (`acceleration_0_100_s`, `zero_to_sixty_mph_s`) 5, Top speed (`top_speed_kmh`, `top_speed_mph`) 5.
- **Range & Efficiency (30%)**: Usable range (`range_km`, `electric_range_km`, `range_miles`) 15, Efficiency (`fuel_consumption_l_100km`, `combined_l_100km`, `consumption_kwh_100km`) 10, Emissions (`co2_g_km`, `co2_tailpipe_g_km`) 5.
- **Dimensions & Utility (5%)**: Cargo capacity (`cargo_volume_l`, `boot_space_l`, `cargo_volume_cu_ft`) 5.

The rules that keep the score honest:

- A criterion with no observation contributes nothing and lowers `scoreCoverage`; it is never imputed from a class average or a sibling variant.
- A variant with no graded evidence scores `null`, not zero, and the interface says "No graded evidence" rather than showing a bar.
- Values are normalised against the observed range for that criterion across the corpus, so a score means "better than the field currently holds", never an absolute verdict. A criterion observed on a single vehicle normalises to 0.5 because a field of one cannot rank anything.
- Cluster sub-scores provide breakdown visibility across Safety, Performance, Energy, and Utility alongside the composite score.
- The value used per criterion is the best-supported observation: lowest source authority rank, then highest confidence, then stable id — the same precedence comparison uses.

The catalogue orders by score, then coverage, then how many markets list the model, then year. Unscored identities therefore sort last instead of burying evidenced vehicles alphabetically.

## Ingestion

Identity resolution lives in lib/ingest.ts and runs over indexes built once per call, because a seeded corpus holds tens of thousands of identities. A source's external key resolves through source_crosswalks first; failing that, a normalised make/model name matches an identity another source already created, and only then is a new identity minted. Every source that names an identity gets its own crosswalk row.

The bulk adapter (`bulkIngestNhtsa`) enumerates every NHTSA car manufacturer and refreshes a year range without an operator naming vehicles. It writes one ledger entry, commits per manufacturer so an interrupted run keeps resolved identities, and records a stopped run as stopped rather than completed.

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
