import { readFileSync } from 'node:fs'
import { eciToEcf, eciToGeodetic, twoline2satrec } from 'satellite.js'
import { describe, expect, it } from 'vitest'
import { parseSatelliteFile, type OmmRecord } from '../types/satellite-data'
import { buildCatalog } from './catalog'
import { EARTH_RADIUS_KM, MS_PER_MINUTE } from './constants'
import { gmstRadFromUnixMs, julianDateFromUnixMs, temeStateToEcf } from './frames'
import {
  altitudeKm,
  createSatrec,
  epochUnixMs,
  periodMinutes,
  propagateEcf,
  propagateTeme,
  speedKmS,
} from './propagation'

const sample = parseSatelliteFile(
  JSON.parse(readFileSync(new URL('../../public/data/sample.json', import.meta.url), 'utf8')),
)
const issRecord = sample.satellites.find((record) => record.NORAD_CAT_ID === 25544)!

/**
 * Published SGP4 verification case: satellite 00005 from Vallado's SGP4-VER.TLE, with
 * the expected TEME states from the accompanying reference output (tcppver.out), as
 * distributed with "Revisiting Spacetrack Report #3" (Vallado, Crawford, Hujsak, Kelso,
 * 2006). Columns: minutes since epoch, position (km), velocity (km/s).
 */
const VALLADO_00005 = {
  line1: '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753',
  line2: '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667',
  states: [
    [0, 7022.46529266, -1400.08296755, 0.03995155, 1.893841015, 6.405893759, 4.534807250],
    [360, -7154.03120202, -3783.17682504, -3536.19412294, 4.741887409, -4.151817765, -2.093935425],
  ],
} as const

describe('propagateTeme', () => {
  it.each(VALLADO_00005.states)(
    "matches Vallado's SGP4 verification output for satellite 00005 at t = %i min",
    (minutes, x, y, z, vx, vy, vz) => {
      const satrec = twoline2satrec(VALLADO_00005.line1, VALLADO_00005.line2)
      const out = new Float64Array(6)
      const ok = propagateTeme(satrec, epochUnixMs(satrec) + minutes * MS_PER_MINUTE, out)

      expect(ok).toBe(true)
      // Reference values are printed to 8 and 9 decimals; allow a millimetre and a
      // micrometre per second for the Julian date round trip.
      expect(out[0]).toBeCloseTo(x, 5)
      expect(out[1]).toBeCloseTo(y, 5)
      expect(out[2]).toBeCloseTo(z, 5)
      expect(out[3]).toBeCloseTo(vx, 8)
      expect(out[4]).toBeCloseTo(vy, 8)
      expect(out[5]).toBeCloseTo(vz, 8)
    },
  )

  it('leaves the output untouched and returns false for a decayed satellite', () => {
    // Vallado's verification case 28350: decays about 1460 minutes after epoch.
    const satrec = twoline2satrec(
      '1 28350U 04020A   06167.21788666  .16154492  76267-5  18678-3 0  8894',
      '2 28350  64.9977 345.6130 0024870 260.7578  99.9590 16.47856722116490',
    )
    const out = new Float64Array(6).fill(7)

    expect(propagateTeme(satrec, epochUnixMs(satrec), out)).toBe(true)
    out.fill(7)
    expect(propagateTeme(satrec, epochUnixMs(satrec) + 3000 * MS_PER_MINUTE, out)).toBe(false)
    expect(Array.from(out)).toEqual([7, 7, 7, 7, 7, 7])
  })
})

describe('createSatrec', () => {
  it('builds a record from OMM JSON that propagates at its own epoch', () => {
    const satrec = createSatrec(issRecord)
    expect(satrec).not.toBeNull()
    const out = new Float64Array(6)
    expect(propagateTeme(satrec!, epochUnixMs(satrec!), out)).toBe(true)
  })

  it('reads the OMM epoch as UTC', () => {
    const satrec = createSatrec(issRecord)!
    expect(epochUnixMs(satrec)).toBeCloseTo(Date.parse(`${issRecord.EPOCH}Z`), -1)
  })

  it.each<[string, Partial<OmmRecord>]>([
    ['eccentricity of 1 or more', { ECCENTRICITY: 1.2 }],
    ['negative mean motion', { MEAN_MOTION: -1 }],
    ['an unparseable epoch', { EPOCH: 'garbage' }],
  ])('returns null instead of throwing for %s', (_label, patch) => {
    expect(createSatrec({ ...issRecord, ...patch })).toBeNull()
  })
})

