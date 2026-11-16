import type { GroupName, OmmRecord, SatelliteFile } from '../types/satellite-data'
import { GROUP_NAMES } from '../types/satellite-data'
import { createSatrec, type SatRec } from './propagation'

/**
 * The loaded satellites as parallel arrays sharing one stable index `i`. That index is
 * what the position buffer, filter mask, picking and selection all use.
 */
export interface Catalog {
  readonly count: number
  readonly records: readonly OmmRecord[]
  readonly satrecs: readonly SatRec[]
  /** NORAD catalog ID -> index. */
  readonly indexByNoradId: ReadonlyMap<number, number>
  /** Group name -> indices of its members, ascending. */
  readonly groupIndices: Readonly<Record<GroupName, Uint32Array>>
  /** Records whose elements could not be turned into an SGP4 record. */
  readonly droppedCount: number
  readonly generatedAt: string
}

export function buildCatalog(file: SatelliteFile): Catalog {
  const records: OmmRecord[] = []
  const satrecs: SatRec[] = []
  const indexByNoradId = new Map<number, number>()
  let droppedCount = 0

  for (const record of file.satellites) {
    const satrec = createSatrec(record)
    if (satrec === null) {
      droppedCount++
      continue
    }
    indexByNoradId.set(record.NORAD_CAT_ID, records.length)
    records.push(record)
    satrecs.push(satrec)
  }

  const groupIndices = {} as Record<GroupName, Uint32Array>
  for (const name of GROUP_NAMES) {
    const indices: number[] = []
    for (const noradId of file.groups[name]) {
      const index = indexByNoradId.get(noradId)
      if (index !== undefined) indices.push(index)
    }
    groupIndices[name] = Uint32Array.from(indices).sort()
  }

  return {
    count: records.length,
    records,
    satrecs,
    indexByNoradId,
    groupIndices,
    droppedCount,
    generatedAt: file.generatedAt,
  }
}
