import { EARTH_MU_KM3_S2 } from './constants'
import { propagateTeme, type SatRec } from './propagation'

/**
 * Close-approach search: when other satellites come near one chosen satellite.
 *
 * This is a demonstration, not collision assessment. Public GP elements are good to
 * about a kilometre at their epoch and drift by kilometres per day, which is larger
 * than the distances that matter for a real conjunction. Anything shown from this must
 * be labelled approximate.
 *
 * Method, for one target against the whole catalog:
 *  1. Sample the target every COARSE_STEP_MS across the window, once.
 *  2. Drop candidates whose orbit never reaches the target's range of heights.
 *  3. Walk each remaining candidate through the window. While it is far away, skip
 *     ahead by as long as it would need to close the gap at the highest possible
 *     speed. When it is near, treat both as moving in straight lines across one step
 *     to estimate the closest point, then refine that with SGP4.
 * The work is cut into slices (`step`) so the caller can spread it over frames.
 */

export interface CloseApproach {
  /** Catalog index of the other satellite. */
  index: number
  /** Time of closest approach, Unix ms. */
  timeMs: number
  /** Distance between the two at that time, km. */
  distanceKm: number
  /** Speed of one relative to the other at that time, km/s. */
  relativeSpeedKmS: number
}

export interface ConjunctionOptions {
  /** How far ahead to search, ms. Default 24 hours. */
  windowMs?: number
  /** Report approaches closer than this, km. Default 50. */
  thresholdKm?: number
  /** Keep only this many, closest first. Default 10. */
  maxResults?: number
}

