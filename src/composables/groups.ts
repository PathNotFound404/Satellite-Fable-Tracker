import type { Catalog } from '../orbital/catalog'
import { GROUP_NAMES, type GroupName } from '../types/satellite-data'

/** How each data-contract group is named in the UI. */
export const GROUP_LABELS: Record<GroupName, string> = {
  stations: 'Space stations',
  starlink: 'Starlink',
  'gps-ops': 'GPS',
  weather: 'Weather',
}

/** UI labels of every group that satellite `index` belongs to. */
export function groupLabelsFor(catalog: Catalog, index: number): string[] {
  return GROUP_NAMES.filter((name) => catalog.groupIndices[name].includes(index)).map(
    (name) => GROUP_LABELS[name],
  )
}
