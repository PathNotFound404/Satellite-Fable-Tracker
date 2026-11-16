import { json2satrec, sgp4, type OMMJsonObject, type SatRec } from 'satellite.js'
import type { OmmRecord } from '../types/satellite-data'
import {
  EARTH_RADIUS_KM,
  MINUTES_PER_DAY,
  MS_PER_DAY,
  MS_PER_MINUTE,
  UNIX_EPOCH_JULIAN_DATE,
} from './constants'
import { temeStateToEcf } from './frames'

export type { SatRec }

/**
 * SGP4 can return a numerically valid position for an object that has in fact
 * re-entered. Anything this far below the surface is treated as a failed propagation.
 * (Slightly negative altitudes are kept: the spherical-Earth altitude used for display
 * can dip below zero near the poles for very low perigees.)
 */
const MIN_PLAUSIBLE_RADIUS_KM = EARTH_RADIUS_KM - 100

const epochCheckScratch = new Float64Array(6)

/**
 * Builds the SGP4 record for one satellite, or returns null if the elements are
 * unusable. Never throws.
 */
export function createSatrec(record: OmmRecord): SatRec | null {
  // 0 is SGP4. Other ephemeris types (e.g. 4, SGP4-XP) need a different propagator.
  if (record.EPHEMERIS_TYPE !== 0) return null
  try {
    // satellite.js types some fields as literals ('U' | 'C', 0); ours are the wider
    // JSON types, already checked by the pipeline's validator.
    const satrec = json2satrec(record as unknown as OMMJsonObject)
    // sgp4init runs a propagation at epoch; a non-zero error means bad elements.
    if (satrec.error !== 0) return null
    // json2satrec itself accepts a non-positive mean motion or an unparseable epoch
    // (which becomes a NaN Julian date), so check those and prove it propagates.
    if (!(satrec.no > 0) || !Number.isFinite(satrec.jdsatepoch)) return null
    if (!propagateTeme(satrec, epochUnixMs(satrec), epochCheckScratch)) return null
    return satrec
  } catch {
    return null
  }
}

/** The element set's epoch as Unix milliseconds. */
export function epochUnixMs(satrec: SatRec): number {
  return (satrec.jdsatepoch - UNIX_EPOCH_JULIAN_DATE) * MS_PER_DAY
}

/**
 * Propagates to `unixMs` and writes the TEME state, [x, y, z (km), vx, vy, vz (km/s)],
 * into `out`. Returns false, leaving `out` untouched, if SGP4 fails: decayed, invalid
 * elements, or a non-finite or underground result. Callers must hide the satellite
 * when this returns false.
 */
export function propagateTeme(satrec: SatRec, unixMs: number, out: Float64Array | number[]): boolean {
  const minutesSinceEpoch = (unixMs - epochUnixMs(satrec)) / MS_PER_MINUTE
  const result = sgp4(satrec, minutesSinceEpoch)
  if (result === null) return false

  const { position, velocity } = result
  const x = position.x
  const y = position.y
  const z = position.z
  const radiusSquared = x * x + y * y + z * z
  // NaN fails this comparison too, so it also catches non-finite positions.
  if (!(radiusSquared >= MIN_PLAUSIBLE_RADIUS_KM * MIN_PLAUSIBLE_RADIUS_KM)) return false
  if (!Number.isFinite(radiusSquared)) return false
  const vx = velocity.x
  const vy = velocity.y
  const vz = velocity.z
  if (!Number.isFinite(vx + vy + vz)) return false

  out[0] = x
  out[1] = y
  out[2] = z
  out[3] = vx
  out[4] = vy
  out[5] = vz
  return true
}

/**
 * Propagates to `unixMs` and writes the Earth-fixed state into `out`:
 * [x, y, z (km), vx, vy, vz (km/s, true ECF velocity)]. `gmstRad` is passed in so a
 * caller updating many satellites for one instant computes it once.
 * Returns false on failure, like `propagateTeme`.
 */
export function propagateEcf(
  satrec: SatRec,
  unixMs: number,
  gmstRad: number,
  out: Float64Array | number[],
): boolean {
  if (!propagateTeme(satrec, unixMs, out)) return false
  temeStateToEcf(out, gmstRad, out)
  return true
}

/** Height above a spherical Earth of radius EARTH_RADIUS_KM. Good to about ±20 km of geodetic height. */
export function altitudeKm(xKm: number, yKm: number, zKm: number): number {
  return Math.hypot(xKm, yKm, zKm) - EARTH_RADIUS_KM
}

/** Magnitude of a velocity vector. Pass the TEME (inertial) velocity for orbital speed. */
export function speedKmS(vxKmS: number, vyKmS: number, vzKmS: number): number {
  return Math.hypot(vxKmS, vyKmS, vzKmS)
}

/** Orbital period from mean motion (revolutions per day). */
export function periodMinutes(meanMotionRevPerDay: number): number {
  return MINUTES_PER_DAY / meanMotionRevPerDay
}