export interface ConjunctionScan {
  /**
   * Does up to `budgetMs` of work. Returns true when the scan is finished. `nowMs` is
   * a millisecond timer for measuring the budget (defaults to performance.now).
   */
  step(budgetMs: number, nowMs?: () => number): boolean
  /** Share of the work done, 0 to 1. */
  progress(): number
  /** Approaches found so far, closest first. */
  results(): CloseApproach[]
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_THRESHOLD_KM = 50
const DEFAULT_MAX_RESULTS = 10

const COARSE_STEP_MS = 30_000
const COARSE_STEP_S = COARSE_STEP_MS / 1000
/**
 * Straight-line motion over one coarse step is off by up to about 8 km between two
 * low orbits (each curves away from its tangent by about 4 km in 30 s), so a
 * straight-line estimate this far over the threshold is still refined. A longer step
 * would need a much larger margin: the error grows with the square of the step.
 */
const LINEAR_MARGIN_KM = 25
/** No two Earth satellites close faster than this, km/s. Used to skip ahead safely. */
const MAX_CLOSING_SPEED_KM_S = 22
/**
 * Mean elements give heights within a few tens of km of the true (osculating) ones,
 * so the height filter is this generous on top of the threshold.
 */
const HEIGHT_MARGIN_KM = 40
/** The closest approach is refined until its time is known this closely. */
const TIME_TOLERANCE_MS = 5
/** How far either side of the straight-line estimate the refinement looks. */
const REFINE_HALF_WIDTH_MS = 20_000
/**
 * Objects that drift past this slowly are docked, in formation or part of the same
 * train, not a conjunction. They would otherwise fill the list.
 */
const MIN_RELATIVE_SPEED_KM_S = 0.1
/** Two results for the same satellite closer in time than this are the same approach. */
const SAME_APPROACH_MS = 30_000

/** Perigee and apogee distance from Earth's centre, km, from the mean elements. */
export function radiusRangeKm(satrec: SatRec): { perigeeKm: number; apogeeKm: number } {
  // satrec.no is the mean motion in radians per minute.
  const meanMotionRadS = satrec.no / 60
  const semiMajorAxisKm = Math.cbrt(EARTH_MU_KM3_S2 / (meanMotionRadS * meanMotionRadS))
  return {
    perigeeKm: semiMajorAxisKm * (1 - satrec.ecco),
    apogeeKm: semiMajorAxisKm * (1 + satrec.ecco),
  }
}

const stateA = new Float64Array(6)
const stateB = new Float64Array(6)

/** Distance between two satellites at `unixMs`, km, or NaN if either can't be propagated. */
export function separationKm(a: SatRec, b: SatRec, unixMs: number): number {
  if (!propagateTeme(a, unixMs, stateA) || !propagateTeme(b, unixMs, stateB)) return Number.NaN
  return Math.hypot(stateA[0]! - stateB[0]!, stateA[1]! - stateB[1]!, stateA[2]! - stateB[2]!)
}

/**
 * Starts a search for approaches to `satrecs[targetIndex]` in the window beginning at
 * `startUnixMs`. Nothing is computed until `step` is called.
 */
export function createConjunctionScan(
  satrecs: readonly SatRec[],
  targetIndex: number,
  startUnixMs: number,
  options: ConjunctionOptions = {},
): ConjunctionScan {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const thresholdKm = options.thresholdKm ?? DEFAULT_THRESHOLD_KM
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS
  const target = satrecs[targetIndex]!
  const steps = Math.ceil(windowMs / COARSE_STEP_MS)
  const endUnixMs = startUnixMs + windowMs

  // Target states at every coarse step. If the target can't be propagated part-way,
  // the search stops there.
  const targetStates = new Float64Array((steps + 1) * 6)
  let usableSteps = 0
  let targetMinRadiusKm = Number.POSITIVE_INFINITY
  let targetMaxRadiusKm = 0
  for (let k = 0; k <= steps; k++) {
    if (!propagateTeme(target, startUnixMs + k * COARSE_STEP_MS, stateA)) break
    targetStates.set(stateA, k * 6)
    const radiusKm = Math.hypot(stateA[0]!, stateA[1]!, stateA[2]!)
    targetMinRadiusKm = Math.min(targetMinRadiusKm, radiusKm)
    targetMaxRadiusKm = Math.max(targetMaxRadiusKm, radiusKm)
    usableSteps = k
  }

  // Candidates whose heights overlap the target's.
  const candidates: number[] = []
  if (usableSteps > 0) {
    const reachKm = thresholdKm + HEIGHT_MARGIN_KM
    for (let index = 0; index < satrecs.length; index++) {
      if (index === targetIndex) continue
      const { perigeeKm, apogeeKm } = radiusRangeKm(satrecs[index]!)
      if (perigeeKm - reachKm <= targetMaxRadiusKm && apogeeKm + reachKm >= targetMinRadiusKm) {
        candidates.push(index)
      }
    }
  }

  const found: CloseApproach[] = []
  let cursor = 0

  /** Refines one approach near `guessMs` and records it if it qualifies. */
  function refine(index: number, guessMs: number): void {
    const candidate = satrecs[index]!
    let low = Math.max(startUnixMs, guessMs - REFINE_HALF_WIDTH_MS)
    let high = Math.min(endUnixMs, guessMs + REFINE_HALF_WIDTH_MS)
    while (high - low > TIME_TOLERANCE_MS) {
      const third = (high - low) / 3
      const a = low + third
      const b = high - third
      // NaN compares false, which moves the bracket inward and ends harmlessly.
      if (separationKm(target, candidate, a) > separationKm(target, candidate, b)) low = a
      else high = b
    }
    const timeMs = (low + high) / 2
    const distanceKm = separationKm(target, candidate, timeMs)
    if (!(distanceKm < thresholdKm)) return
    // separationKm left both states in the scratch arrays.
    const relativeSpeedKmS = Math.hypot(stateA[3]! - stateB[3]!, stateA[4]! - stateB[4]!, stateA[5]! - stateB[5]!)
    if (relativeSpeedKmS < MIN_RELATIVE_SPEED_KM_S) return
    for (const earlier of found) {
      if (earlier.index === index && Math.abs(earlier.timeMs - timeMs) < SAME_APPROACH_MS) return
    }
    found.push({ index, timeMs, distanceKm, relativeSpeedKmS })
  }

  function scanCandidate(index: number): void {
    const candidate = satrecs[index]!
    let k = 0
    while (k < usableSteps) {
      const timeMs = startUnixMs + k * COARSE_STEP_MS
      if (!propagateTeme(candidate, timeMs, stateB)) return
      const offset = k * 6
      const rx = stateB[0]! - targetStates[offset]!
      const ry = stateB[1]! - targetStates[offset + 1]!
      const rz = stateB[2]! - targetStates[offset + 2]!
      const range = Math.hypot(rx, ry, rz)

      // Too far to get within reach during this step, or for several: skip them.
      const stepsAway = Math.floor(
        (range - thresholdKm - LINEAR_MARGIN_KM) / (MAX_CLOSING_SPEED_KM_S * COARSE_STEP_S),
      )
      if (stepsAway >= 1) {
        k += stepsAway
        continue
      }

      const vx = stateB[3]! - targetStates[offset + 3]!
      const vy = stateB[4]! - targetStates[offset + 4]!
      const vz = stateB[5]! - targetStates[offset + 5]!
      const speedSquared = vx * vx + vy * vy + vz * vz
      if (speedSquared > 0) {
        // Time of closest approach if both kept going in straight lines, seconds.
        const closestS = -(rx * vx + ry * vy + rz * vz) / speedSquared
        // A little overlap with the neighbouring steps so nothing falls between them.
        if (closestS >= -5 && closestS <= COARSE_STEP_S + 5) {
          const missKm = Math.hypot(rx + vx * closestS, ry + vy * closestS, rz + vz * closestS)
          if (missKm < thresholdKm + LINEAR_MARGIN_KM) refine(index, timeMs + closestS * 1000)
        }
      }
      k++
    }
  }

  return {
    step(budgetMs, nowMs = () => performance.now()) {
      const deadline = nowMs() + budgetMs
      while (cursor < candidates.length) {
        scanCandidate(candidates[cursor]!)
        cursor++
        if (nowMs() >= deadline) break
      }
      return cursor >= candidates.length
    },

    progress: () => (candidates.length === 0 ? 1 : cursor / candidates.length),

    results: () => [...found].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, maxResults),
  }
}

/** Runs a whole scan in one go. For tests and small catalogs. */
export function findCloseApproaches(
  satrecs: readonly SatRec[],
  targetIndex: number,
  startUnixMs: number,
  options: ConjunctionOptions = {},
): CloseApproach[] {
  const scan = createConjunctionScan(satrecs, targetIndex, startUnixMs, options)
  while (!scan.step(Number.POSITIVE_INFINITY)) {
    // Keep going until done.
  }
  return scan.results()
}
