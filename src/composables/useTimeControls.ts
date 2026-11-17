import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import {
  clampToWindow,
  timeNotice,
  timeWindow,
  type Speed,
  type TimeNotice,
} from './timeLimits'
import { useSimClock } from './useSimClock'

/**
 * How often the displayed time and the limits are refreshed. The clock itself is read
 * every frame by the renderer; the UI only needs to look alive.
 */
const POLL_INTERVAL_MS = 100
/** Within this of the wall clock at 1x, the display says "Live". */
const LIVE_TOLERANCE_MS = 1500

/**
 * UI-facing state and actions for the simulation clock: speed, direction, pause, the
 * displayed time, and the limits on how far time may stray from the data.
 */
export function useTimeControls(generatedAt: Ref<string | null>) {
  const { clock, rate, paused, setRate, setPaused, setTime, resetToRealTime } = useSimClock()

  const simTimeMs = ref(clock.nowMs())
  const live = ref(true)
  const notice = ref<TimeNotice>('none')

  const speed = computed<Speed>(() => Math.abs(rate.value) as Speed)
  const reversed = computed(() => rate.value < 0)

  function poll(): void {
    const realNowMs = Date.now()
    let now = clock.nowMs()

    if (generatedAt.value !== null) {
      const generatedAtMs = Date.parse(generatedAt.value)
      const window = timeWindow(generatedAtMs, realNowMs)
      const clamped = clampToWindow(now, window)
      if (clamped !== now) {
        // Ran off the end of the useful range: stop there rather than show fiction.
        setTime(clamped)
        setPaused(true)
        now = clamped
      }
      notice.value = timeNotice(now, generatedAtMs, window)
    }

    simTimeMs.value = now
    live.value = !paused.value && rate.value === 1 && Math.abs(now - realNowMs) < LIVE_TOLERANCE_MS
  }

  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    poll()
    timer = setInterval(poll, POLL_INTERVAL_MS)
  })
  onBeforeUnmount(() => clearInterval(timer))

  return {
    simTimeMs,
    live,
    notice,
    paused,
    speed,
    reversed,
    togglePause() {
      setPaused(!paused.value)
      poll()
    },
    setSpeed(nextSpeed: Speed) {
      setRate(reversed.value ? -nextSpeed : nextSpeed)
      // Choosing a speed is a request to move.
      setPaused(false)
      poll()
    },
    toggleReverse() {
      setRate(-rate.value)
      setPaused(false)
      poll()
    },
    goLive() {
      resetToRealTime()
      poll()
    },
    /** Move simulation time to `unixMs`, keeping speed and pause. Clamped to the data's window. */
    jumpTo(unixMs: number) {
      setTime(unixMs)
      poll()
    },
  }
}
