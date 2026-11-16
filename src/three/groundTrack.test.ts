import { readFileSync } from 'node:fs'
import { Vector3, type Line } from 'three'
import { describe, expect, it } from 'vitest'
import { buildCatalog } from '../orbital/catalog'
import { MS_PER_MINUTE } from '../orbital/constants'
import { gmstRadFromUnixMs } from '../orbital/frames'
import { sampleGroundTrackEcf } from '../orbital/orbitPath'
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
const PERIOD_MS = periodMinutes(iss.meanMotionRevPerDay) * MS_PER_MINUTE

/** Unit vector (scene axes) from Earth's centre to the ISS at `timeMs`. */
function satelliteDirection(timeMs: number): Vector3 {
  const ecf = new Float64Array(6)
  propagateEcf(iss.satrec, timeMs, gmstRadFromUnixMs(timeMs), ecf)
  const scene = [0, 0, 0]
  writeEcfKmToScene(ecf[0]!, ecf[1]!, ecf[2]!, scene)
  return new Vector3(scene[0], scene[1], scene[2]).normalize()
}

function trackLine(visuals: ReturnType<typeof createSelectionVisuals>): Line {
  return visuals.object.getObjectByName('ground-track') as Line
}

function trackVertices(visuals: ReturnType<typeof createSelectionVisuals>): Vector3[] {
  const line = trackLine(visuals)
  visuals.object.updateMatrixWorld(true)
  const position = line.geometry.getAttribute('position')
  const vertices: Vector3[] = []
  for (let i = 0; i < line.geometry.drawRange.count; i++) {
    vertices.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(line.matrixWorld))
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

describe('sampleGroundTrackEcf', () => {
  it('writes unit vectors with the middle sample at the centre time', () => {
    const out = new Float64Array(181 * 3)
    expect(sampleGroundTrackEcf(iss.satrec, START_MS, iss.meanMotionRevPerDay, 181, out)).toBe(181)

    for (let i = 0; i < 181; i++) {
      expect(Math.hypot(out[i * 3]!, out[i * 3 + 1]!, out[i * 3 + 2]!)).toBeCloseTo(1, 9)
    }

    const ecf = new Float64Array(6)
    propagateEcf(iss.satrec, START_MS, gmstRadFromUnixMs(START_MS), ecf)
    const radius = Math.hypot(ecf[0]!, ecf[1]!, ecf[2]!)
    expect(out[90 * 3]).toBeCloseTo(ecf[0]! / radius, 9)
    expect(out[90 * 3 + 1]).toBeCloseTo(ecf[1]! / radius, 9)
    expect(out[90 * 3 + 2]).toBeCloseTo(ecf[2]! / radius, 9)
  })

  it('never goes beyond the orbit inclination in latitude', () => {
    const out = new Float64Array(361 * 3)
    sampleGroundTrackEcf(iss.satrec, START_MS, iss.meanMotionRevPerDay, 361, out)
    for (let i = 0; i < 361; i++) {
      const latitudeDeg = (Math.asin(out[i * 3 + 2]!) * 180) / Math.PI
      expect(Math.abs(latitudeDeg)).toBeLessThan(51.9)
    }
  })

  it('shifts west by about one period of Earth rotation per orbit', () => {
    const out = new Float64Array(3 * 3)
    // Three samples: one period back, now, one period ahead.
    sampleGroundTrackEcf(iss.satrec, START_MS, iss.meanMotionRevPerDay, 3, out)
    const longitude = (i: number): number => (Math.atan2(out[i * 3 + 1]!, out[i * 3]!) * 180) / Math.PI
    const shift = ((longitude(2) - longitude(1) + 540) % 360) - 180
    // The Earth turns 360 degrees per sidereal day: about 23.3 degrees in 92.9 minutes.
    // Nodal precession adds a little.
    expect(shift).toBeLessThan(-22.5)
    expect(shift).toBeGreaterThan(-24.5)
  })
})

describe('ground track in the selection visuals', () => {
  it('is drawn just above the surface, one orbit either side of now', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    visuals.update(START_MS, null)

    const vertices = trackVertices(visuals)
    expect(vertices).toHaveLength(361)
    for (const vertex of vertices) expect(vertex.length()).toBeCloseTo(1.003, 5)
    // Ends are where the satellite was and will be one period away.
    expect(vertices[0]!.angleTo(satelliteDirection(START_MS - PERIOD_MS))).toBeLessThan(1e-4)
    expect(vertices[360]!.angleTo(satelliteDirection(START_MS + PERIOD_MS))).toBeLessThan(1e-4)
    visuals.dispose()
  })

  it('passes directly under the satellite, and keeps doing so as time runs', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)

    for (let timeMs = START_MS; timeMs < START_MS + PERIOD_MS * 0.6; timeMs += 1000) {
      visuals.update(timeMs, null)
      if ((timeMs - START_MS) % 97_000 !== 0) continue
      const below = satelliteDirection(timeMs).multiplyScalar(1.003)
      expect(distanceToPathKm(below, trackVertices(visuals))).toBeLessThan(1)
    }
    visuals.dispose()
  })

  it('does not rotate with the orbit line: it is fixed to the Earth', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    visuals.update(START_MS, null)
    const before = trackVertices(visuals)[100]!.clone()

    visuals.update(START_MS + 15_000, null)
    expect(trackVertices(visuals)[100]!.distanceTo(before)).toBe(0)
    expect(trackLine(visuals).rotation.y).toBe(0)
    visuals.dispose()
  })

  it('carries distances along the line for the dashes', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    visuals.update(START_MS, null)

    const distances = trackLine(visuals).geometry.getAttribute('lineDistance')
    expect(distances.getX(0)).toBe(0)
    for (let i = 1; i < 361; i++) expect(distances.getX(i)).toBeGreaterThan(distances.getX(i - 1))
    // Two orbits of ground track is a bit under two circumferences (4 pi radii).
    expect(distances.getX(360)).toBeGreaterThan(11)
    expect(distances.getX(360)).toBeLessThan(4 * Math.PI * 1.003)
    visuals.dispose()
  })

  it('is cleared with the selection', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    visuals.update(START_MS, null)
    visuals.setTarget(null)
    expect(trackLine(visuals).geometry.drawRange.count).toBe(0)
    visuals.dispose()
  })
})
