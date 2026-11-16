# Satellite Tracker

[![ci](https://github.com/PathNotFound404/Satellite-Fable-Tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/PathNotFound404/Satellite-Fable-Tracker/actions/workflows/ci.yml)

Thousands of real satellites moving in real time on an interactive 3D globe. Orbital data comes from [CelesTrak](https://celestrak.org), positions are computed in the browser with SGP4, and everything is drawn in a single three.js point cloud. No backend, no cost.

**Live site:** coming soon (Vercel deployment pending).

## Status

Built in milestones, each one demoable ([roadmap](docs/roadmap.md)).

| # | Milestone | State |
|---|---|---|
| 1 | Scaffold, globe, CI, deploy | Globe and CI done; deploy pending |
| 2 | Data pipeline | Fetch, validation and refresh workflow done; scheduled deploys pending Vercel setup |
| 3 | Propagate and plot | Not started |
| 4 | Select, info panel, orbit | Not started |
| 5 | Search and filters | Not started |
| 6 | Stretch features | Not started |
| 7 | Polish and README | Not started |

## Stack

Vue 3 + Vite + TypeScript, three.js, satellite.js, Vitest, GitHub Actions, Vercel.

## Run it locally

Needs Node 24 (see `.nvmrc`).

```sh
npm ci
npm run dev
```

| Task | Command |
|---|---|
| Dev server | `npm run dev` |
| Build | `npm run build` |
| Unit tests | `npm test` |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |

The dev server and build use `public/data/sample.json` (50 satellites) unless a full `public/data/satellites.json` exists. `npm run fetch-data` downloads the full catalog from CelesTrak; please read [CelesTrak fair use](docs/ci-cd.md#celestrak-fair-use) first, since each run counts against your IP.

## Docs

- [Project brief](docs/project-brief.md)
- [Architecture](docs/architecture.md)
- [Data contract](docs/data-contract.md)
- [CI/CD plan](docs/ci-cd.md)
- [Decisions (ADRs)](docs/adr/)

## Credits

- Orbital data: [CelesTrak](https://celestrak.org) GP element sets.
- Earth imagery: NASA Blue Marble (public domain), via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Land_ocean_ice_2048.jpg).
