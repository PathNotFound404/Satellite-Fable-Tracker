import { onBeforeUnmount, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import type { Catalog } from '../orbital/catalog'
import { findPasses, type Observer, type Pass } from '../orbital/passes'
import { useSimClock } from './useSimClock'

/** How often to check whether the list has gone stale. */
const CHECK_INTERVAL_MS = 1_000
/**
 * The list is searched again once simulation time has moved this far from the last
 * search, in either direction. A search takes 2 to 3 ms, so even at 1000x (where this
 * is every check) it stays far inside one frame.
 */
const RESEARCH_AFTER_MS = 30_000

/**
 * Passes of the selected satellite over `location` for the 24 hours after simulation
 * time. Null while there is nothing to search (no selection, no location, or a
 * satellite that can't be propagated).
 */
export function usePasses(
  catalog: ShallowRef<Catalog | null>,
  selectedIndex: Readonly<Ref<number | null>>,
  location: Readonly<Ref<Observer | null>>,
) {
  const { clock } = useSimClock()
  const passes = shallowRef<Pass[] | null>(null)
  let searchedFromMs = Number.NaN
  let timer: ReturnType<typeof setInterval> | undefined

  function search(): void {
    const index = selectedIndex.value
    const satrec = index === null ? undefined : catalog.value?.satrecs[index]
    const observer = location.value
    if (satrec === undefined || observer === null) {
      passes.value = null
      return
    }
    searchedFromMs = clock.nowMs()
    passes.value = findPasses(satrec, observer, searchedFromMs)
  }

  watch(
    [catalog, selectedIndex, location],
    () => {
      clearInterval(timer)
      timer = undefined
      search()
      if (passes.value === null) return
      timer = setInterval(() => {
        if (Math.abs(clock.nowMs() - searchedFromMs) >= RESEARCH_AFTER_MS) search()
      }, CHECK_INTERVAL_MS)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => clearInterval(timer))

  return { passes }
}
