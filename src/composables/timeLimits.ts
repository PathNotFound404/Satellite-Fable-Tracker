/**
 * How far simulation time may stray from the data. GP element sets describe an orbit
 * around their epoch; SGP4 error grows by roughly a few km per day for low orbits, so
 * beyond a week the picture is fiction and beyond a couple of days it is rough.
 */

const DAY_MS = 86_400_000

/** Simulation time can't go further than this from the data (or from the present). */
export const TIME_LIMIT_MS = 7 * DAY_MS
/** Past this distance from the data's fetch time, the UI warns that positions are rough. */
export const TIME_WARNING_MS = 2 * DAY_MS

export interface TimeWindow {
  minMs: number
  maxMs: number
}

/**
 * The allowed simulation time range. It always contains both the data's fetch time and
 * the present, so live mode works even when the data is stale.
 */
export function timeWindow(generatedAtMs: number, realNowMs: number): TimeWindow {
  return {
    minMs: Math.min(generatedAtMs, realNowMs) - TIME_LIMIT_MS,
    maxMs: Math.max(generatedAtMs, realNowMs) + TIME_LIMIT_MS,
  }
}

export function clampToWindow(timeMs: number, window: TimeWindow): number {
  return Math.min(window.maxMs, Math.max(window.minMs, timeMs))
}

export type TimeNotice = 'none' | 'rough' | 'limit'

/** What, if anything, the UI should say about the current simulation time. */
export function timeNotice(simTimeMs: number, generatedAtMs: number, window: TimeWindow): TimeNotice {
  if (simTimeMs <= window.minMs || simTimeMs >= window.maxMs) return 'limit'
  if (Math.abs(simTimeMs - generatedAtMs) > TIME_WARNING_MS) return 'rough'
  return 'none'
}

export const SPEEDS = [1, 10, 100, 1000] as const
export type Speed = (typeof SPEEDS)[number]

const utcFormat = new Intl.DateTimeFormat(undefined, {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** "Nov 16, 2026, 21:21:13 UTC" (date order follows the viewer's locale). */
export function formatSimTime(unixMs: number): string {
  return `${utcFormat.format(unixMs)} UTC`
}
