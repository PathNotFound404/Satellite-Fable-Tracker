import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSatelliteFile, type OmmRecord } from '../types/satellite-data'
import { EARTH_RADIUS_KM } from './constants'
import {
  createConjunctionScan,
  findCloseApproaches,
  radiusRangeKm,
  separationKm,
  type CloseApproach,
} from './conjunctions'
import { createSatrec, propagateTeme, type SatRec } from './propagation'

const sample = parseSatelliteFile(
  JSON.parse(readFileSync(new URL('../../public/data/sample.json', import.meta.url), 'utf8')),
)
const issRecord = sample.satellites.find((record) => record.NORAD_CAT_ID === 25544)!

/** 2026-11-16T14:00:00Z, shortly after the sample data's epochs. */
const START_MS = Date.UTC(2026, 10, 16, 14)
const HOUR_MS = 3_600_000

/**
 * The sample catalog plus copies of the ISS on crossing orbits (other inclinations and
 * orbital planes at the same height), so there are plenty of fast, close passes.
 */
const crossers: OmmRecord[] = []
for (const inclination of [28, 74, 97, 141]) {
  for (let plane = 0; plane < 6; plane++) {
    crossers.push({
      ...issRecord,
      OBJECT_NAME: `CROSSER ${inclination}/${plane}`,
      NORAD_CAT_ID: 900000 + crossers.length,
      INCLINATION: inclination,
      RA_OF_ASC_NODE: (issRecord.RA_OF_ASC_NODE + plane * 60) % 360,
      MEAN_ANOMALY: (issRecord.MEAN_ANOMALY + plane * 47 + inclination) % 360,
    })
  }
}
const records = [...sample.satellites, ...crossers]
const satrecs: SatRec[] = records.map((record) => createSatrec(record)!)
const issIndex = records.indexOf(issRecord)

/**
 * The slow, obvious way: step both satellites a second at a time and note every local
 * minimum of the distance. Shares only SGP4 with the code under test.
 */
function bruteForce(targetIndex: number, windowMs: number, thresholdKm: number): CloseApproach[] {
  const found: CloseApproach[] = []
  const a = new Float64Array(6)
  const b = new Float64Array(6)
  const seconds = windowMs / 1000
  const targetStates = new Float64Array((seconds + 1) * 6)
  for (let s = 0; s <= seconds; s++) {
    propagateTeme(satrecs[targetIndex]!, START_MS + s * 1000, a)
    targetStates.set(a, s * 6)
  }
  for (let index = 0; index < satrecs.length; index++) {
    if (index === targetIndex) continue
    let twoBack = Number.NaN
    let oneBack = Number.NaN
    let oneBackSpeed = 0
    for (let s = 0; s <= seconds; s++) {
      propagateTeme(satrecs[index]!, START_MS + s * 1000, b)
      const o = s * 6
      const distance = Math.hypot(b[0]! - targetStates[o]!, b[1]! - targetStates[o + 1]!, b[2]! - targetStates[o + 2]!)
      const speed = Math.hypot(b[3]! - targetStates[o + 3]!, b[4]! - targetStates[o + 4]!, b[5]! - targetStates[o + 5]!)
      if (oneBack < twoBack && oneBack <= distance && oneBack < thresholdKm && oneBackSpeed >= 0.1) {
        found.push({ index, timeMs: START_MS + (s - 1) * 1000, distanceKm: oneBack, relativeSpeedKmS: oneBackSpeed })
      }
      twoBack = oneBack
      oneBack = distance
      oneBackSpeed = speed
    }
  }
  return found
}

describe('radiusRangeKm', () => {
  it('puts the ISS a little over 400 km up, nearly circular', () => {
    const { perigeeKm, apogeeKm } = radiusRangeKm(satrecs[issIndex]!)
    expect(perigeeKm - EARTH_RADIUS_KM).toBeGreaterThan(380)
    expect(apogeeKm - EARTH_RADIUS_KM).toBeLessThan(450)
    expect(apogeeKm - perigeeKm).toBeLessThan(15)
  })

  it('puts a geostationary satellite about 42,164 km from the centre', () => {
    const geo = records.findIndex((record) => Math.abs(record.MEAN_MOTION - 1.0027) < 0.001)
    const { perigeeKm, apogeeKm } = radiusRangeKm(satrecs[geo]!)
    expect((perigeeKm + apogeeKm) / 2).toBeCloseTo(42164, -2)
  })
})

