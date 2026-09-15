# MotorAtlas architecture

MotorAtlas is a global automotive evidence system. It stores vehicle identities separately from factual observations so disagreement remains visible and resolvable.

## Identity graph

```text
make → model → generation → market/model-year variant
                              ↑
                    external source crosswalks
```

The variant is the comparison unit. A United States Corolla LE and a Japanese Corolla W×B can share lineage without being treated as the same product.

## Evidence model

An observation records one source's assertion about one variant and one attribute:

```text
variant_id + attribute_key + value + unit
+ source_id + source_url + market + method
+ effective dates + retrieved_at + confidence + raw_value
```

The comparison endpoint currently chooses the lowest `authority_rank`, then the highest confidence, for headline display. All observations remain available in the vehicle evidence ledger.

## Source authority

1. Homologation and regulatory data
2. OEM technical documents and government registers
3. NCAP and testing authorities
4. Open canonical catalogues
5. Knowledge graphs
6. Independent instrumented tests
7. Editorial and user-submitted evidence

The number is precedence, not a claim of infallibility.

## Runtime

- UI: React 19, Next-compatible App Router, Tailwind 4 and reusable accessible components.
- Runtime: Vinext on Cloudflare Workers.
- Database: Cloudflare D1 / SQLite.
- Schema: Drizzle ORM definitions with generated SQL migrations.
- Live adapter: NHTSA `GetModelsForMakeYear`.
- Agent interface: WebMCP catalog-search tool when the browser supports it.

## Implemented workflows

- Pull a US manufacturer/model-year identity set from NHTSA.
- Store source model IDs as durable crosswalks.
- Search and filter canonical market variants.
- Attach manual sourced evidence with method and confidence.
- Flag conflicting values without deleting either observation.
- Compare two to four records using best-supported values.
- Inspect source licence, coverage and adapter readiness.
- Inspect ingestion history and attribute coverage.

## Adapter contract

Each adapter should have four stages:

1. `fetch(scope)` obtains raw source records.
2. `normalize(raw)` emits source-neutral identity and observation candidates.
3. `resolve(candidate)` links or creates canonical identities through crosswalks.
4. `persist(batch)` writes idempotently and closes the ingestion ledger entry.

Bulk datasets should be processed outside request time and submitted in bounded batches. Store raw downloads externally when auditability demands it; store their checksums and extraction metadata in D1.

## Next production slices

1. Extract the NHTSA route into a reusable adapter package and add VIN decode.
2. Add EPA bulk ingestion and crosswalk EPA vehicle IDs to NHTSA identities.
3. Add EEA type/variant/version ingestion with market and approval identifiers.
4. Add a candidate-matching queue for uncertain identity resolution.
5. Add units and attribute-definition tables with conversion rules.
6. Add conflict review and explicit resolution workflows.
7. Add scheduled bulk jobs and resumable checkpoints.
8. Add safety-test entities with protocol-aware comparability.
9. Add scoring only after coverage thresholds are defined and measured.