describe('temeStateToEcf', () => {
  /**
   * Vallado's worked TEME example ("Revisiting Spacetrack Report #3", Appendix C):
   * 2004-04-06 07:51:28.386009 UTC, with UT1-UTC = -0.4399619 s.
   */
  const epochUtcMs = Date.UTC(2004, 3, 6, 7, 51, 28, 386) + 0.009
  const UT1_MINUS_UTC_MS = -439.9619
  const teme = [5094.1801621, 6127.6446595, 6380.3445327, -4.746131487, 0.785818041, 5.531931288]
  const pef = [-1033.4750313, 7901.3055856, 6380.3445327, -3.225632747, -2.872442511, 5.531931288]
  const itrf = [-1033.479383, 7901.2952754, 6380.3565958]

  it("matches Vallado's PEF position and velocity when given UT1", () => {
    const out = new Float64Array(6)
    temeStateToEcf(teme, gmstRadFromUnixMs(epochUtcMs + UT1_MINUS_UTC_MS), out)

    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(pef[i]!, 4)
    for (let i = 3; i < 6; i++) expect(out[i]).toBeCloseTo(pef[i]!, 7)
  })

  it('is within 0.5 km of ITRF using plain UTC, as the app does', () => {
    const out = new Float64Array(6)
    temeStateToEcf(teme, gmstRadFromUnixMs(epochUtcMs), out)

    const errorKm = Math.hypot(out[0]! - itrf[0]!, out[1]! - itrf[1]!, out[2]! - itrf[2]!)
    expect(errorKm).toBeLessThan(0.5)
  })

  it('agrees with satellite.js eciToEcf for position', () => {
    const gmst = 1.2345
    const out = new Float64Array(6)
    temeStateToEcf(teme, gmst, out)
    const expected = eciToEcf({ x: teme[0]!, y: teme[1]!, z: teme[2]! }, gmst)

    expect(out[0]).toBeCloseTo(expected.x, 9)
    expect(out[1]).toBeCloseTo(expected.y, 9)
    expect(out[2]).toBeCloseTo(expected.z, 9)
  })

  it('preserves the radius and can write in place', () => {
    const state = Float64Array.from(teme)
    temeStateToEcf(state, 2.5, state)
    expect(Math.hypot(state[0]!, state[1]!, state[2]!)).toBeCloseTo(
      Math.hypot(teme[0]!, teme[1]!, teme[2]!),
      8,
    )
  })

  it('gives a velocity that is the rate of change of ECF position', () => {
    // Finite difference of propagated ECF positions one second apart.
    const satrec = createSatrec(issRecord)!
    const t = epochUnixMs(satrec) + 10 * MS_PER_MINUTE
    const before = new Float64Array(6)
    const at = new Float64Array(6)
    const after = new Float64Array(6)
    propagateEcf(satrec, t - 500, gmstRadFromUnixMs(t - 500), before)
    propagateEcf(satrec, t, gmstRadFromUnixMs(t), at)
    propagateEcf(satrec, t + 500, gmstRadFromUnixMs(t + 500), after)

    for (let i = 0; i < 3; i++) {
      expect(at[i + 3]).toBeCloseTo(after[i]! - before[i]!, 4)
    }
  })
})

describe('julianDateFromUnixMs', () => {
  it('matches known Julian dates', () => {
    expect(julianDateFromUnixMs(0)).toBe(2440587.5)
    // J2000.0 epoch: 2000-01-01T12:00:00 (TT, close enough to UTC for this check).
    expect(julianDateFromUnixMs(Date.UTC(2000, 0, 1, 12))).toBe(2451545)
  })
})

