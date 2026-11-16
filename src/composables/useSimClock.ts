import { readonly, ref } from 'vue'

/**
 * The single source of "now" for everything that depends on time: propagation, the
 * info panel, orbit lines and (later) time controls. Nothing else should call
 * Date.now() to decide where a satellite is.
 */
export interface SimClock {
  /** Current simulation time, Unix milliseconds. */
  nowMs(): number
  /** Simulation seconds per real second. Negative runs backwards. */
  readonly rate: number
  readonly paused: boolean
  setRate(rate: number): void
  setPaused(paused: boolean): void
  /** Jump to a specific time, keeping the current rate and paused state. */
  setTime(unixMs: number): void
  /** Back to the present at normal speed. */
  resetToRealTime(): void
}

/** Monotonic wall clock: unlike Date.now() it never steps backwards on a clock sync. */
const monotonicNowMs = (): number => performance.timeOrigin + performance.now()

/** Plain (non-reactive) clock. `realNowMs` is injectable for tests. */
export function createSimClock(realNowMs: () => number = monotonicNowMs): SimClock {
  // Simulation time is anchored to a real time, and advances from there at `rate`.
  let anchorRealMs = realNowMs()
  let anchorSimMs = anchorRealMs
  let rate = 1
  let paused = false

  const nowMs = (): number =>
    paused ? anchorSimMs : anchorSimMs + (realNowMs() - anchorRealMs) * rate

  /** Re-anchor at the current instant so a rate or pause change doesn't jump time. */
  const reanchor = (): void => {
    anchorSimMs = nowMs()
    anchorRealMs = realNowMs()
  }

  return {
    nowMs,
    get rate() {
      return rate
    },
    get paused() {
      return paused
    },
    setRate(nextRate) {
      reanchor()
      rate = nextRate
    },
    setPaused(nextPaused) {
      reanchor()
      paused = nextPaused
    },
    setTime(unixMs) {
      anchorRealMs = realNowMs()
      anchorSimMs = unixMs
    },
    resetToRealTime() {
      anchorRealMs = realNowMs()
      anchorSimMs = anchorRealMs
      rate = 1
      paused = false
    },
  }
}

// One clock for the whole app. The clock itself is not reactive (it is read every
// frame); `rate` and `paused` are mirrored into refs for the UI.
const clock = createSimClock()
const rate = ref(clock.rate)
const paused = ref(clock.paused)

function sync(): void {
  rate.value = clock.rate
  paused.value = clock.paused
}

export function useSimClock() {
  return {
    /** Read the time with `clock.nowMs()`. Change it through the functions below. */
    clock,
    rate: readonly(rate),
    paused: readonly(paused),
    setRate(nextRate: number) {
      clock.setRate(nextRate)
      sync()
    },
    setPaused(nextPaused: boolean) {
      clock.setPaused(nextPaused)
      sync()
    },
    setTime(unixMs: number) {
      clock.setTime(unixMs)
      sync()
    },
    resetToRealTime() {
      clock.resetToRealTime()
      sync()
    },
  }
}
