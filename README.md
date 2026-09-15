# MotorAtlas

**Open the app: https://axionaut.github.io/MotorAtlas/**

MotorAtlas runs entirely on GitHub Pages. No account, ChatGPT, Cloudflare Worker, database service, or local server is needed to use it.

## Using the app

- Open Ingestion, enter a manufacturer and model year, and run the NHTSA import.
- Search the catalog, open a vehicle, and attach sourced evidence.
- Select two to four records to compare the best-supported values.
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
- lib/corpus.ts — identities, observations, comparison and backup validation
- lib/source-catalog.ts — source registry
- ARCHITECTURE.md — evidence model and remaining work

NHTSA identities are live; other automated adapters remain planned. No vehicle score is manufactured from missing facts.
