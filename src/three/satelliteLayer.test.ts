import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildCatalog } from '../orbital/catalog'
import { gmstRadFromUnixMs } from '../orbital/frames'
import { propagateEcf } from '../orbital/propagation'
import { parseSatelliteFile, type OmmRecord } from '../types/satellite-data'
import { createSatelliteLayer } from './satelliteLayer'
import { sceneToKm, writeEcfKmToScene } from './units'

const sample = parseSatelliteFile(
  JSON.parse(readFileSync(new URL('../../public/data/sample.json', import.meta.url), 'utf8')),
)
const START_MS = Date.parse(sample.generatedAt)
const FRAME_MS = 1000 / 60

/** Where a direct SGP4 call puts satellite `index` at `timeMs`, in scene units. */
function directScenePosition(catalog: ReturnType<typeof buildCatalog>, index: number, timeMs: number): Vector3 {
  const ecf = new Float64Array(6)
  propagateEcf(catalog.satrecs[index]!, timeMs, gmstRadFromUnixMs(timeMs), ecf)
  const scene = [0, 0, 0]
  writeEcfKmToScene(ecf[0]!, ecf[1]!, ecf[2]!, scene)
  return new Vector3(scene[0], scene[1], scene[2])
}

describe('createSatelliteLayer', () => {
  it('draws every satellite in one Points object', () => {
    const catalog = buildCatalog(sample)
    const layer = createSatelliteLayer(catalog, START_MS, 1)

    expect(layer.object.isPoints).toBe(true)
    expect(layer.object.geometry.getAttribute('position').count).toBe(catalog.count)
    expect(layer.invalidCount()).toBe(0)
    layer.dispose()
  })

  it('stays within metres of direct propagation while refreshing a slice per frame', () => {
    const catalog = buildCatalog(sample)
    const layer = createSatelliteLayer(catalog, START_MS, 1)
    const position = new Vector3()
    let worstErrorKm = 0

    // Ten simulated seconds at 60 fps.
    for (let frame = 1; frame <= 600; frame++) {
      const timeMs = START_MS + frame * FRAME_MS
      layer.update(timeMs)
      if (frame % 7 !== 0) continue
      for (let index = 0; index < catalog.count; index++) {
        expect(layer.getScenePosition(index, position)).toBe(true)
        const errorKm = sceneToKm(position.distanceTo(directScenePosition(catalog, index, timeMs)))
        worstErrorKm = Math.max(worstErrorKm, errorKm)
      }
    }

    // Linear extrapolation over at most ~1 s of orbit curvature is a few metres.
    expect(worstErrorKm).toBeLessThan(0.02)
    layer.dispose()
  })

  it('re-propagates everything after a large clock jump', () => {
    const catalog = buildCatalog(sample)
    const layer = createSatelliteLayer(catalog, START_MS, 1)
    const jumpedMs = START_MS + 3 * 3600 * 1000
    layer.update(jumpedMs)

    const position = new Vector3()
    for (let index = 0; index < catalog.count; index++) {
      layer.getScenePosition(index, position)
      expect(sceneToKm(position.distanceTo(directScenePosition(catalog, index, jumpedMs)))).toBeLessThan(0.01)
    }
    layer.dispose()
  })

  it('stays accurate across a time-base rebase', () => {
    const catalog = buildCatalog(sample)
    const layer = createSatelliteLayer(catalog, START_MS, 1)
    const position = new Vector3()
    // 40 simulated minutes in 100 ms frames crosses the 30-minute rebase threshold.
    let timeMs = START_MS
    for (let step = 0; step < 24_000; step++) {
      timeMs += 100
      layer.update(timeMs)
    }
    for (let index = 0; index < catalog.count; index++) {
      layer.getScenePosition(index, position)
      expect(sceneToKm(position.distanceTo(directScenePosition(catalog, index, timeMs)))).toBeLessThan(0.02)
    }
    layer.dispose()
  })

  it('hides a satellite whose propagation fails, and never leaves it at the origin', () => {
    // Elements that are valid at epoch but decay within hours (very high drag).
    const iss = sample.satellites.find((record) => record.NORAD_CAT_ID === 25544)!
    const decaying: OmmRecord = {
      ...iss,
      OBJECT_NAME: 'DECAYING',
      NORAD_CAT_ID: 99999,
      MEAN_MOTION: 16.47856722,
      ECCENTRICITY: 0.002487,
      BSTAR: 0.00018678,
      MEAN_MOTION_DOT: 0.16154492,
      MEAN_MOTION_DDOT: 0.0000076267,
    }
    const catalog = buildCatalog({ ...sample, count: 2, satellites: [iss, decaying] })
    expect(catalog.count).toBe(2)
    const epochMs = Date.parse(`${iss.EPOCH}Z`)

    const layer = createSatelliteLayer(catalog, epochMs, 1)
    expect(layer.invalidCount()).toBe(0)
    expect(layer.isShown(1)).toBe(true)

    layer.update(epochMs + 3 * 24 * 3600 * 1000)
    expect(layer.invalidCount()).toBe(1)
    expect(layer.isShown(0)).toBe(true)
    expect(layer.isShown(1)).toBe(false)
    expect(layer.getScenePosition(1, new Vector3())).toBe(false)
    expect(layer.object.geometry.getAttribute('aState').getX(1)).toBe(0)
    layer.dispose()
  })

  it('filters by mask without rebuilding the geometry', () => {
    const catalog = buildCatalog(sample)
    const layer = createSatelliteLayer(catalog, START_MS, 1)
    const geometryBefore = layer.object.geometry
    const positionArrayBefore = geometryBefore.getAttribute('position').array

    const mask = new Uint8Array(catalog.count)
    for (const index of catalog.groupIndices.starlink) mask[index] = 1
    layer.setFilter(mask)

    let shown = 0
    for (let index = 0; index < catalog.count; index++) if (layer.isShown(index)) shown++
    expect(shown).toBe(catalog.groupIndices.starlink.length)
    expect(layer.object.geometry).toBe(geometryBefore)
    expect(layer.object.geometry.getAttribute('position').array).toBe(positionArrayBefore)

    // The filter survives later refreshes.
    for (let frame = 1; frame <= 120; frame++) layer.update(START_MS + frame * FRAME_MS)
    shown = 0
    for (let index = 0; index < catalog.count; index++) if (layer.isShown(index)) shown++
    expect(shown).toBe(catalog.groupIndices.starlink.length)

    layer.setFilter(null)
    expect(layer.isShown(0)).toBe(true)
    layer.dispose()
  })

  it('handles an empty catalog', () => {
    const catalog = buildCatalog({ ...sample, count: 0, satellites: [] })
    const layer = createSatelliteLayer(catalog, START_MS, 1)
    expect(() => layer.update(START_MS + 16)).not.toThrow()
    layer.dispose()
  })
})
