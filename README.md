# MotorAtlas

A provenance-first global automotive database and comparison engine built around free, reusable data.

This repository is complete source code, designed to be opened and continued in VS Code with Codex, Claude Code, or an ordinary human who enjoys databases and consequences.

## What works now

- Canonical make → model → generation → market/model-year variant schema
- Source registry with licences, authority tiers, coverage and adapter status
- Live NHTSA make/year ingestion with idempotent external-ID crosswalks
- Searchable vehicle catalog and market filtering
- Source-preserving observation entry
- Automatic conflict flags when sources disagree
- Two-to-four vehicle comparison using best-supported observations
- Ingestion ledger and attribute coverage dashboard
- Durable Cloudflare D1/SQLite storage

## Open in VS Code

1. Extract the ZIP and open the `motoratlas` folder in VS Code.
2. Install Node.js 22 or newer and enable Corepack.
3. In the VS Code terminal, run:

```bash
corepack enable
pnpm install
pnpm run setup:local
pnpm run dev
```

Open the local URL printed by the terminal.

`setup:local` builds the Worker configuration and applies the first SQLite/D1 migration. Run it once for a fresh checkout. Later, ordinary UI changes need only `pnpm run dev`.

## Useful commands

```bash
pnpm run dev              # local development with hot reload
pnpm run build            # production build and type validation
pnpm run db:generate      # generate a migration after schema edits
pnpm run db:migrate:local # apply the initial local migration
pnpm run lint             # optional lint pass
```

## Where to work

- `app/motor-atlas.tsx` — working interface
- `app/api/` — catalog, comparison, observations and ingestion endpoints
- `app/api/ingest/nhtsa/route.ts` — first live source adapter
- `db/schema.ts` — canonical relational schema
- `drizzle/` — generated database migration and metadata
- `lib/source-catalog.ts` — free-source registry
- `lib/bootstrap.ts` — source-catalog bootstrap
- `ARCHITECTURE.md` — data model and continuation plan
- `AGENTS.md` — invariants for coding agents

## Database rule that matters

MotorAtlas does not have `power = 150 hp`. It has one or more observations saying who asserted 150 hp, for which market/configuration, using which method, on what date, with what confidence. Another source asserting 147 hp becomes another observation and a conflict to inspect—not a silent overwrite.

## Deployment

The included `.openai/hosting.json` keeps the project connected to its current private Sites project. Continued local work is independent of that deployment. A different Cloudflare setup can use the generated Worker and D1 migration with ordinary Wrangler configuration.

## Current boundary

NHTSA identity ingestion is live. EPA, EEA, VehiclesDB, Wikidata, Traficom, RDW, NZTA and NRCan are mapped in the source registry and deliberately marked as `mapped`, not falsely advertised as implemented. `ARCHITECTURE.md` gives their implementation order.
