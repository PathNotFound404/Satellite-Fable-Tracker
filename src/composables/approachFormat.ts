import type { CloseApproach } from '../orbital/conjunctions'

/** What the panel shows for one close approach. */
export interface ApproachLabel {
  /** "Tue 17 Nov, 9:04" in the viewer's own time zone. */
  when: string
  /** "2 km" or "under 1 km". Whole kilometres: the data supports no finer. */
  distance: string
  /** "8.8 km/s". */
  speed: string
}

/**
 * Words for one approach, in the viewer's own language and time zone (`timeZone` and
 * `locale` are for tests).
 */
export function describeApproach(approach: CloseApproach, timeZone?: string, locale?: string): ApproachLabel {
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone })
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone })
  const speed = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  return {
    when: `${day.format(approach.timeMs)}, ${time.format(approach.timeMs)}`,
    distance: approach.distanceKm < 1 ? 'under 1 km' : `${whole.format(approach.distanceKm)} km`,
    speed: `${speed.format(approach.relativeSpeedKmS)} km/s`,
  }
}
