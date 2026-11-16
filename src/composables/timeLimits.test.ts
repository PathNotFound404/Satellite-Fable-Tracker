import { describe, expect, it } from 'vitest'
import {
  clampToWindow,
  formatSimTime,
  TIME_LIMIT_MS,
  TIME_WARNING_MS,
  timeNotice,
  timeWindow,
} from './timeLimits'

const DAY = 86_400_000
const GENERATED = Date.UTC(2026, 10, 16, 21, 21, 13)

describe('timeWindow', () => {
  it('spans a week either side of fresh data', () => {
    const window = timeWindow(GENERATED, GENERATED + 3_600_000)
    expect(window.minMs).toBe(GENERATED - TIME_LIMIT_MS)
    expect(window.maxMs).toBe(GENERATED + 3_600_000 + TIME_LIMIT_MS)
  })

  it('always contains the present, even when the data is weeks old', () => {
    const now = GENERATED + 30 * DAY
    const window = timeWindow(GENERATED, now)
    expect(window.minMs).toBeLessThan(GENERATED)
    expect(window.maxMs).toBeGreaterThan(now)
  })
})

describe('clampToWindow', () => {
  const window = { minMs: 100, maxMs: 200 }
  it.each([
    [50, 100],
    [100, 100],
    [150, 150],
    [200, 200],
    [999, 200],
  ])('%i -> %i', (input, expected) => {
    expect(clampToWindow(input, window)).toBe(expected)
  })
})

describe('timeNotice', () => {
  const window = timeWindow(GENERATED, GENERATED)

  it('says nothing near the data', () => {
    expect(timeNotice(GENERATED, GENERATED, window)).toBe('none')
    expect(timeNotice(GENERATED + TIME_WARNING_MS, GENERATED, window)).toBe('none')
    expect(timeNotice(GENERATED - DAY, GENERATED, window)).toBe('none')
  })

  it('warns that positions are rough more than two days out, either way', () => {
    expect(timeNotice(GENERATED + TIME_WARNING_MS + 1, GENERATED, window)).toBe('rough')
    expect(timeNotice(GENERATED - 3 * DAY, GENERATED, window)).toBe('rough')
  })

  it('reports the limit at either edge', () => {
    expect(timeNotice(window.maxMs, GENERATED, window)).toBe('limit')
    expect(timeNotice(window.minMs, GENERATED, window)).toBe('limit')
  })
})

describe('formatSimTime', () => {
  it('shows UTC with seconds on a 24-hour clock', () => {
    const text = formatSimTime(GENERATED)
    expect(text).toMatch(/21:21:13 UTC$/)
    expect(text).toContain('2026')
    expect(text).toContain('16')
  })

  it('does not shift with the viewer time zone', () => {
    // 00:30 UTC is still the 17th in UTC whatever the local zone is.
    expect(formatSimTime(Date.UTC(2026, 10, 17, 0, 30, 0))).toMatch(/17.*00:30:00 UTC$/)
  })
})
