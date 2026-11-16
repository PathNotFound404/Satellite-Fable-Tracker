# ADR 0002: Staggered main-thread propagation with GPU extrapolation

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The app has to show every active satellite moving in real time at 60 fps (a 16.6 ms frame budget) with no allocations in the render loop. The live catalog is larger than first assumed: 16,895 satellites on 2026-11-16, of which about 11,200 are Starlink.

Measured with `BENCH=1 npx vitest run scripts/propagation-bench` (Node 24.13, V8, this project's `propagateEcf`: SGP4 plus the TEME to ECF conversion) on the development laptop:

| Measurement | Result |
|---|---|
| One SGP4 call + frame conversion | about 1.6 µs |
| Full pass over 16,895 satellites, median | 26 ms |
| Full pass, 95th percentile | 60 ms |
| 1/60 of the catalog (282 satellites) | about 0.44 ms |
| Building all SGP4 records at load | about 440 ms, once |

A full pass every frame does not fit in a frame on the main thread. Options considered:

1. **Propagate everything every frame on the main thread.** Simplest, but 26 ms of a 16.6 ms budget.
2. **Lower-rate propagation with interpolation.** Refresh each satellite about once a second, a slice of the catalog per frame, and move points smoothly in between.
3. **Web Worker.** Propagate everything off the main thread and transfer a typed array each tick. Keeps the main thread free, but adds message latency, a second copy of the catalog and worker lifecycle code, and still needs interpolation to be smooth between ticks.
4. **satellite.js's WebAssembly bulk propagator** (new in v7). Potentially fastest, but it needs WASM assets wired through the bundler, and its threaded build needs cross-origin isolation headers. Not evaluated beyond that; it stays available if we ever need it.

## Decision

Option 2, with the "in between" done on the GPU.

- Each satellite stores its Earth-fixed position, its Earth-fixed velocity and the time those were computed, as vertex attributes of the one `THREE.Points` object.
- The vertex shader draws each point at `position + velocity * (now - time0)`. Per frame the CPU only sets one uniform (`uTime`).
- Each frame, `satelliteLayer.update` re-propagates a contiguous slice of the catalog sized so every satellite is refreshed once per second of simulation time, and uploads only that slice (`addUpdateRange`).
- The slice is capped at 1/8 of the catalog per frame. If the simulation clock runs fast, accuracy degrades before frame rate does.
- A clock jump of more than 10 s (seek, tab asleep) re-propagates everything at once.
- Shader time is a 32-bit float relative to a time base that is moved forward every 30 minutes, so it never loses millisecond resolution.

The frame conversion stays in `src/orbital/frames.ts` on the CPU; the shader only extrapolates in the Earth-fixed frame.

## Consequences

- **Per-frame CPU cost is about 0.4 to 0.5 ms** of SGP4 for the full catalog at 60 fps, plus a small buffer upload. One draw call.
- **Extrapolation error is a few metres.** A straight line over at most 1 s of a low-orbit arc deviates by about ½·a·t² ≈ 4 m (a ≈ 8.7 m/s²). A unit test holds the layer within 20 m of direct SGP4 across the whole sample. This is far below SGP4's own kilometre-level error.
- **Satellite.js allocates small result objects per `sgp4` call** (about 280 calls per frame). That is short-lived garbage we don't control without the WASM path; our own code in the loop allocates nothing. If a browser profile ever shows GC pauses from it, option 4 is the fix.
- **Time acceleration needs more work (M6).** At high rates the 1/8 cap leaves states several simulated seconds old and a straight line is no longer enough. Options then: raise the cap, add a gravity term to the shader extrapolation, or move to a worker.
- **Building SGP4 records blocks the main thread for about 0.4 s at load.** Acceptable for now (it happens once, under the loading state). If it shows up in Lighthouse (M7), build in chunks.
- **Picking and the info panel must use the same extrapolation** as the shader. `satelliteLayer.getScenePosition` does, so clicks land where points are drawn.
- **Frame rate on real hardware still needs confirming.** Headless Chrome cannot measure it. Open the app with `?debug` for a live frame rate and propagation cost readout.
