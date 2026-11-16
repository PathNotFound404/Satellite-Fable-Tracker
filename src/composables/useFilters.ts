import { computed, ref, watch, type ShallowRef } from 'vue'
import type { Catalog } from '../orbital/catalog'
import type { SatelliteLayer } from '../three/satelliteLayer'
import { GROUP_NAMES, type GroupName } from '../types/satellite-data'
import { GROUP_LABELS } from './groups'

export type FilterId = 'all' | GroupName

export interface FilterOption {
  id: FilterId
  label: string
  /** Satellites in this group that can currently be shown. */
  count: number
}

/**
 * Builds the per-satellite mask for a filter: 1 = shown. Returns null for "all", which
 * the layer treats as "no mask". Exported for tests.
 */
export function buildFilterMask(catalog: Catalog, filter: FilterId): Uint8Array | null {
  if (filter === 'all') return null
  const mask = new Uint8Array(catalog.count)
  for (const index of catalog.groupIndices[filter]) mask[index] = 1
  return mask
}

/**
 * Group filter state. Changing the filter only rewrites a per-point flag on the layer;
 * the geometry is never rebuilt.
 */
export function useFilters(
  catalog: ShallowRef<Catalog | null>,
  layer: ShallowRef<SatelliteLayer | null>,
  /** Total satellites on screen with no filter, for the "All" count. */
  trackedCount: ShallowRef<number | null>,
) {
  const activeFilter = ref<FilterId>('all')
  let mask: Uint8Array | null = null

  watch(
    [catalog, layer, activeFilter],
    ([nextCatalog, nextLayer, filter]) => {
      if (nextCatalog === null || nextLayer === null) return
      mask = buildFilterMask(nextCatalog, filter)
      nextLayer.setFilter(mask)
    },
    { immediate: true },
  )

  const options = computed<FilterOption[]>(() => {
    const loaded = catalog.value
    const shownLayer = layer.value
    // Reading trackedCount makes the counts refresh if a satellite decays.
    const total = trackedCount.value ?? 0
    const groupCount = (name: GroupName): number => {
      if (loaded === null || shownLayer === null) return 0
      let count = 0
      for (const index of loaded.groupIndices[name]) if (shownLayer.isValid(index)) count++
      return count
    }
    return [
      { id: 'all', label: 'All', count: total },
      ...GROUP_NAMES.map((name) => ({ id: name, label: GROUP_LABELS[name], count: groupCount(name) })),
    ]
  })

  /** True if satellite `index` passes the current filter. */
  function passes(index: number): boolean {
    return mask === null || mask[index] === 1
  }

  return {
    activeFilter,
    options,
    passes,
    setFilter(filter: FilterId) {
      activeFilter.value = filter
    },
  }
}
