import { readFileSync } from 'node:fs'
import { Vector3, type Line } from 'three'
import { describe, expect, it } from 'vitest'
import { buildCatalog } from '../orbital/catalog'
import { MS_PER_MINUTE } from '../orbital/constants'
import { gmstRadFromUnixMs } from '../orbital/frames'
import { computeTelemetry, sampleOrbitTeme, type Telemetry } from '../orbital/orbitPath'
import { periodMinutes, propagateEcf } from '../orbital/propagation'
import { parseSatelliteFile } from '../types/satellite-data'
import { createSelectionVisuals } from './selectionVisuals'
import { sceneToKm, writeEcfKmToScene } from './units'

const sample = parseSatelliteFile(
  JSON.parse(readFileSync(new URL('../../public/data/sample.json', import.meta.url), 'utf8')),
)
const catalog = buildCatalog(sample)
const issIndex = catalog.indexByNoradId.get(25544)!
const iss = { satrec: catalog.satrecs[issIndex]!, meanMotionRevPerDay: catalog.records[issIndex]!.MEAN_MOTION }
const START_MS = Date.parse(sample.generatedAt)

function directScenePosition(timeMs: number): Vector3 {
  const ecf = new Float64Array(6)
  propagateEcf(iss.satrec, timeMs, gmstRadFromUnixMs(timeMs), ecf)
  const scene = [0, 0, 0]
  writeEcfKmToScene(ecf[0]!, ecf[1]!, ecf[2]!, scene)
  return new Vector3(scene[0], scene[1], scene[2])
}

/** World-space vertices of the orbit line as currently drawn. */
function orbitVertices(visuals: ReturnType<typeof createSelectionVisuals>): Vector3[] {
  const orbit = visuals.object.getObjectByName('orbit') as Line
  visuals.object.updateMatrixWorld(true)
  const geometry = orbit.geometry
  const position = geometry.getAttribute('position')
  const vertices: Vector3[] = []
  for (let i = 0; i < geometry.drawRange.count; i++) {
    vertices.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(orbit.matrixWorld))
  }
  return vertices
}

/** Shortest distance from `point` to the polyline through `vertices`, km. */
function distanceToPathKm(point: Vector3, vertices: Vector3[]): number {
  let best = Infinity
  const segment = new Vector3()
  const toPoint = new Vector3()
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i]!
    segment.subVectors(vertices[i + 1]!, a)
    toPoint.subVectors(point, a)
    const t = Math.min(1, Math.max(0, toPoint.dot(segment) / segment.lengthSq()))
    best = Math.min(best, a.clone().addScaledVector(segment, t).distanceTo(point))
  }
  return sceneToKm(best)
}

describe('sampleOrbitTeme', () => {
  it('samples one closed period', () => {
    const out = new Float64Array(91 * 3)
    const written = sampleOrbitTeme(iss.satrec, START_MS, iss.meanMotionRevPerDay, 91, out)
    expect(written).toBe(91)

    const first = new Vector3(out[0], out[1], out[2])
    const last = new Vector3(out[270], out[271], out[272])
    // After one period the satellite is back where it started, give or take drag and
    // precession (tens of km for the ISS).
    expect(first.distanceTo(last)).toBeLessThan(100)
    // And halfway round it is on the other side of the Earth.
    const half = new Vector3(out[135], out[136], out[137])
    expect(first.distanceTo(half)).toBeGreaterThan(12_000)
  })
})

describe('computeTelemetry', () => {
  it('reports plausible ISS values', () => {
    const telemetry: Telemetry = { altitudeKm: 0, speedKmS: 0, latitudeDeg: 0, longitudeDeg: 0 }
    expect(computeTelemetry(iss.satrec, START_MS, telemetry)).toBe(true)

    expect(telemetry.altitudeKm).toBeGreaterThan(395)
    expect(telemetry.altitudeKm).toBeLessThan(440)
    expect(telemetry.speedKmS).toBeCloseTo(7.66, 1)
    // The ISS never goes beyond its inclination in latitude.
    expect(Math.abs(telemetry.latitudeDeg)).toBeLessThanOrEqual(51.7)
    expect(telemetry.longitudeDeg).toBeGreaterThan(-180)
    expect(telemetry.longitudeDeg).toBeLessThanOrEqual(180)
  })
})

describe('createSelectionVisuals', () => {
  it('is hidden until a target is set, and again after it is cleared', () => {
    const visuals = createSelectionVisuals(1)
    expect(visuals.object.visible).toBe(false)
    visuals.setTarget(iss)
    expect(visuals.object.visible).toBe(true)
    visuals.setTarget(null)
    expect(visuals.object.visible).toBe(false)
    visuals.dispose()
  })

  it('draws an orbit that passes through the current position', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    visuals.update(START_MS, directScenePosition(START_MS))

    const vertices = orbitVertices(visuals)
    expect(vertices.length).toBeGreaterThan(300)
    expect(distanceToPathKm(directScenePosition(START_MS), vertices)).toBeLessThan(1)
    visuals.dispose()
  })

  it('keeps passing through the satellite as it moves and the Earth turns', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    const periodMs = periodMinutes(iss.meanMotionRevPerDay) * MS_PER_MINUTE

    // Step through most of an orbit at 60 fps-like intervals would be slow; 1 s steps
    // exercise both the between-resample rotation and the periodic resample.
    for (let timeMs = START_MS; timeMs < START_MS + periodMs * 0.8; timeMs += 1000) {
      const position = directScenePosition(timeMs)
      visuals.update(timeMs, position)
      if ((timeMs - START_MS) % 137_000 === 0) {
        expect(distanceToPathKm(position, orbitVertices(visuals))).toBeLessThan(2)
      }
    }
    visuals.dispose()
  })

  it('rotates with the Earth between resamples instead of staying glued to the ground', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    visuals.update(START_MS, null)
    const before = orbitVertices(visuals)[0]!.clone()

    // 15 s later (inside the resample interval) the Earth has turned about 0.06 degrees.
    visuals.update(START_MS + 15_000, null)
    const after = orbitVertices(visuals)[0]!
    const movedKm = sceneToKm(before.distanceTo(after))
    expect(movedKm).toBeGreaterThan(3)
    expect(movedKm).toBeLessThan(12)
    visuals.dispose()
  })

  it('places and hides the marker', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    const marker = visuals.object.getObjectByName('selection-marker')!

    visuals.update(START_MS, new Vector3(0.5, 0.6, 0.7))
    expect(marker.visible).toBe(true)
    expect(marker.position.toArray()).toEqual([0.5, 0.6, 0.7])

    visuals.update(START_MS + 16, null)
    expect(marker.visible).toBe(false)
    visuals.dispose()
  })
})
