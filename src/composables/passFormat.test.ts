import { describe, expect, it } from 'vitest'
import type { Pass } from '../orbital/passes'
import { describePass } from './passFormat'

const base: Pass = {
  riseMs: Date.UTC(2026, 10, 16, 21, 14, 20),
  peakMs: Date.UTC(2026, 10, 16, 21, 19, 40),
  setMs: Date.UTC(2026, 10, 16, 21, 25, 5),
  peakElevationDeg: 61.76,
  startsBeforeWindow: false,
  endsAfterWindow: false,
}

describe('describePass', () => {
  it('gives the day, rise and set to the minute and the peak in whole degrees', () => {
    const label = describePass(base, 'UTC', 'en-GB')
    expect(label.when).toBe('Mon 16 Nov, 21:14 to 21:25')
    expect(label.when).toMatch(/ to .*21.25/)
    expect(label.when).not.toMatch(/21.14.20/)
    expect(label.peakDeg).toBe(62)
    expect(label.now).toBe(false)
  })

  it('uses the given time zone', () => {
    // Tokyo is nine hours ahead: 21:14 UTC is 06:14 the next morning.
    expect(describePass(base, 'Asia/Tokyo', 'en-GB').when).toMatch(/0?6.14/)
  })

  it('says so when the satellite is already up', () => {
    const label = describePass({ ...base, startsBeforeWindow: true }, 'UTC', 'en-GB')
    expect(label.when).toMatch(/^Now until .*21.25/)
    expect(label.now).toBe(true)
  })

  it('handles a pass that outlasts the search window', () => {
    expect(describePass({ ...base, endsAfterWindow: true }, 'UTC', 'en-GB').when).toMatch(/still up/)
    expect(describePass({ ...base, startsBeforeWindow: true, endsAfterWindow: true }, 'UTC', 'en-GB').when).toBe(
      'Above the horizon all week',
    )
  })
})
