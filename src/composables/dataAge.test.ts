import { describe, expect, it } from 'vitest'
import { formatDataAge, isStale } from './dataAge'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatDataAge', () => {
  it.each([
    [-5 * MINUTE, 'Data updated just now'],
    [0, 'Data updated just now'],
    [59_999, 'Data updated just now'],
    [MINUTE, 'Data updated 1 minute ago'],
    [59 * MINUTE + 59_000, 'Data updated 59 minutes ago'],
    [HOUR, 'Data updated 1 hour ago'],
    [3 * HOUR + 59 * MINUTE, 'Data updated 3 hours ago'],
    [47 * HOUR, 'Data updated 47 hours ago'],
    [2 * DAY, 'Data updated 2 days ago'],
    [9 * DAY + 23 * HOUR, 'Data updated 9 days ago'],
  ])('%i ms -> %s', (ageMs, expected) => {
    expect(formatDataAge(ageMs)).toBe(expected)
  })
})

describe('isStale', () => {
  it('warns only after 24 hours', () => {
    expect(isStale(6 * HOUR)).toBe(false)
    expect(isStale(DAY)).toBe(false)
    expect(isStale(DAY + 1)).toBe(true)
  })
})
