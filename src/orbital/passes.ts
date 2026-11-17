import { EARTH_RADIUS_KM } from './constants'
import { gmstRadFromUnixMs } from './frames'
import { propagateEcf, type SatRec } from './propagation'

/**
 * Pass prediction: when a satellite is above the horizon for someone standing at a
 * given place.
 *
 * "Above the horizon" is purely geometric. It says nothing about whether the satellite
 * can be seen by eye, which also needs a dark sky and a sunlit satellite, and it
 * ignores atmospheric refraction (about half a degree at the horizon, a few seconds of
 * rise and set time). Times inherit SGP4's error, which grows with the age of the data.
 */

/** A place on the ground. Degrees, north and east positive. */
export interface Observer {
  latitudeDeg: number
  longitudeDeg: number
  /** Height above the WGS84 ellipsoid, km. Defaults to 0. */
  heightKm?: number
}

/** One stretch of time during which the satellite is above the observer's horizon. */
export interface Pass {
  /** When it crosses the horizon going up, Unix ms. The window start if `startsBeforeWindow`. */
  riseMs: number
  /** When it is highest in the sky (within the search window), Unix ms. */
  peakMs: number
  /** When it crosses the horizon going down, Unix ms. The window end if `endsAfterWindow`. */
  setMs: number
  /** Elevation above the horizon at `peakMs`, degrees. 90 is straight overhead. */
  peakElevationDeg: number
  /** True if it was already up when the search window began. */
  startsBeforeWindow: boolean
  /** True if it was still up when the search window ended. */
  endsAfterWindow: boolean
}

export interface PassSearchOptions {
  /** How far ahead to search, ms. Default 24 hours. */
  windowMs?: number
  /** Passes that never get this high are left out, degrees. Default 10. */
  minPeakElevationDeg?: number
}

/** WGS84 flattening. The observer sits on the ellipsoid, not on a sphere. */
const WGS84_FLATTENING = 1 / 298.257223563
const WGS84_ECCENTRICITY_SQUARED = WGS84_FLATTENING * (2 - WGS84_FLATTENING)

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_MIN_PEAK_ELEVATION_DEG = 10

/**
 * Spacing of the first, coarse scan. A pass that fits entirely between two samples
 * lasts under 30 s, which means it barely clears the horizon; any pass high enough to
 * be reported lasts minutes.
 */
const SCAN_STEP_MS = 30_000
/** Rise, set and peak times are refined until they are known this closely. */
const TIME_TOLERANCE_MS = 500

/** The observer's position and local "up", both in Earth-fixed axes. */
export interface ObserverFrame {
  /** Position, km from Earth's centre. */
  xKm: number
  yKm: number
  zKm: number
  /** Unit vector pointing straight up (perpendicular to the ellipsoid). */
  upX: number
  upY: number
  upZ: number
}

/** Works out where the observer is in the Earth-fixed frame. Do this once per search. */
export function observerFrame(observer: Observer): ObserverFrame {
  const latitudeRad = observer.latitudeDeg * DEG_TO_RAD
  const longitudeRad = observer.longitudeDeg * DEG_TO_RAD
  const heightKm = observer.heightKm ?? 0
  const sinLat = Math.sin(latitudeRad)
  const cosLat = Math.cos(latitudeRad)
  const sinLon = Math.sin(longitudeRad)
  const cosLon = Math.cos(longitudeRad)
  // Radius of curvature in the prime vertical: distance along the ellipsoid normal
  // from the surface to the polar axis.
  const normalRadiusKm = EARTH_RADIUS_KM / Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * sinLat * sinLat)
  return {
    xKm: (normalRadiusKm + heightKm) * cosLat * cosLon,
    yKm: (normalRadiusKm + heightKm) * cosLat * sinLon,
    zKm: (normalRadiusKm * (1 - WGS84_ECCENTRICITY_SQUARED) + heightKm) * sinLat,
    upX: cosLat * cosLon,
    upY: cosLat * sinLon,
    upZ: sinLat,
  }
}

/**
 * Elevation of a point above the observer's horizon, degrees in [-90, 90]. The point is
 * given in Earth-fixed km.
 */
export function elevationDegOfEcf(frame: ObserverFrame, xKm: number, yKm: number, zKm: number): number {
  const dx = xKm - frame.xKm
  const dy = yKm - frame.yKm
  const dz = zKm - frame.zKm
  const range = Math.hypot(dx, dy, dz)
  const sinElevation = (dx * frame.upX + dy * frame.upY + dz * frame.upZ) / range
  return Math.asin(Math.max(-1, Math.min(1, sinElevation))) * RAD_TO_DEG
}

