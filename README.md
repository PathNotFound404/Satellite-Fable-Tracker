# Satellite Tracker

[![ci](https://github.com/PathNotFound404/Satellite-Fable-Tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/PathNotFound404/Satellite-Fable-Tracker/actions/workflows/ci.yml)

Thousands of real satellites moving in real time on an interactive 3D globe. Orbital data comes from [CelesTrak](https://celestrak.org), positions are computed in the browser with SGP4, and everything is drawn in a single three.js point cloud. No backend, no cost.

**Live site:** https://satellite-fable-tracker.vercel.app

## Status

Built in milestones, each one demoable ([roadmap](docs/roadmap.md)).

| # | Milestone | State |
|---|---|---|
| 1 | Scaffold, globe, CI, deploy | Done |
| 2 | Data pipeline | Done: data refreshes from CelesTrak every 6 hours |
| 3 | Propagate and plot | Done: full catalog moving in real time |
| 4 | Select, info panel, orbit | Done: click a satellite for live stats and its orbit |
| 5 | Search and filters | Done: search by name or NORAD ID, group filters with counts |
| 6 | Stretch features | Time controls, day/night shading and ground track done; next-pass predictor next |
| 7 | Polish and README | Not started |

## Using it

- Drag to rotate, scroll or pinch to zoom.
- Click a satellite to see its name, altitude, speed, ground position, inclination and period, and to draw its orbit (solid blue) and its ground track in yellow: solid for the orbit just flown, dashed for the one ahead. Click empty space or press Esc to clear.
- Search by name or NORAD ID (press `/` to jump to the search field); choosing a result selects the satellite and swings the camera round to it.
- Filter to space stations, Starlink, GPS or weather satellites.
- Pause, fast-forward (up to 1000x) or run time backwards with the bar at the bottom; Space toggles pause, and "Back to now" returns to live.
- The globe shows day and night for the simulated time, so fast-forwarding sweeps the terminator round the Earth.
- Link straight to a satellite with `?sat=<NORAD ID>`, for example `?sat=25544` for the ISS.
- Add `?debug` for a frame rate and propagation cost readout.

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