describe('findCloseApproaches', () => {
  const WINDOW_MS = 6 * HOUR_MS
  const THRESHOLD_KM = 900
  const options = { windowMs: WINDOW_MS, thresholdKm: THRESHOLD_KM, maxResults: 10_000 }
  const found = findCloseApproaches(satrecs, issIndex, START_MS, options)
  const reference = bruteForce(issIndex, WINDOW_MS, THRESHOLD_KM)

  it('has something to check', () => {
    expect(reference.length).toBeGreaterThan(20)
  })

  it('finds every approach a second-by-second search finds', () => {
    // Leave out the first and last minute and approaches right at the threshold, where
    // the two methods can fairly disagree about whether one counts.
    const clear = reference.filter(
      (approach) =>
        approach.distanceKm < THRESHOLD_KM - 5 &&
        approach.timeMs > START_MS + 60_000 &&
        approach.timeMs < START_MS + WINDOW_MS - 60_000,
    )
    for (const expected of clear) {
      const match = found.find(
        (approach) => approach.index === expected.index && Math.abs(approach.timeMs - expected.timeMs) < 1_500,
      )
      expect(match, `${records[expected.index]!.OBJECT_NAME} at ${expected.distanceKm.toFixed(1)} km`).toBeDefined()
      // A one-second grid overestimates the minimum slightly.
      expect(Math.abs(match!.distanceKm - expected.distanceKm)).toBeLessThan(1)
      expect(Math.abs(match!.relativeSpeedKmS - expected.relativeSpeedKmS)).toBeLessThan(0.05)
    }
  })

  it('reports nothing the second-by-second search does not also see', () => {
    for (const approach of found) {
      const match = reference.find(
        (expected) => expected.index === approach.index && Math.abs(expected.timeMs - approach.timeMs) < 1_500,
      )
      const atEdge = approach.timeMs < START_MS + 2_000 || approach.timeMs > START_MS + WINDOW_MS - 2_000
      const atThreshold = approach.distanceKm > THRESHOLD_KM - 5
      expect(match !== undefined || atEdge || atThreshold, records[approach.index]!.OBJECT_NAME).toBe(true)
    }
  })

  it('reports the true distance at the reported time, and that time is a minimum', () => {
    for (const approach of found.slice(0, 30)) {
      const other = satrecs[approach.index]!
      const target = satrecs[issIndex]!
      expect(separationKm(target, other, approach.timeMs)).toBeCloseTo(approach.distanceKm, 6)
      expect(separationKm(target, other, approach.timeMs - 500)).toBeGreaterThanOrEqual(approach.distanceKm)
      expect(separationKm(target, other, approach.timeMs + 500)).toBeGreaterThanOrEqual(approach.distanceKm)
    }
  })

  it('sorts closest first and honours the limit and the threshold', () => {
    const top = findCloseApproaches(satrecs, issIndex, START_MS, { ...options, thresholdKm: 300, maxResults: 3 })
    expect(top.length).toBeLessThanOrEqual(3)
    for (const approach of top) expect(approach.distanceKm).toBeLessThan(300)
    expect([...top].sort((a, b) => a.distanceKm - b.distanceKm)).toEqual(top)
    expect(top[0]!.distanceKm).toBeCloseTo(found[0]!.distanceKm, 6)
  })

  it('leaves out modules docked to the target', () => {
    // The sample has other parts of the ISS, which sit within metres of it all day.
    const docked = records
      .map((record, index) => ({ record, index }))
      .filter(({ index }) => index !== issIndex && separationKm(satrecs[issIndex]!, satrecs[index]!, START_MS) < 5)
    expect(docked.length).toBeGreaterThan(0)
    for (const { index } of docked) expect(found.some((approach) => approach.index === index)).toBe(false)
  })

  it('never reports the target itself', () => {
    expect(found.some((approach) => approach.index === issIndex)).toBe(false)
  })

  it('finds nothing for a geostationary target among low orbits', () => {
    const geo = records.findIndex((record) => Math.abs(record.MEAN_MOTION - 1.0027) < 0.001)
    const approaches = findCloseApproaches(satrecs, geo, START_MS, { windowMs: WINDOW_MS, thresholdKm: 50 })
    for (const approach of approaches) {
      // Only another geostationary satellite can be near it.
      expect(records[approach.index]!.MEAN_MOTION).toBeLessThan(1.1)
    }
  })
})

describe('createConjunctionScan', () => {
  const options = { windowMs: 2 * HOUR_MS, thresholdKm: 400, maxResults: 10_000 }

  it('gives the same answer in slices as in one go', () => {
    const whole = findCloseApproaches(satrecs, issIndex, START_MS, options)
    const scan = createConjunctionScan(satrecs, issIndex, START_MS, options)
    // A budget of zero still does one candidate per call, so it always finishes.
    let calls = 0
    let lastProgress = 0
    while (!scan.step(0)) {
      calls++
      expect(scan.progress()).toBeGreaterThanOrEqual(lastProgress)
      lastProgress = scan.progress()
    }
    expect(calls).toBeGreaterThan(5)
    expect(scan.progress()).toBe(1)
    expect(scan.results()).toEqual(whole)
  })

  it('does no work until stepped', () => {
    const scan = createConjunctionScan(satrecs, issIndex, START_MS, options)
    expect(scan.progress()).toBe(0)
    expect(scan.results()).toEqual([])
  })
})
