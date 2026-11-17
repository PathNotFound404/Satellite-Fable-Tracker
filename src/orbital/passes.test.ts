import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSatelliteFile } from '../types/satellite-data'
import { EARTH_RADIUS_KM } from './constants'
import { gmstRadFromUnixMs } from './frames'
import { elevationDeg, elevationDegOfEcf, findPasses, observerFrame, type Observer } from './passes'
import { createSatrec, propagateEcf } from './propagation'

const sample = parseSatelliteFile(
  JSON.parse(readFileSync(new URL('../../public/data/sample.json', import.meta.url), 'utf8')),
)
const satrecFor = (noradId: number) =>
  createSatrec(sample.satellites.find((record) => record.NORAD_CAT_ID === noradId)!)!
const iss = satrecFor(25544)
const terra = satrecFor(25994)

const GREENWICH: Observer = { latitudeDeg: 51.4769, longitudeDeg: -0.0005 }
const SYDNEY: Observer = { latitudeDeg: -33.8688, longitudeDeg: 151.2093 }

/** 2026-11-16T14:00:00Z, shortly after the sample data's epochs. */
const START_MS = Date.UTC(2026, 10, 16, 14)

/**
 * Independent predictions: Skyfield 1.55 (`EarthSatellite.from_omm` on the same records
 * from sample.json, `find_events` at 0 degrees, WGS84 observer at zero height), for the
 * 24 hours from START_MS. Skyfield has its own SGP4 build, its own Earth rotation and
 * its own observer geometry. Only passes peaking at 10 degrees or more are listed.
 * Columns: rise, peak, set (Unix ms), peak elevation (degrees).
 */
const REFERENCE = [
  {
    name: 'ISS over Greenwich',
    satrec: iss,
    observer: GREENWICH,
    passes: [
      [1794847454144, 1794847745775, 1794848039156, 18.16],
      [1794853202342, 1794853525889, 1794853851452, 61.76],
      [1794859005335, 1794859331885, 1794859659685, 85.22],
      [1794864811999, 1794865136002, 1794865460016, 53.39],
      [1794870627701, 1794870911315, 1794871194472, 14.97],
    ],
  },
  {
    name: 'ISS over Sydney',
    satrec: iss,
    observer: SYDNEY,
    passes: [
      [1794849870903, 1794850192404, 1794850518092, 38.32],
      [1794855699892, 1794856005913, 1794856314753, 19.96],
      [1794873406413, 1794873688976, 1794873968532, 12.56],
      [1794879188803, 1794879521479, 1794879848152, 86.68],
    ],
  },
  {
    name: 'Terra over Greenwich',
    satrec: terra,
    observer: GREENWICH,
    passes: [
      [1794855525553, 1794855923427, 1794856323651, 36.36],
      [1794861376216, 1794861775894, 1794862179085, 33.66],
      [1794904069294, 1794904479232, 1794904885487, 42.0],
      [1794909931048, 1794910322205, 1794910711580, 29.85],
    ],
  },
  {
    name: 'Terra over Sydney',
    satrec: terra,
    observer: SYDNEY,
    passes: [
      [1794864098106, 1794864494033, 1794864895296, 33.35],
      [1794869973407, 1794870344955, 1794870723140, 19.98],
      [1794907419610, 1794907749787, 1794908075417, 11.33],
      [1794913200234, 1794913618372, 1794914029930, 57.44],
    ],
  },
] as const

describe('observerFrame', () => {
  it('puts an observer on the equator one equatorial radius out', () => {
    const frame = observerFrame({ latitudeDeg: 0, longitudeDeg: 0 })
    expect(frame.xKm).toBeCloseTo(EARTH_RADIUS_KM, 6)
    expect(frame.yKm).toBeCloseTo(0, 6)
    expect(frame.zKm).toBeCloseTo(0, 6)
    expect([frame.upX, frame.upY, frame.upZ]).toEqual([1, 0, 0])
  })

  it('puts an observer at the pole one polar radius out', () => {
    const frame = observerFrame({ latitudeDeg: 90, longitudeDeg: 0 })
    // WGS84 polar radius.
    expect(frame.zKm).toBeCloseTo(6356.7523, 3)
    expect(Math.hypot(frame.xKm, frame.yKm)).toBeLessThan(1e-9)
  })

  it('measures longitude east positive and adds height along the vertical', () => {
    const frame = observerFrame({ latitudeDeg: 0, longitudeDeg: 90, heightKm: 2 })
    expect(frame.xKm).toBeCloseTo(0, 6)
    expect(frame.yKm).toBeCloseTo(EARTH_RADIUS_KM + 2, 6)
  })
})

describe('elevationDegOfEcf', () => {
  const frame = observerFrame({ latitudeDeg: 0, longitudeDeg: 0 })

  it('is 90 degrees straight overhead', () => {
    expect(elevationDegOfEcf(frame, EARTH_RADIUS_KM + 400, 0, 0)).toBeCloseTo(90, 6)
  })

  it('is 0 on the horizon and negative below it', () => {
    expect(elevationDegOfEcf(frame, EARTH_RADIUS_KM, 500, 0)).toBeCloseTo(0, 6)
    expect(elevationDegOfEcf(frame, -EARTH_RADIUS_KM - 400, 0, 0)).toBeCloseTo(-90, 6)
  })

  it('is 45 degrees for a point as far up as it is along', () => {
    expect(elevationDegOfEcf(frame, EARTH_RADIUS_KM + 300, 0, 300)).toBeCloseTo(45, 6)
  })
})

