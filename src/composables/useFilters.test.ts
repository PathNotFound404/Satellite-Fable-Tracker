import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildCatalog } from '../orbital/catalog'
import { GROUP_NAMES, parseSatelliteFile } from '../types/satellite-data'
import { groupLabelsFor } from './groups'
import { buildFilterMask } from './useFilters'

const sample = parseSatelliteFile(
  JSON.parse(readFileSync(new URL('../../public/data/sample.json', import.meta.url), 'utf8')),
)
const catalog = buildCatalog(sample)

describe('buildFilterMask', () => {
  it('returns null for "all" (no mask)', () => {
    expect(buildFilterMask(catalog, 'all')).toBeNull()
  })

  it.each(GROUP_NAMES)('marks exactly the members of %s', (name) => {
    const mask = buildFilterMask(catalog, name)!
    expect(mask).toHaveLength(catalog.count)

    const marked = [...mask.keys()].filter((index) => mask[index] === 1)
    expect(marked).toEqual(Array.from(catalog.groupIndices[name]))
    expect(marked.length).toBe(sample.groups[name].length)
  })

  it('shows only Starlink names for the starlink filter', () => {
    const mask = buildFilterMask(catalog, 'starlink')!
    catalog.records.forEach((record, index) => {
      expect(mask[index] === 1).toBe(record.OBJECT_NAME.startsWith('STARLINK'))
    })
  })
})

describe('groupLabelsFor', () => {
  it('names the groups a satellite belongs to', () => {
    const iss = catalog.indexByNoradId.get(25544)!
    expect(groupLabelsFor(catalog, iss)).toEqual(['Space stations'])
  })

  it('returns nothing for a satellite in no group', () => {
    const hubble = catalog.records.findIndex((record) => record.OBJECT_NAME === 'HST')
    expect(hubble).toBeGreaterThanOrEqual(0)
    expect(groupLabelsFor(catalog, hubble)).toEqual([])
  })
})
