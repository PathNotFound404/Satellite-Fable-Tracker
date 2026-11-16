import { describe, expect, it } from 'vitest'
import { createSimClock } from './useSimClock'

/** A controllable stand-in for the wall clock. */
function fakeTime(startMs = 1_000_000) {
  let now = startMs
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

describe('createSimClock', () => {
  it('starts at real time and runs at 1x', () => {
    const time = fakeTime()
    const clock = createSimClock(time.now)
    expect(clock.nowMs()).toBe(1_000_000)
    time.advance(2500)
    expect(clock.nowMs()).toBe(1_002_500)
  })

  it('pauses and resumes without jumping', () => {
    const time = fakeTime()
    const clock = createSimClock(time.now)
    time.advance(1000)
    clock.setPaused(true)
    time.advance(60_000)
    expect(clock.nowMs()).toBe(1_001_000)
    clock.setPaused(false)
    time.advance(500)
    expect(clock.nowMs()).toBe(1_001_500)
  })

  it('changes rate without jumping, including backwards', () => {
    const time = fakeTime()
    const clock = createSimClock(time.now)
    time.advance(1000)
    clock.setRate(100)
    expect(clock.nowMs()).toBe(1_001_000)
    time.advance(1000)
    expect(clock.nowMs()).toBe(1_101_000)
    clock.setRate(-10)
    time.advance(1000)
    expect(clock.nowMs()).toBe(1_091_000)
  })

  it('jumps to a set time and keeps running at the current rate', () => {
    const time = fakeTime()
    const clock = createSimClock(time.now)
    clock.setRate(2)
    clock.setTime(5_000_000)
    time.advance(1000)
    expect(clock.nowMs()).toBe(5_002_000)
  })

  it('resets to the present at normal speed', () => {
    const time = fakeTime()
    const clock = createSimClock(time.now)
    clock.setRate(1000)
    clock.setPaused(true)
    time.advance(10_000)
    clock.resetToRealTime()
    expect(clock.rate).toBe(1)
    expect(clock.paused).toBe(false)
    expect(clock.nowMs()).toBe(time.now())
  })
})
