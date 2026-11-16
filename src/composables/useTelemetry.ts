import { onBeforeUnmount, reactive, ref, watch, type Ref, type ShallowRef } from 'vue'
import type { Catalog } from '../orbital/catalog'
import { computeTelemetry, type Telemetry } from '../orbital/orbitPath'
import { useSimClock } from './useSimClock'

/**
 * How often the panel's numbers refresh. Faster than this is unreadable, and updating
 * reactive state every frame would cost more than the whole propagation budget.
 */
const UPDATE_INTERVAL_MS = 250

/** Live altitude, speed and ground position of the selected satellite. */
export function useTelemetry(
  catalog: ShallowRef<Catalog | null>,
  selectedIndex: Readonly<Ref<number | null>>,
) {
  const { clock } = useSimClock()
  const telemetry = reactive<Telemetry>({ altitudeKm: 0, speedKmS: 0, latitudeDeg: 0, longitudeDeg: 0 })
  /** False when nothing is selected or the selected satellite can't be propagated. */
  const available = ref(false)
  const scratch: Telemetry = { altitudeKm: 0, speedKmS: 0, latitudeDeg: 0, longitudeDeg: 0 }
  let timer: ReturnType<typeof setInterval> | undefined

  function refresh(): void {
    const index = selectedIndex.value
    const satrec = index === null ? undefined : catalog.value?.satrecs[index]
    if (satrec === undefined || !computeTelemetry(satrec, clock.nowMs(), scratch)) {
      available.value = false
      return
    }
    Object.assign(telemetry, scratch)
    available.value = true
  }

  watch(
    [catalog, selectedIndex],
    () => {
      clearInterval(timer)
      timer = undefined
      refresh()
      if (selectedIndex.value !== null) timer = setInterval(refresh, UPDATE_INTERVAL_MS)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => clearInterval(timer))

  return { telemetry, available }
}
