# Roadmap

Each milestone ends with a demoable app on the live Vercel URL. Work one milestone at a time, one PR per milestone (or per feature for stretch work). A milestone is done only when every acceptance criterion below is met **and** `typecheck`, `lint`, `test` and `build` pass in CI.

Related docs: [project brief](project-brief.md), [architecture](architecture.md), [CI/CD plan](ci-cd.md), [data contract](data-contract.md).

| # | Milestone | Demo at the end |
|---|---|---|
| 1 | Scaffold, globe, CI, deploy | A rotating textured Earth at a live URL |
| 2 | Data pipeline | Live site serves fresh CelesTrak data every 6 hours |
| 3 | Propagate and plot | 10k+ satellites moving in real time |
| 4 | Select, info panel, orbit | Click a satellite, see its stats and orbit |
| 5 | Search and filters | Find the ISS; show only Starlink or GPS |
| 6 | Stretch features | One feature per PR |
| 7 | Polish and README | Portfolio-ready repo with GIF and write-up |

---

## M1: Scaffold, globe, CI, deploy

Set up the project and ship the first visible result.

**Scope**
- Vue 3 + Vite + TypeScript (strict) scaffold, with ESLint and Vitest configured.
- npm scripts matching the table in `CLAUDE.md`: `dev`, `build`, `test`, `typecheck`, `lint` (`fetch-data` comes in M2).
- Node LTS version pinned in `.nvmrc` and `package.json` `engines`.
- three.js scene: textured Earth (public-domain texture such as NASA Blue Marble), lighting, orbit controls (rotate and zoom).
- `ci.yml` workflow running on PRs and pushes to `main` (see [ci-cd.md](ci-cd.md)).
- Vercel project connected to the GitHub repo: production deploys from `main`, preview deploys on PRs.
- README with project description, CI status badge and live URL.

