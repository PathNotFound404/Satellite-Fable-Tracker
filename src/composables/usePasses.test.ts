import { describe, expect, it } from 'vitest'
import type { Pass } from '../orbital/passes'
import { upcomingPasses } from './usePasses'

const pass = (riseMs: number, setMs: number): Pass => ({
  riseMs,
  peakMs: (riseMs + setMs) / 2,
  setMs,
  peakElevationDeg: 40,
  startsBeforeWindow: false,
  endsAfterWindow: false,
})
const searched = [pass(100, 200), pass(300, 400), pass(500, 600)]

describe('upcomingPasses', () => {
  it('keeps everything before the first pass', () => {
    expect(upcomingPasses(searched, 50)).toEqual(searched)
  })

  it('drops passes that have set', () => {
    expect(upcomingPasses(searched, 250).map((p) => p.riseMs)).toEqual([300, 500])
    expect(upcomingPasses(searched, 200).map((p) => p.riseMs)).toEqual([300, 500])
    expect(upcomingPasses(searched, 700)).toEqual([])
  })

  it('flags a pass that has risen as in progress, without changing the original', () => {
    const upcoming = upcomingPasses(searched, 350)
    expect(upcoming.map((p) => p.startsBeforeWindow)).toEqual([true, false])
    expect(upcoming[0]!.riseMs).toBe(300)
    expect(searched[1]!.startsBeforeWindow).toBe(false)
  })
})
