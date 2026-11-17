import { describe, expect, it } from 'vitest'
import { describeApproach } from './approachFormat'

const approach = {
  index: 3,
  timeMs: Date.UTC(2026, 10, 17, 9, 4, 33),
  distanceKm: 7.8,
  relativeSpeedKmS: 14.26,
}

describe('describeApproach', () => {
  it('gives the day and time to the minute, whole kilometres and one decimal of speed', () => {
    expect(describeApproach(approach, 'UTC', 'en-GB')).toEqual({
      when: 'Tue 17 Nov, 9:04',
      distance: '8 km',
      speed: '14.3 km/s',
    })
  })

  it('does not claim a distance under a kilometre', () => {
    expect(describeApproach({ ...approach, distanceKm: 0.4 }, 'UTC', 'en-GB').distance).toBe('under 1 km')
    expect(describeApproach({ ...approach, distanceKm: 1 }, 'UTC', 'en-GB').distance).toBe('1 km')
  })

  it('uses the given time zone', () => {
    expect(describeApproach(approach, 'Asia/Tokyo', 'en-GB').when).toBe('Tue 17 Nov, 18:04')
  })
})
