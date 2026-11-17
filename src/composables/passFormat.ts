import type { Pass } from '../orbital/passes'

/** What the panel shows for one pass. */
export interface PassLabel {
  /** "Mon 16 Nov, 21:14 to 21:25", "Now until 21:25", "Above the horizon all week". */
  when: string
  /** Peak elevation in whole degrees: GP data doesn't support finer. */
  peakDeg: number
  /** True if the satellite is up at the moment the list was made. */
  now: boolean
}

/**
 * Words for one pass, in the viewer's own language and time zone (`locale` and
 * `timeZone` are for tests). Times
 * are to the minute: older data can be off by more than a few seconds.
 */
export function describePass(pass: Pass, timeZone?: string, locale?: string): PassLabel {
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone })
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone })
  // The date as well as the weekday: the list covers a full week.
  const rise = `${day.format(pass.riseMs)}, ${time.format(pass.riseMs)}`
  const set = time.format(pass.setMs)

  let when: string
  if (pass.startsBeforeWindow && pass.endsAfterWindow) when = 'Above the horizon all week'
  else if (pass.startsBeforeWindow) when = `Now until ${set}`
  else if (pass.endsAfterWindow) when = `${rise}, still up a week from now`
  else when = `${rise} to ${set}`

  return { when, peakDeg: Math.round(pass.peakElevationDeg), now: pass.startsBeforeWindow }
}
