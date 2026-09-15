# MotorAtlas

**Open the app: https://axionaut.github.io/MotorAtlas/**

MotorAtlas runs entirely on GitHub Pages. No account, ChatGPT, Cloudflare Worker, database service, or local server is needed to use it.

## Using the app

- Nothing to set up: the first visit loads a bundled catalogue of ~30,000 vehicle identities across 14 markets, so you can search and compare immediately.
- Search the catalog, open a vehicle, and attach sourced evidence.
- Open Ingestion to refresh every manufacturer from NHTSA for a year range; a single manufacturer-year pull is available there as an advanced option.
- Select two to four records to compare the best-supported values and their spec scores.
- The spec score grades safety, efficiency, emissions, power, range, torque and occupant protection from attached evidence only. Vehicles without graded evidence show "No graded evidence" instead of a number.
- Export a backup to keep your work or transfer it to another browser. Import merges compatible backups and refuses conflicting IDs instead of overwriting data.

Vehicle data is saved in this browser's IndexedDB. Different browsers/devices do not automatically share changes. Clearing site storage removes that browser's data, so keep exported backups. Internet access is needed to load the site and fetch NHTSA data.

## Development and release

Requires Node 22.13+ and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run build
```

Push to main: .github/workflows/pages.yml validates, builds, and publishes dist to GitHub Pages. Vite uses /MotorAtlas/ as the asset base. Development preview commands are optional for developers, never needed by app users.

## Code map

- app/motor-atlas.tsx — interface
- lib/browser-db.ts — transactional browser storage
- lib/browser-api.ts — in-process operations, NHTSA fetch and backups
- lib/corpus.ts — observations, comparison and backup validation
- lib/ingest.ts — identity resolution and source crosswalks
- lib/seed.ts — bundled catalogue loading
- scripts/build-seed*.mjs — regenerate public/seed with `pnpm run seed`
- lib/source-catalog.ts — source registry
- ARCHITECTURE.md — evidence model and remaining work

## Data sources

Global market presence comes from [Vehicle data by VehiclesDB](https://vehiclesdb.com) under CC BY 4.0; United States model-year identities come from NHTSA vPIC. The VehiclesDB credit is a licence condition and must stay visible in the app.

NHTSA identities are live; other automated adapters remain planned. No vehicle score is manufactured from missing facts.
