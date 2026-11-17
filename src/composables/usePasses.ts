import { onBeforeUnmount, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import type { Catalog } from '../orbital/catalog'
import { findPasses, type Observer, type Pass } from '../orbital/passes'
import { useSimClock } from './useSimClock'

/** How far ahead passes are listed. */
export const PASS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
/** How often the list is checked against the clock. */
const CHECK_INTERVAL_MS = 1_000
/**
 * A search stays good while simulation time is inside the stretch it covered, so the
 * list is only searched again after this much simulation time, to keep the far end
 * of the window from falling short. A 7-day search takes about 15 ms, a frame's worth,
 * so it must not run every second when time is fast-forwarded.
 */
const RESEARCH_AFTER_MS = 60 * 60 * 1000
/**
 * When time runs backwards the search starts this far in the past, so reversing
 * doesn't force a new search on every check.
 */
const REVERSE_MARGIN_MS = 6 * 60 * 60 * 1000

/**
 * Keeps the passes still to come (or in progress) at `nowMs` from a finished search.
 * A pass that has started since the search is flagged as in progress. Exported for tests.
 */
export function upcomingPasses(searched: readonly Pass[], nowMs: number): Pass[] {
  const upcoming: Pass[] = []
  for (const pass of searched) {
    if (pass.setMs <= nowMs) continue
    const inProgress = pass.riseMs <= nowMs && !pass.startsBeforeWindow
    upcoming.push(inProgress ? { ...pass, startsBeforeWindow: true } : pass)
  }
  return upcoming
}

/**
 * Passes of the selected satellite over `location` for the week after simulation time.
 * Null while there is nothing to search (no selection, no location, or a satellite
 * that can't be propagated).
 */
export function usePasses(
  catalog: ShallowRef<Catalog | null>,
  selectedIndex: Readonly<Ref<number | null>>,
  location: Readonly<Ref<Observer | null>>,
) {
  const { clock } = useSimClock()
  const passes = shallowRef<Pass[] | null>(null)
  let searched: Pass[] = []
  let searchedFromMs = Number.NaN
  let searchedUntilStaleMs = Number.NaN
  /** What the published list looked like, so reactive state only changes when it does. */
  let publishedSignature = ''
  let timer: ReturnType<typeof setInterval> | undefined

  function publish(nowMs: number): void {
    const upcoming = upcomingPasses(searched, nowMs)
    const first = upcoming[0]
    const signature = `${searchedFromMs}:${upcoming.length}:${first?.riseMs}:${first?.startsBeforeWindow}`
    if (signature === publishedSignature && passes.value !== null) return
    publishedSignature = signature
    passes.value = upcoming
  }

  /** Returns false if there is nothing to search. */
  function search(): boolean {
    const index = selectedIndex.value
    const satrec = index === null ? undefined : catalog.value?.satrecs[index]
    const observer = location.value
    if (satrec === undefined || observer === null) {
      passes.value = null
      return false
    }
    const nowMs = clock.nowMs()
    const marginMs = clock.rate < 0 ? REVERSE_MARGIN_MS : 0
    searchedFromMs = nowMs - marginMs
    searchedUntilStaleMs = nowMs + RESEARCH_AFTER_MS
    searched = findPasses(satrec, observer, searchedFromMs, { windowMs: PASS_WINDOW_MS + marginMs })
    publish(nowMs)
    return true
  }

  watch(
    [catalog, selectedIndex, location],
    () => {
      clearInterval(timer)
      timer = undefined
      if (!search()) return
      timer = setInterval(() => {
        const nowMs = clock.nowMs()
        if (nowMs < searchedFromMs || nowMs >= searchedUntilStaleMs) search()
        else publish(nowMs)
      }, CHECK_INTERVAL_MS)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => clearInterval(timer))

  return { passes }
}
