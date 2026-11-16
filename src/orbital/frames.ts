import { gstime } from 'satellite.js'
import { EARTH_ROTATION_RAD_S, MS_PER_DAY, UNIX_EPOCH_JULIAN_DATE } from './constants'

/**
 * Frame conversion. This file is the only place TEME becomes Earth-fixed.
 *
 * SGP4 outputs positions in TEME (True Equator, Mean Equinox), an inertial frame.
 * Rotating about the z axis by Greenwich Mean Sidereal Time gives the Earth-fixed
 * frame, which is what gets drawn on the globe.
 *
 * Accuracy limits, both far below SGP4's own error (about a km at epoch, growing daily):
 * - Polar motion is ignored (strictly this yields PEF, not ITRF): about 15 m.
 * - UTC is used as UT1. They differ by up to 0.9 s, which is up to about 0.45 km of
 *   east-west shift at low Earth orbit.
 */

export function julianDateFromUnixMs(unixMs: number): number {
  return unixMs / MS_PER_DAY + UNIX_EPOCH_JULIAN_DATE
}

/** Greenwich Mean Sidereal Time, radians in [0, 2π). */
export function gmstRadFromUnixMs(unixMs: number): number {
  return gstime(julianDateFromUnixMs(unixMs))
}

/**
 * Converts a TEME state to Earth-fixed (ECF), reading six values
 * [x, y, z (km), vx, vy, vz (km/s)] from `teme` and writing six to `out` (which may be
 * the same array). No allocation, so it is safe in the render loop.
 *
 * The output velocity is the true ECF velocity, the rate of change of the ECF position:
 * the TEME velocity rotated into ECF axes, minus the rotating frame's own velocity at
 * that point (ω × r). Its magnitude is not the satellite's orbital speed; take that
 * from the TEME velocity.
 */
export function temeStateToEcf(
  teme: ArrayLike<number>,
  gmstRad: number,
  out: Float64Array | number[],
): void {
  const cos = Math.cos(gmstRad)
  const sin = Math.sin(gmstRad)

  const xTeme = teme[0]!
  const yTeme = teme[1]!
  const vxTeme = teme[3]!
  const vyTeme = teme[4]!

  const xEcf = xTeme * cos + yTeme * sin
  const yEcf = -xTeme * sin + yTeme * cos

  out[0] = xEcf
  out[1] = yEcf
  out[2] = teme[2]!
  out[3] = vxTeme * cos + vyTeme * sin + EARTH_ROTATION_RAD_S * yEcf
  out[4] = -vxTeme * sin + vyTeme * cos - EARTH_ROTATION_RAD_S * xEcf
  out[5] = teme[5]!
}
