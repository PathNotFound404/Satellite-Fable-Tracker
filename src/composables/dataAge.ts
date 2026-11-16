const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * The pipeline refreshes every 6 hours, so data older than a day means it is failing
 * (or the app is running on the committed sample).
 */
export const STALE_AFTER_MS = DAY_MS

export function isStale(ageMs: number): boolean {
  return ageMs > STALE_AFTER_MS
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

/** "Data updated 3 hours ago". Rounds down, so it never claims fresher data than we have. */
export function formatDataAge(ageMs: number): string {
  // A slightly fast pipeline clock or slow local clock can make the age negative.
  if (ageMs < MINUTE_MS) return 'Data updated just now'
  if (ageMs < HOUR_MS) return `Data updated ${plural(Math.floor(ageMs / MINUTE_MS), 'minute')} ago`
  if (ageMs < 2 * DAY_MS) return `Data updated ${plural(Math.floor(ageMs / HOUR_MS), 'hour')} ago`
  return `Data updated ${plural(Math.floor(ageMs / DAY_MS), 'day')} ago`
}