describe('ISS position against an independent source', () => {
  /**
   * Reference: wheretheiss.at API (its own TLE source and propagator), queried
   * 2026-11-16 for Unix time 1794860000 (2026-11-16T20:13:20Z):
   * latitude 34.269514, longitude 52.970115, altitude 421.611599 km.
   * The elements in sample.json were fetched from CelesTrak a few minutes later.
   */
  const reference = { unixMs: 1794860000_000, latitudeDeg: 34.269514, longitudeDeg: 52.970115, altitudeKm: 421.611599 }

  it('agrees within a few km', () => {
    const satrec = createSatrec(issRecord)!
    const teme = new Float64Array(6)
    expect(propagateTeme(satrec, reference.unixMs, teme)).toBe(true)

    const gmst = gmstRadFromUnixMs(reference.unixMs)
    const geodetic = eciToGeodetic({ x: teme[0]!, y: teme[1]!, z: teme[2]! }, gmst)
    const latitudeDeg = (geodetic.latitude * 180) / Math.PI
    const longitudeDeg = (geodetic.longitude * 180) / Math.PI

    // 0.03 degrees of latitude is about 3.3 km on the ground.
    expect(Math.abs(latitudeDeg - reference.latitudeDeg)).toBeLessThan(0.03)
    expect(Math.abs(longitudeDeg - reference.longitudeDeg)).toBeLessThan(0.04)
    expect(Math.abs(geodetic.height - reference.altitudeKm)).toBeLessThan(3)

    // And our own Earth-fixed conversion puts it at the same longitude.
    const ecf = new Float64Array(6)
    temeStateToEcf(teme, gmst, ecf)
    const ecfLongitudeDeg = (Math.atan2(ecf[1]!, ecf[0]!) * 180) / Math.PI
    expect(ecfLongitudeDeg).toBeCloseTo(longitudeDeg, 6)
  })

  it('has a plausible altitude and speed', () => {
    const satrec = createSatrec(issRecord)!
    const teme = new Float64Array(6)
    propagateTeme(satrec, reference.unixMs, teme)

    const altitude = altitudeKm(teme[0]!, teme[1]!, teme[2]!)
    expect(altitude).toBeGreaterThan(395)
    expect(altitude).toBeLessThan(440)
    expect(speedKmS(teme[3]!, teme[4]!, teme[5]!)).toBeCloseTo(7.66, 1)
    expect(periodMinutes(issRecord.MEAN_MOTION)).toBeCloseTo(92.9, 0)
  })
})

describe('helpers', () => {
  it('altitude is distance from the centre minus the Earth radius', () => {
    expect(altitudeKm(EARTH_RADIUS_KM + 400, 0, 0)).toBeCloseTo(400, 9)
    expect(altitudeKm(0, 3000, 4000)).toBeCloseTo(5000 - EARTH_RADIUS_KM, 9)
  })

  it('speed is the vector magnitude', () => {
    expect(speedKmS(3, 4, 12)).toBe(13)
  })

  it('period comes from mean motion', () => {
    expect(periodMinutes(1.00273791)).toBeCloseTo(1436.07, 1)
  })
})

describe('buildCatalog', () => {
  it('indexes every sample satellite and resolves groups to indices', () => {
    const catalog = buildCatalog(sample)

    expect(catalog.count).toBe(sample.count)
    expect(catalog.droppedCount).toBe(0)
    expect(catalog.satrecs).toHaveLength(catalog.count)

    const issIndex = catalog.indexByNoradId.get(25544)!
    expect(catalog.records[issIndex]!.OBJECT_NAME).toBe('ISS (ZARYA)')
    expect(Array.from(catalog.groupIndices.stations)).toContain(issIndex)
    for (const index of catalog.groupIndices.starlink) {
      expect(catalog.records[index]!.OBJECT_NAME).toMatch(/^STARLINK/)
    }
  })

  it('drops unusable records and keeps indices dense', () => {
    const broken: OmmRecord = { ...issRecord, NORAD_CAT_ID: 1, ECCENTRICITY: 1.5 }
    const catalog = buildCatalog({
      ...sample,
      count: sample.count + 1,
      satellites: [broken, ...sample.satellites],
      groups: { ...sample.groups, stations: [1, ...sample.groups.stations] },
    })

    expect(catalog.droppedCount).toBe(1)
    expect(catalog.count).toBe(sample.count)
    expect(catalog.indexByNoradId.has(1)).toBe(false)
    expect(catalog.groupIndices.stations).toHaveLength(sample.groups.stations.length)
  })
})
