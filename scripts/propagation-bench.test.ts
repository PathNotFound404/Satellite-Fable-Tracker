/**
 * BENCH=1 npx vitest run scripts/propagation-bench
 *
 * Measures SGP4 cost for the full catalog in public/data/satellites.json (falls back to
 * the sample). Skipped in normal test runs. Results are recorded in
 * docs/adr/0002-propagation-strategy.md. Offline: never contacts CelesTrak.
 */
import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { buildCatalog } from '../src/orbital/catalog.ts'
import { gmstRadFromUnixMs } from '../src/orbital/frames.ts'
import { propagateEcf } from '../src/orbital/propagation.ts'
import { parseSatelliteFile } from '../src/types/satellite-data.ts'

it.skipIf(!process.env.BENCH)('benchmark: propagate the whole catalog', () => {
  const full = new URL('../public/data/satellites.json', import.meta.url)
  const sample = new URL('../public/data/sample.json', import.meta.url)
  const file = parseSatelliteFile(JSON.parse(readFileSync(existsSync(full) ? full : sample, 'utf8')))

  const buildStart = performance.now()
  const catalog = buildCatalog(file)
  const buildMs = performance.now() - buildStart

  const out = new Float64Array(6)
  const startMs = Date.parse(file.generatedAt)
  const fullPass = (unixMs: number): number => {
    const gmst = gmstRadFromUnixMs(unixMs)
    let failed = 0
    for (let i = 0; i < catalog.count; i++) {
      if (!propagateEcf(catalog.satrecs[i]!, unixMs, gmst, out)) failed++
    }
    return failed
  }

  // Warm up the JIT before timing.
  for (let pass = 0; pass < 20; pass++) fullPass(startMs + pass * 1000)

  const PASSES = 100
  const timesMs: number[] = []
  let failed = 0
  for (let pass = 0; pass < PASSES; pass++) {
    const t0 = performance.now()
    failed = fullPass(startMs + pass * 1000)
    timesMs.push(performance.now() - t0)
  }
  timesMs.sort((a, b) => a - b)
  const median = timesMs[PASSES / 2]!
  const p95 = timesMs[Math.floor(PASSES * 0.95)]!

  console.log(
    [
      `node ${process.version}, ${catalog.count} satellites (${catalog.droppedCount} dropped at build)`,
      `build SGP4 records:   ${buildMs.toFixed(1)} ms (once, at load)`,
      `full pass, median:    ${median.toFixed(2)} ms (${((median / catalog.count) * 1000).toFixed(2)} us per satellite)`,
      `full pass, p95:       ${p95.toFixed(2)} ms`,
      `failed propagations:  ${failed}`,
      `1/60 of the catalog:  ${(median / 60).toFixed(3)} ms per frame (1 s refresh period at 60 fps)`,
    ].join('\n'),
  )
  expect(catalog.count).toBeGreaterThan(0)
})