describe('findPasses', () => {
  it.each(REFERENCE)('matches an independent prediction: $name', ({ satrec, observer, passes }) => {
    const found = findPasses(satrec, observer, START_MS)
    expect(found).toHaveLength(passes.length)
    found.forEach((pass, i) => {
      const [riseMs, peakMs, setMs, peakElevationDeg] = passes[i]!
      // The agreed bar is about a minute; in practice the two agree within seconds.
      expect(Math.abs(pass.riseMs - riseMs)).toBeLessThan(5_000)
      expect(Math.abs(pass.setMs - setMs)).toBeLessThan(5_000)
      expect(Math.abs(pass.peakMs - peakMs)).toBeLessThan(5_000)
      expect(Math.abs(pass.peakElevationDeg - peakElevationDeg)).toBeLessThan(0.2)
      expect(pass.startsBeforeWindow).toBe(false)
      expect(pass.endsAfterWindow).toBe(false)
    })
  })

  it('returns passes in time order, each rising before its peak and setting after', () => {
    const found = findPasses(iss, GREENWICH, START_MS)
    let previousSetMs = START_MS
    for (const pass of found) {
      expect(pass.riseMs).toBeGreaterThanOrEqual(previousSetMs)
      expect(pass.peakMs).toBeGreaterThan(pass.riseMs)
      expect(pass.setMs).toBeGreaterThan(pass.peakMs)
      previousSetMs = pass.setMs
    }
  })

  it('reports the horizon crossing itself at rise and set', () => {
    const frame = observerFrame(GREENWICH)
    for (const pass of findPasses(iss, GREENWICH, START_MS)) {
      // Half a second of ISS motion near the horizon is a few hundredths of a degree.
      expect(Math.abs(elevationDeg(iss, frame, pass.riseMs))).toBeLessThan(0.05)
      expect(Math.abs(elevationDeg(iss, frame, pass.setMs))).toBeLessThan(0.05)
    }
  })

  it('applies the minimum peak elevation', () => {
    const all = findPasses(iss, GREENWICH, START_MS, { minPeakElevationDeg: 0 })
    const high = findPasses(iss, GREENWICH, START_MS, { minPeakElevationDeg: 50 })
    // The reference lists a sixth pass peaking under a degree.
    expect(all).toHaveLength(6)
    expect(high.map((pass) => Math.round(pass.peakElevationDeg))).toEqual([62, 85, 53])
  })

  it('flags a pass already in progress when the window starts', () => {
    const [first] = findPasses(iss, GREENWICH, START_MS)
    const [inProgress] = findPasses(iss, GREENWICH, first!.riseMs + 60_000)
    expect(inProgress!.startsBeforeWindow).toBe(true)
    expect(inProgress!.riseMs).toBe(first!.riseMs + 60_000)
    expect(Math.abs(inProgress!.setMs - first!.setMs)).toBeLessThan(1_000)
  })

  it('flags a pass still in progress when the window ends', () => {
    const [first] = findPasses(iss, GREENWICH, START_MS)
    const windowMs = first!.peakMs + 60_000 - START_MS
    const found = findPasses(iss, GREENWICH, START_MS, { windowMs })
    expect(found).toHaveLength(1)
    expect(found[0]!.endsAfterWindow).toBe(true)
    expect(found[0]!.setMs).toBe(START_MS + windowMs)
    expect(Math.abs(found[0]!.peakMs - first!.peakMs)).toBeLessThan(1_000)
  })

  it('reports a geostationary satellite as up for the whole window, or not at all', () => {
    const geo = sample.satellites.find(
      (record) => Math.abs(record.MEAN_MOTION - 1.0027) < 0.001 && record.INCLINATION < 1,
    )!
    const satrec = createSatrec(geo)!
    const ecf = new Float64Array(6)
    propagateEcf(satrec, START_MS, gmstRadFromUnixMs(START_MS), ecf)
    const longitudeDeg = (Math.atan2(ecf[1]!, ecf[0]!) * 180) / Math.PI

    const below = findPasses(satrec, { latitudeDeg: 0, longitudeDeg }, START_MS)
    expect(below).toHaveLength(1)
    expect(below[0]!.startsBeforeWindow).toBe(true)
    expect(below[0]!.endsAfterWindow).toBe(true)
    expect(below[0]!.peakElevationDeg).toBeGreaterThan(85)

    const farSide = findPasses(satrec, { latitudeDeg: 0, longitudeDeg: longitudeDeg + 180 }, START_MS)
    expect(farSide).toEqual([])
  })

  it('finds nothing where the orbit never reaches', () => {
    // The ISS (inclination 51.6 degrees) never rises 10 degrees above the South Pole's horizon.
    expect(findPasses(iss, { latitudeDeg: -90, longitudeDeg: 0 }, START_MS)).toEqual([])
  })
})
