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

/**
 * Builds a catalog a slice at a time. Setting up SGP4 for the full catalog takes a
 * couple of hundred milliseconds (far more on a phone), which would freeze the page
 * if done in one go.
 */
function createCatalogBuilder(file: SatelliteFile) {
  const records: OmmRecord[] = []
  const satrecs: SatRec[] = []
  const indexByNoradId = new Map<number, number>()
  let droppedCount = 0
  let next = 0

  return {
    /** Processes records until `shouldPause` says stop. Returns true when all are done. */
    work(shouldPause: () => boolean): boolean {
      while (next < file.satellites.length) {
        const record = file.satellites[next]!
        next++
        const satrec = createSatrec(record)
        if (satrec === null) {
          droppedCount++
        } else {
          indexByNoradId.set(record.NORAD_CAT_ID, records.length)
          records.push(record)
          satrecs.push(satrec)
        }
        if (shouldPause()) break
      }
      return next >= file.satellites.length
    },
    finish: (): Catalog => finishCatalog(file, records, satrecs, indexByNoradId, droppedCount),
  }
}

/** Builds the whole catalog at once. For tests, scripts and small files. */
export function buildCatalog(file: SatelliteFile): Catalog {
  const builder = createCatalogBuilder(file)
  builder.work(() => false)
  return builder.finish()
}

/** How long one slice of `buildCatalogInSlices` may run before giving the page a turn. */
const SLICE_MS = 8

/**
 * Builds the catalog without blocking the page for more than a few milliseconds at a
 * time: works for a slice, then calls `pause` (which should resolve after the browser
 * has had a chance to paint and handle input). Resolves to null if `isCancelled`
 * returns true at a pause, so a build for data that is no longer wanted stops early.
 */
export async function buildCatalogInSlices(
  file: SatelliteFile,
  pause: () => Promise<void>,
  isCancelled: () => boolean = () => false,
): Promise<Catalog | null> {
  const builder = createCatalogBuilder(file)
  for (;;) {
    const sliceEnd = performance.now() + SLICE_MS
    if (builder.work(() => performance.now() >= sliceEnd)) return builder.finish()
    await pause()
    if (isCancelled()) return null
  }
}

function finishCatalog(
  file: SatelliteFile,
  records: OmmRecord[],
  satrecs: SatRec[],
  indexByNoradId: Map<number, number>,
  droppedCount: number,
): Catalog {
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
