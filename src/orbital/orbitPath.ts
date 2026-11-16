import { eciToGeodetic } from 'satellite.js'
import { MS_PER_MINUTE } from './constants'
import { gmstRadFromUnixMs } from './frames'
import {
  altitudeKm,
  periodMinutes,
  propagateEcf,
  propagateTeme,
  speedKmS,
  type SatRec,
} from './propagation'

const temeScratch = new Float64Array(6)

/**
 * Samples one orbit in the inertial TEME frame, where it is a closed curve: `samples`
 * positions evenly spaced in time from `startUnixMs` across one period, with the last
 * sample one full period after the first so the curve closes. Writes x, y, z (km)
 * triples into `out` and returns how many samples were written; fewer than `samples`
 * means propagation failed part-way and the path should be drawn only that far.
 */
export function sampleOrbitTeme(
  satrec: SatRec,
  startUnixMs: number,
  meanMotionRevPerDay: number,
  samples: number,
  out: Float32Array | Float64Array,
): number {
  const periodMs = periodMinutes(meanMotionRevPerDay) * MS_PER_MINUTE
  for (let i = 0; i < samples; i++) {
    const timeMs = startUnixMs + (periodMs * i) / (samples - 1)
    if (!propagateTeme(satrec, timeMs, temeScratch)) return i
    out[i * 3] = temeScratch[0]!
    out[i * 3 + 1] = temeScratch[1]!
    out[i * 3 + 2] = temeScratch[2]!
  }
  return samples
}

/** Live values for the info panel. */
export interface Telemetry {
  /** Height above a spherical Earth, km. */
  altitudeKm: number
  /** Orbital (inertial) speed, km/s. */
  speedKmS: number
  /** Geodetic latitude of the point below the satellite, degrees, north positive. */
  latitudeDeg: number
  /** Longitude of the point below the satellite, degrees in (-180, 180], east positive. */
  longitudeDeg: number
}

const RAD_TO_DEG = 180 / Math.PI

/**
 * Computes `Telemetry` for one satellite at `unixMs`, writing into `out`. Returns false
 * (leaving `out` untouched) if propagation fails. Meant for a few calls per second for
 * the selected satellite, not for the whole catalog per frame.
 */
export function computeTelemetry(satrec: SatRec, unixMs: number, out: Telemetry): boolean {
  if (!propagateTeme(satrec, unixMs, temeScratch)) return false
  const x = temeScratch[0]!
  const y = temeScratch[1]!
  const z = temeScratch[2]!
  const geodetic = eciToGeodetic({ x, y, z }, gmstRadFromUnixMs(unixMs))

  out.altitudeKm = altitudeKm(x, y, z)
  out.speedKmS = speedKmS(temeScratch[3]!, temeScratch[4]!, temeScratch[5]!)
  out.latitudeDeg = geodetic.latitude * RAD_TO_DEG
  out.longitudeDeg = geodetic.longitude * RAD_TO_DEG
  return true
}

/**
 * Samples the ground track: the path of the point directly below the satellite, in the
 * Earth-fixed frame, from one period before `centerUnixMs` to one period after. Each
 * sample uses the sidereal angle of its own time, which is what makes successive
 * orbits shift westward as the Earth turns underneath.
 *
 * Writes unit vectors (x, y, z in ECF axes: the direction from Earth's centre to the
 * satellite) into `out`, evenly spaced in time, with the middle sample exactly at
 * `centerUnixMs`. `samples` must be odd. Returns how many were written; fewer than
 * `samples` means propagation failed part-way and only that much should be drawn.
 */
export function sampleGroundTrackEcf(
  satrec: SatRec,
  centerUnixMs: number,
  meanMotionRevPerDay: number,
  samples: number,
  out: Float32Array | Float64Array,
): number {
  const periodMs = periodMinutes(meanMotionRevPerDay) * MS_PER_MINUTE
  const startMs = centerUnixMs - periodMs
  for (let i = 0; i < samples; i++) {
    const timeMs = startMs + (2 * periodMs * i) / (samples - 1)
    if (!propagateEcf(satrec, timeMs, gmstRadFromUnixMs(timeMs), temeScratch)) return i
    const x = temeScratch[0]!
    const y = temeScratch[1]!
    const z = temeScratch[2]!
    const radius = Math.hypot(x, y, z)
    out[i * 3] = x / radius
    out[i * 3 + 1] = y / radius
    out[i * 3 + 2] = z / radius
  }
  return samples
}
