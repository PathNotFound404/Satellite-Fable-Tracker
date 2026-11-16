import { describe, expect, it } from 'vitest'
import { subSolarPoint, sunDirectionEcf } from './sun'

/** Smallest signed difference between two longitudes, degrees. */
function longitudeDifference(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180
}

describe('subSolarPoint', () => {
  it('matches an independent source', () => {
    // wheretheiss.at API, queried 2026-11-16 for Unix time 1794860000
    // (2026-11-16T20:13:20Z): solar_lat -18.889150, solar_lon 232.870598 (east).
    const point = subSolarPoint(1794860000_000)
    expect(point.latitudeDeg).toBeCloseTo(-18.889, 1)
    expect(Math.abs(longitudeDifference(point.longitudeDeg, 232.870598))).toBeLessThan(0.2)
  })

  it('is on the equator at the March equinox', () => {
    // March equinox 2024: 20 March 03:06 UTC.
    const point = subSolarPoint(Date.UTC(2024, 2, 20, 3, 6))
    expect(Math.abs(point.latitudeDeg)).toBeLessThan(0.05)
  })

  it('reaches the Tropic of Cancer at the June solstice', () => {
    // June solstice 2024: 20 June 20:51 UTC.
    const point = subSolarPoint(Date.UTC(2024, 5, 20, 20, 51))
    expect(point.latitudeDeg).toBeCloseTo(23.44, 1)
  })

  it('reaches the Tropic of Capricorn at the December solstice', () => {
    // December solstice 2024: 21 December 09:21 UTC.
    const point = subSolarPoint(Date.UTC(2024, 11, 21, 9, 21))
    expect(point.latitudeDeg).toBeCloseTo(-23.44, 1)
  })

  it('is near the Greenwich meridian at noon UTC, offset by the equation of time', () => {
    // Mid-April the equation of time is near zero, so the Sun is overhead within a
    // degree of longitude 0 at 12:00 UTC.
    const april = subSolarPoint(Date.UTC(2025, 3, 15, 12))
    expect(Math.abs(april.longitudeDeg)).toBeLessThan(1)

    // Early November the Sun runs about 16.4 minutes ahead of clock time, which puts
    // it about 4.1 degrees west of Greenwich at 12:00 UTC.
    const november = subSolarPoint(Date.UTC(2025, 10, 3, 12))
    expect(november.longitudeDeg).toBeCloseTo(-4.1, 0)
  })

  it('moves west at 15 degrees per hour', () => {
    const start = Date.UTC(2026, 5, 1, 6)
    const a = subSolarPoint(start)
    const b = subSolarPoint(start + 3_600_000)
    expect(longitudeDifference(b.longitudeDeg, a.longitudeDeg)).toBeCloseTo(-15, 1)
  })
})

describe('sunDirectionEcf', () => {
  it('writes a unit vector', () => {
    const out = new Float64Array(3)
    sunDirectionEcf(Date.UTC(2026, 10, 16, 21), out)
    expect(Math.hypot(out[0]!, out[1]!, out[2]!)).toBeCloseTo(1, 12)
  })
})
