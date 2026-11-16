import { sunPos } from 'satellite.js'
import { gmstRadFromUnixMs, julianDateFromUnixMs, temeStateToEcf } from './frames'

/**
 * Where the Sun is relative to the turning Earth, for day/night shading.
 *
 * Uses satellite.js's low-precision solar position (Vallado's `sun` routine, good to
 * about 0.01 degrees) in the inertial frame, then the same GMST rotation as satellites
 * to get into the Earth-fixed frame. The inertial frame it uses differs from TEME by
 * well under a hundredth of a degree, which is invisible for shading.
 */

const scratch = new Float64Array(6)
const RAD_TO_DEG = 180 / Math.PI

/**
 * Writes the unit vector from Earth's centre toward the Sun, in Earth-fixed (ECF)
 * axes, into `out` as [x, y, z]. Does not allocate beyond what satellite.js does.
 */
export function sunDirectionEcf(unixMs: number, out: Float64Array | number[]): void {
  const { rsun } = sunPos(julianDateFromUnixMs(unixMs))
  scratch[0] = rsun.x
  scratch[1] = rsun.y
  scratch[2] = rsun.z
  scratch[3] = 0
  scratch[4] = 0
  scratch[5] = 0
  temeStateToEcf(scratch, gmstRadFromUnixMs(unixMs), scratch)
  const length = Math.hypot(scratch[0]!, scratch[1]!, scratch[2]!)
  out[0] = scratch[0]! / length
  out[1] = scratch[1]! / length
  out[2] = scratch[2]! / length
}

/** The point on Earth where the Sun is directly overhead. Degrees; east positive. */
export function subSolarPoint(unixMs: number): { latitudeDeg: number; longitudeDeg: number } {
  const direction = [0, 0, 0]
  sunDirectionEcf(unixMs, direction)
  return {
    latitudeDeg: Math.asin(direction[2]!) * RAD_TO_DEG,
    longitudeDeg: Math.atan2(direction[1]!, direction[0]!) * RAD_TO_DEG,
  }
}