**Acceptance criteria**
- [ ] `npm ci && npm run dev` shows a textured Earth that can be rotated and zoomed.
- [ ] Holds 60fps on a mid-range laptop.
- [ ] CI runs on a PR and blocks merge on failure (branch protection on `main`, see [ci-cd.md](ci-cd.md#branch-protection)).
- [ ] Merging to `main` deploys to the production URL; PRs get a preview URL.
- [ ] README shows the CI badge and the live link.

## M2: Data pipeline

Get real orbital data onto the live site without the browser ever calling CelesTrak.

**Scope**
- Write [data-contract.md](data-contract.md) types into `src/types/`.
- `scripts/fetch-data` (Node, TypeScript): fetches the CelesTrak groups, validates, writes `public/data/satellites.json`. Exposed as `npm run fetch-data`.
- `scripts/pull-live-data`: used by every build to copy the current production data into the build (falls back to `public/data/sample.json`).
- `public/data/sample.json`: small committed sample (about 50 satellites incl. ISS, a few Starlink, GPS, weather) for development and tests.
- `data-refresh.yml` scheduled workflow (every 6 hours) that fetches, validates and deploys with the Vercel CLI. Full spec in [ci-cd.md](ci-cd.md#data-refresh-workflow), including CelesTrak fair use.
- ADR 0001 (already written) records the delivery decision.
- App loads the JSON once at startup and shows the data's age (`generatedAt`).

**Acceptance criteria**
- [ ] The scheduled workflow runs at least twice on its own and the live site's `generatedAt` updates.
- [ ] Requests follow every rule in [CelesTrak fair use](ci-cd.md#celestrak-fair-use): at most one download of each group per 2-hour update, stop on the first non-200, no retries.
- [ ] A forced failure (bad URL, empty response, too few records) leaves the live data unchanged. Tested by unit tests on the validator and by one manual run.
- [ ] A normal push to `main` deploys with the current live data, not the sample.
- [ ] The UI shows "Data updated X hours ago".
- [ ] Generated data is never committed (`public/data/satellites.json` is in `.gitignore`).

## M3: Propagate and plot

**Scope**
- `src/orbital/`: propagation wrapper around satellite.js, TEME→ECF conversion with GMST, altitude and speed helpers. Pure TypeScript, no Vue or three.js imports.
- Unit tests against known-good reference values (published SGP4 test vectors, e.g. Vallado's `SGP4-VER.TLE` cases).
- One `THREE.Points` (or instanced) object for all satellites, positions written into a reused typed array.
- Simulation clock module (single source of "now"), ready for time controls later.
- Measure per-frame propagation cost for the full catalog. Decide main thread vs Web Worker vs lower-rate propagation with interpolation, and record it in `docs/adr/0002-propagation-strategy.md`.

**Acceptance criteria**
- [ ] All satellites from the live data render and move in real time.
- [ ] 60fps with the full catalog (10k+ points) on a mid-range laptop, measured and noted in the ADR.
- [ ] Decayed or invalid satellites (satellite.js returns `false`/errors) are skipped: no crash, no point at the origin.
- [ ] TEME→ECF conversion has tests with reference values. The ISS position matches an independent source (e.g. a published reference position for a given epoch) within a few km.
- [ ] No allocations inside the render loop (check with a browser performance profile).

## M4: Select, info panel, orbit line

**Scope**
- Click picking on the point cloud.
- Info panel: name, NORAD ID, altitude (km), speed (km/s), inclination (deg), period (min), data epoch.
- Orbit line for the selected satellite (one orbital period, sampled positions).
- Highlight the selected point.

**Acceptance criteria**
- [ ] Clicking a satellite selects it within one frame or so, with all points loaded.
- [ ] Panel values update live and use correct units. Altitude and speed for the ISS fall in plausible ranges (about 400–430 km, about 7.66 km/s).
- [ ] The orbit line passes through the satellite's current position.
- [ ] Clicking empty space or pressing Esc clears the selection.

## M5: Search and filters

**Scope**
- Search by name or NORAD ID with a result list.
- Group filter: All, Stations, Starlink, GPS, Weather (from the `groups` index in the data contract).
- Selecting a search result selects the satellite and moves the camera to it.

**Acceptance criteria**
- [ ] Typing "ISS" finds the ISS (ZARYA) and selecting it shows its panel.
- [ ] Each filter shows only its group; counts are shown.
- [ ] Filtering hides points without rebuilding the geometry (no frame drop when toggling).
- [ ] Search stays responsive with the full catalog loaded.

## M6: Stretch features (one PR each)

Proposed order, easiest and most visible first. Reorder freely.

1. **Time controls:** pause, speed up (e.g. 1x to 1000x), rewind, back to now. Built on the M3 simulation clock.

   Acceptance criteria (agreed 2026-11-16):
   - [x] A control bar with pause/play, speed steps (1x, 10x, 100x, 1000x), reverse, and a button that returns to real time at 1x.
   - [x] The current simulation date and time are always shown (UTC), with a clear indicator when it is live and when it is not.
   - [x] Satellites, the info panel and the orbit line all follow simulation time.
   - [x] At 1000x, positions stay within 5 km of direct SGP4 (unit-tested, forwards and in reverse).
   - [ ] The app holds 60fps at 1000x on a mid-range laptop (to confirm on real hardware with `?debug`).
   - [x] Time is limited to 7 days either side of the data and the present, stopping at the edge, with a warning beyond 2 days from the data.
   - [x] Space toggles pause.
2. **Day/night shading:** terminator from the sun position at simulation time.

   Acceptance criteria (agreed 2026-11-16):
   - [x] The terminator is drawn from the Sun's position at simulation time, so it moves with the time controls.
   - [x] The night side is dimmed but still readable, with a soft twilight band.
   - [x] The sub-solar point matches reference values to within about a degree (unit-tested against an independent source, the solstices, an equinox and the equation of time).
   - [x] No extra draw calls: the shading is added to the Earth material's shader.
   - [ ] No measurable frame rate cost (to confirm on real hardware with `?debug`).
3. **Ground track:** selected satellite's track on the globe surface.

   Acceptance criteria (agreed 2026-11-16):
   - [x] The track of the selected satellite is drawn on the globe surface for one orbit behind and one ahead.
   - [x] It passes directly under the satellite's current position (unit-tested within 1 km as time runs).
   - [x] It follows simulation time and updates when the selection changes.
   - [x] It is visually distinct from the orbit line (yellow and two pixels wide, against the thin accent-coloured orbit).
   - [x] Its direction is readable (added 2026-11-16 after owner feedback): solid and dimmer behind the satellite, dashed and brighter ahead, with a legend in the info panel.
4. **Next-pass predictor:** browser geolocation (with a manual fallback), next passes over the next 24 hours with rise, peak elevation and set times. Tested against an independent pass prediction for a known location and data set.

   Acceptance criteria (agreed 2026-11-16):
   - [x] The info panel has a "Passes over you" section with a button that asks the browser for the location, and typed latitude and longitude as the fallback.
   - [x] It lists the selected satellite's passes for the next 7 days of simulation time (24 hours at first; extended 2026-11-16 at the owner's request): rise and set in local time, and peak elevation. The soonest five are shown, with the rest one click away.
   - [x] Only passes that peak above 10 degrees are listed.
   - [x] Rise and set times are within about a minute of an independent prediction (unit-tested against Skyfield for two satellites and two locations; they agree within 5 s).
   - [x] The location stays in the browser, is not stored, and the UI says so.
   - [x] The search does not hold up rendering: about 15 ms for a 7-day search, run when the selection or location changes and then at most once per hour of simulation time.
5. **Conjunction highlighting:** flag close approaches below a threshold. Clearly labeled as approximate (GP data is not suitable for real collision assessment).
6. **Space station icon** (owner idea, 2026-11-16): draw members of the `stations` group with a small station glyph instead of a dot. One icon per cluster, since each docked module is a separate catalog entry; ordinary satellites stay in the single points object.

   Acceptance criteria (agreed 2026-11-16):
   - [x] Space stations show a small monochrome station glyph over their dot.
   - [x] One glyph per station, not one per docked module (members within 50 km share one, unit-tested).
   - [x] Clicking the glyph selects the station's core module, and the group filter hides and shows glyphs like any other satellite.
   - [x] Ordinary satellites stay in the single points object; glyphs are one extra draw call.
   - [ ] No measurable frame rate cost (to confirm on real hardware with `?debug`).
7. **Catalog details** (owner request, 2026-11-16): owner country, launch date, launch site and object type in the info panel. The GP data has none of these; they come from the CelesTrak satellite catalog (SATCAT), so this needs one more download and a change to the fetch script and the data contract.

   Acceptance criteria (written 2026-11-16; the owner asked for the feature and for work to continue while away, so these were not reviewed first):
   - [x] The info panel shows owner, launch date, launch site, object type and status in words, for satellites the catalog covers.
   - [x] The details come from one CelesTrak SATCAT request made by the pipeline at most once per 24 hours; the browser never calls CelesTrak.
   - [x] A SATCAT failure never blocks or damages the orbital data: old details are kept and the run carries a warning (unit-tested).
   - [x] The fields are optional in the data contract, so older files still load, and an unknown code is shown as it is.
   - [x] No workflow file change.
   - [ ] One scheduled run has added details to the live site.

Each stretch feature needs its own acceptance criteria written before work starts.

## M7: Polish and README

**Acceptance criteria**
- [ ] README: what it is, live link, GIF, how it works (pipeline + SGP4 + rendering), tech stack, local setup, data attribution to CelesTrak, accuracy note.
- [ ] Lighthouse performance check on the live site, with any large issues fixed.
- [ ] Loading and error states: data load failure, WebGL unavailable.
- [ ] Docs (`architecture.md`, ADRs, `ci-cd.md`) match what was built.
