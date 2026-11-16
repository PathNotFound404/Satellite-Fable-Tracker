import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildCatalog } from '../orbital/catalog'
import { gmstRadFromUnixMs } from '../orbital/frames'
import { propagateEcf } from '../orbital/propagation'
import { parseSatelliteFile } from '../types/satellite-data'
import { extrapolate, EXTRAPOLATE_GLSL, MU_SCENE } from './extrapolation'
import { createSatelliteLayer } from './satelliteLayer'
import { sceneToKm, writeEcfKmToScene } from './units'

const sample = parseSatelliteFile(
  JSON.parse(readFileSync(new URL('../../public/data/sample.json', import.meta.url), 'utf8')),
)
const catalog = buildCatalog(sample)
const START_MS = Date.parse(sample.generatedAt)

/** Scene position and velocity of satellite `index` straight from SGP4. */
function directState(index: number, timeMs: number): { position: Vector3; velocity: Vector3 } {
  const ecf = new Float64Array(6)
  propagateEcf(catalog.satrecs[index]!, timeMs, gmstRadFromUnixMs(timeMs), ecf)
  const p = [0, 0, 0]
  const v = [0, 0, 0]
  writeEcfKmToScene(ecf[0]!, ecf[1]!, ecf[2]!, p)
  writeEcfKmToScene(ecf[3]!, ecf[4]!, ecf[5]!, v)
  return { position: new Vector3(...p), velocity: new Vector3(...v) }
}

/** Worst error over the whole sample when stepping `dtSeconds` from a fresh state. */
function worstErrorKm(dtSeconds: number): number {
  const out = new Vector3()
  let worst = 0
  for (let index = 0; index < catalog.count; index++) {
    const { position: p, velocity: v } = directState(index, START_MS)
    extrapolate(p.x, p.y, p.z, v.x, v.y, v.z, dtSeconds, out)
    const truth = directState(index, START_MS + dtSeconds * 1000).position
    worst = Math.max(worst, sceneToKm(out.distanceTo(truth)))
  }
  return worst
}

describe('extrapolate', () => {
  it('returns the starting position for dt = 0', () => {
    const out = new Vector3()
    extrapolate(1.07, 0.1, -0.2, 0.0001, 0.001, 0.0002, 0, out)
    expect(out.toArray()).toEqual([1.07, 0.1, -0.2])
  })

  it('is within metres of SGP4 after one second', () => {
    expect(worstErrorKm(1)).toBeLessThan(0.005)
  })

  it('is within half a km of SGP4 after a minute, forwards and backwards', () => {
    expect(worstErrorKm(60)).toBeLessThan(0.5)
    expect(worstErrorKm(-60)).toBeLessThan(0.5)
  })

  it('is within 3 km of SGP4 after 100 seconds', () => {
    expect(worstErrorKm(100)).toBeLessThan(3)
  })

  it('beats a straight line by a wide margin', () => {
    const out = new Vector3()
    const iss = catalog.indexByNoradId.get(25544)!
    const { position: p, velocity: v } = directState(iss, START_MS)
    const truth = directState(iss, START_MS + 60_000).position

    extrapolate(p.x, p.y, p.z, v.x, v.y, v.z, 60, out)
    const secondOrderKm = sceneToKm(out.distanceTo(truth))
    const straightKm = sceneToKm(p.clone().addScaledVector(v, 60).distanceTo(truth))

    expect(straightKm).toBeGreaterThan(10)
    expect(secondOrderKm).toBeLessThan(straightKm / 20)
  })

  it('shares its constants with the GLSL version', () => {
    expect(EXTRAPOLATE_GLSL).toContain(MU_SCENE.toExponential(8))
    expect(EXTRAPOLATE_GLSL).toContain('7.29211500e-5')
  })
})

describe('satellite layer under time acceleration', () => {
  /** Runs the layer for `frames` frames of 1/60 s at `rate` and returns the worst error in km. */
  function runAtRate(rate: number, frames: number): number {
    const layer = createSatelliteLayer(catalog, START_MS, 1)
    const position = new Vector3()
    let worst = 0
    for (let frame = 1; frame <= frames; frame++) {
      const timeMs = START_MS + (frame * rate * 1000) / 60
      layer.update(timeMs)
      for (let index = 0; index < catalog.count; index++) {
        if (!layer.getScenePosition(index, position)) continue
        worst = Math.max(worst, sceneToKm(position.distanceTo(directState(index, timeMs).position)))
      }
    }
    layer.dispose()
    return worst
  }

  it('stays within 5 km of SGP4 at 1000x', () => {
    expect(runAtRate(1000, 240)).toBeLessThan(5)
  })

  it('stays within 5 km of SGP4 at 1000x in reverse', () => {
    expect(runAtRate(-1000, 240)).toBeLessThan(5)
  })

  it('stays within 100 m at 100x', () => {
    expect(runAtRate(100, 240)).toBeLessThan(0.1)
  })

  it('does not re-propagate the whole catalog every frame at 1000x', () => {
    const layer = createSatelliteLayer(catalog, START_MS, 1)
    const time0 = layer.object.geometry.getAttribute('aTime0')
    layer.update(START_MS + 16_667)
    // A full refresh would give every satellite the same, newest timestamp.
    const stamps = new Set<number>()
    for (let index = 0; index < catalog.count; index++) stamps.add(time0.getX(index))
    expect(stamps.size).toBeGreaterThan(1)
    layer.dispose()
  })
})
