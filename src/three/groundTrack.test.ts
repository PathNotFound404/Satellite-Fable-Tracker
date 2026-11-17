import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import type { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
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

type Visuals = ReturnType<typeof createSelectionVisuals>

function trackLine(visuals: Visuals, half: 'past' | 'ahead'): LineSegments2 {
  return visuals.object.getObjectByName('ground-track-' + half) as LineSegments2
}

/** The points of one half in order: the start of each segment, then the last end. */
function halfVertices(visuals: Visuals, half: 'past' | 'ahead'): Vector3[] {
  const line = trackLine(visuals, half)
  visuals.object.updateMatrixWorld(true)
  const starts = line.geometry.getAttribute('instanceStart')
  const ends = line.geometry.getAttribute('instanceEnd')
  const count = line.geometry.instanceCount
  const vertices: Vector3[] = []
  for (let i = 0; i < count; i++) {
    vertices.push(new Vector3().fromBufferAttribute(starts, i).applyMatrix4(line.matrixWorld))
  }
  if (count > 0) {
    vertices.push(new Vector3().fromBufferAttribute(ends, count - 1).applyMatrix4(line.matrixWorld))
  }
  return vertices
}

/** The whole track, oldest point first. The two halves share the middle point. */
function trackVertices(visuals: Visuals): Vector3[] {
  return [...halfVertices(visuals, 'past'), ...halfVertices(visuals, 'ahead').slice(1)]
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

    visuals.update(START_MS + 3_000, null)
    expect(trackVertices(visuals)[100]!.distanceTo(before)).toBe(0)
    expect(trackLine(visuals, 'past').rotation.y).toBe(0)
    expect(trackLine(visuals, 'ahead').rotation.y).toBe(0)
    visuals.dispose()
  })

  it('shows direction: solid behind the satellite, dashed ahead, joined at the present', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    visuals.update(START_MS, null)

    const past = halfVertices(visuals, 'past')
    const ahead = halfVertices(visuals, 'ahead')
    expect(past).toHaveLength(181)
    expect(ahead).toHaveLength(181)
    const now = satelliteDirection(START_MS)
    expect(past[180]!.angleTo(now)).toBeLessThan(1e-4)
    expect(ahead[0]!.distanceTo(past[180]!)).toBe(0)
    expect(past[0]!.angleTo(satelliteDirection(START_MS - PERIOD_MS))).toBeLessThan(1e-4)
    expect(ahead[180]!.angleTo(satelliteDirection(START_MS + PERIOD_MS))).toBeLessThan(1e-4)

    const pastMaterial = trackLine(visuals, 'past').material
    const aheadMaterial = trackLine(visuals, 'ahead').material
    expect(pastMaterial.dashed).toBe(false)
    expect(aheadMaterial.dashed).toBe(true)
    expect(aheadMaterial.opacity).toBeGreaterThan(pastMaterial.opacity)
    visuals.dispose()
  })

  it('is two pixels wide and not white or the accent colour', () => {
    const visuals = createSelectionVisuals(1)
    for (const half of ['past', 'ahead'] as const) {
      const material = trackLine(visuals, half).material
      expect(material.linewidth).toBe(2)
      expect(material.worldUnits).toBe(false)
      expect(material.color.getHex()).toBe(0xffd60a)
    }
    visuals.dispose()
  })

  it('keeps the join close to the satellite as time runs', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    for (let timeMs = START_MS; timeMs < START_MS + 60_000; timeMs += 500) {
      visuals.update(timeMs, null)
      const join = halfVertices(visuals, 'ahead')[0]!
      const below = satelliteDirection(timeMs).multiplyScalar(1.003)
      // The ISS covers about 7.2 km of ground per second; the track is re-centred
      // every 5 s.
      expect(sceneToKm(join.distanceTo(below))).toBeLessThan(40)
    }
    visuals.dispose()
  })

  it('carries distances along the dashed half, starting from the satellite', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    visuals.update(START_MS, null)

    const geometry = trackLine(visuals, 'ahead').geometry
    const starts = geometry.getAttribute('instanceDistanceStart')
    const ends = geometry.getAttribute('instanceDistanceEnd')
    expect(starts.getX(0)).toBe(0)
    for (let i = 0; i < 180; i++) {
      expect(ends.getX(i)).toBeGreaterThan(starts.getX(i))
      if (i > 0) expect(starts.getX(i)).toBe(ends.getX(i - 1))
    }
    // One orbit of ground track is a bit under one circumference (2 pi radii).
    expect(ends.getX(179)).toBeGreaterThan(5.5)
    expect(ends.getX(179)).toBeLessThan(2 * Math.PI * 1.003)
    visuals.dispose()
  })

  it('is cleared with the selection', () => {
    const visuals = createSelectionVisuals(1)
    visuals.setTarget(iss)
    visuals.update(START_MS, null)
    visuals.setTarget(null)
    expect(trackLine(visuals, 'past').geometry.instanceCount).toBe(0)
    expect(trackLine(visuals, 'ahead').geometry.instanceCount).toBe(0)
    visuals.dispose()
  })
})
