# Satellite Tracker

[![ci](https://github.com/PathNotFound404/Satellite-Fable-Tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/PathNotFound404/Satellite-Fable-Tracker/actions/workflows/ci.yml)

Thousands of real satellites moving in real time on an interactive 3D globe. Orbital data comes from [CelesTrak](https://celestrak.org), positions are computed in the browser with SGP4, and everything is drawn in a single three.js point cloud. No backend, no cost.

**Live site:** coming soon (Vercel deployment pending).

## Status

Built in milestones, each one demoable ([roadmap](docs/roadmap.md)).

| # | Milestone | State |
|---|---|---|
| 1 | Scaffold, globe, CI, deploy | Globe and CI done; deploy pending |
| 2 | Data pipeline | Not started |
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

## Docs

- [Project brief](docs/project-brief.md)
- [Architecture](docs/architecture.md)
- [Data contract](docs/data-contract.md)
- [CI/CD plan](docs/ci-cd.md)
- [Decisions (ADRs)](docs/adr/)

## Credits

- Orbital data: [CelesTrak](https://celestrak.org) GP element sets.
- Earth imagery: NASA Blue Marble (public domain), via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Land_ocean_ice_2048.jpg).
