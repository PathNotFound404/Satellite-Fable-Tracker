import { describe, expect, it } from 'vitest'
import { formatObserver, parseCoordinates } from './observerLocation'

describe('parseCoordinates', () => {
  it('accepts decimal degrees, with south and west negative', () => {
    expect(parseCoordinates('51.4769', '-0.0005')).toEqual({ latitudeDeg: 51.4769, longitudeDeg: -0.0005 })
    expect(parseCoordinates(' -33.87 ', '151.21')).toEqual({ latitudeDeg: -33.87, longitudeDeg: 151.21 })
  })

  it('accepts a decimal comma', () => {
    expect(parseCoordinates('48,85', '2,35')).toEqual({ latitudeDeg: 48.85, longitudeDeg: 2.35 })
  })

  it('accepts the limits', () => {
    expect(parseCoordinates('90', '-180')).toEqual({ latitudeDeg: 90, longitudeDeg: -180 })
  })

  it.each([
    ['', '10'],
    ['abc', '10'],
    ['91', '10'],
    ['-90.1', '10'],
    ['Infinity', '10'],
  ])('rejects latitude %j', (latitude, longitude) => {
    expect(parseCoordinates(latitude, longitude)).toMatch(/^Latitude/)
  })

  it.each([
    ['10', ''],
    ['10', '181'],
    ['10', '-180.5'],
    ['10', '12 E'],
  ])('rejects longitude %j %j', (latitude, longitude) => {
    expect(parseCoordinates(latitude, longitude)).toMatch(/^Longitude/)
  })
})

describe('formatObserver', () => {
  it('labels hemispheres instead of using signs', () => {
    const text = formatObserver({ latitudeDeg: -33.8688, longitudeDeg: 151.2093 })
    expect(text).toMatch(/^33[.,]87° S, 151[.,]21° E$/)
    expect(formatObserver({ latitudeDeg: 51.4769, longitudeDeg: -0.1278 })).toMatch(/N, 0[.,]13° W$/)
  })
})