const ecfScratch = new Float64Array(6)

/** Elevation of the satellite at `unixMs`, degrees, or NaN if it can't be propagated. */
export function elevationDeg(satrec: SatRec, frame: ObserverFrame, unixMs: number): number {
  if (!propagateEcf(satrec, unixMs, gmstRadFromUnixMs(unixMs), ecfScratch)) return Number.NaN
  return elevationDegOfEcf(frame, ecfScratch[0]!, ecfScratch[1]!, ecfScratch[2]!)
}

/**
 * Finds the horizon crossing between `belowMs` (satellite down) and `aboveMs`
 * (satellite up) by bisection. Either may be the earlier time.
 */
function horizonCrossingMs(satrec: SatRec, frame: ObserverFrame, belowMs: number, aboveMs: number): number {
  let below = belowMs
  let above = aboveMs
  while (Math.abs(above - below) > TIME_TOLERANCE_MS) {
    const middle = (below + above) / 2
    // NaN counts as below, so a failed propagation is never reported as visible.
    if (elevationDeg(satrec, frame, middle) > 0) above = middle
    else below = middle
  }
  return (below + above) / 2
}

/**
 * Finds the time of highest elevation between `fromMs` and `toMs` by ternary search.
 * The caller passes a bracket around the best coarse sample, where there is one peak.
 */
function peakTimeMs(satrec: SatRec, frame: ObserverFrame, fromMs: number, toMs: number): number {
  let low = fromMs
  let high = toMs
  while (high - low > TIME_TOLERANCE_MS) {
    const third = (high - low) / 3
    const a = low + third
    const b = high - third
    if (elevationDeg(satrec, frame, a) < elevationDeg(satrec, frame, b)) low = a
    else high = b
  }
  return (low + high) / 2
}

/**
 * Lists the satellite's passes over `observer` in the window starting at `startUnixMs`,
 * earliest first.
 *
 * About 3,000 SGP4 calls per 24 hours searched, a few milliseconds: fine to run on
 * the main thread when the selection or location changes, but not every frame. If
 * propagation fails part-way (a decaying satellite), passes found up to then are
 * returned.
 */
export function findPasses(
  satrec: SatRec,
  observer: Observer,
  startUnixMs: number,
  options: PassSearchOptions = {},
): Pass[] {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const minPeakElevationDeg = options.minPeakElevationDeg ?? DEFAULT_MIN_PEAK_ELEVATION_DEG
  const endUnixMs = startUnixMs + windowMs
  const frame = observerFrame(observer)
  const passes: Pass[] = []

  let previousMs = startUnixMs
  const startElevation = elevationDeg(satrec, frame, startUnixMs)
  if (Number.isNaN(startElevation)) return passes

  // State of the pass currently in progress, if any.
  let up = startElevation > 0
  let riseMs = startUnixMs
  let startsBeforeWindow = up
  let bestMs = startUnixMs
  let bestElevation = startElevation

  const close = (setMs: number, endsAfterWindow: boolean): void => {
    // The coarse scan found the highest sample; the true peak is within one step of it.
    const peakMs = peakTimeMs(
      satrec,
      frame,
      Math.max(riseMs, bestMs - SCAN_STEP_MS),
      Math.min(setMs, bestMs + SCAN_STEP_MS),
    )
    const peakElevationDeg = elevationDeg(satrec, frame, peakMs)
    if (peakElevationDeg >= minPeakElevationDeg) {
      passes.push({ riseMs, peakMs, setMs, peakElevationDeg, startsBeforeWindow, endsAfterWindow })
    }
  }

  while (previousMs < endUnixMs) {
    const timeMs = Math.min(previousMs + SCAN_STEP_MS, endUnixMs)
    const elevation = elevationDeg(satrec, frame, timeMs)
    // Propagation failed: nothing after this can be trusted, including a pass that
    // was still in progress.
    if (Number.isNaN(elevation)) return passes

    if (!up && elevation > 0) {
      up = true
      riseMs = horizonCrossingMs(satrec, frame, previousMs, timeMs)
      startsBeforeWindow = false
      bestMs = timeMs
      bestElevation = elevation
    } else if (up && elevation > 0) {
      if (elevation > bestElevation) {
        bestMs = timeMs
        bestElevation = elevation
      }
    } else if (up) {
      up = false
      close(horizonCrossingMs(satrec, frame, timeMs, previousMs), false)
    }

    previousMs = timeMs
  }

  if (up) close(endUnixMs, true)
  return passes
}
