import type { Observer } from '../orbital/passes'

/** Reads a latitude or longitude typed by hand. Accepts a decimal comma. Null if not a number. */
function parseDegrees(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/**
 * Turns two typed fields into an observer, or returns a short message saying what is
 * wrong. Decimal degrees; south and west are negative.
 */
export function parseCoordinates(latitudeText: string, longitudeText: string): Observer | string {
  const latitudeDeg = parseDegrees(latitudeText)
  const longitudeDeg = parseDegrees(longitudeText)
  if (latitudeDeg === null || latitudeDeg < -90 || latitudeDeg > 90) {
    return 'Latitude must be a number from -90 to 90.'
  }
  if (longitudeDeg === null || longitudeDeg < -180 || longitudeDeg > 180) {
    return 'Longitude must be a number from -180 to 180.'
  }
  return { latitudeDeg, longitudeDeg }
}

const twoDecimals = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "51.48° N, 0.00° W". Two decimals is about a kilometre, plenty for pass times. */
export function formatObserver(observer: Observer): string {
  const latitude = `${twoDecimals.format(Math.abs(observer.latitudeDeg))}° ${observer.latitudeDeg >= 0 ? 'N' : 'S'}`
  const longitude = `${twoDecimals.format(Math.abs(observer.longitudeDeg))}° ${observer.longitudeDeg >= 0 ? 'E' : 'W'}`
  return `${latitude}, ${longitude}`
}
