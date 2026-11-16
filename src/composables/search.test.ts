import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildCatalog } from '../orbital/catalog'
import { parseSatelliteFile } from '../types/satellite-data'
import { buildSearchIndex, normalizeQuery, searchCatalog, type SearchIndex } from './search'

const sample = parseSatelliteFile(
  JSON.parse(readFileSync(new URL('../../public/data/sample.json', import.meta.url), 'utf8')),
)
const catalog = buildCatalog(sample)
const index = buildSearchIndex(catalog)

const namesOf = (results: number[]): string[] => results.map((i) => catalog.records[i]!.OBJECT_NAME)

/** A hand-made index for ranking tests. */
function indexOf(entries: Array<[name: string, id: number]>): SearchIndex {
  return { names: entries.map(([name]) => name.toUpperCase()), ids: entries.map(([, id]) => String(id)) }
}

describe('normalizeQuery', () => {
  it('trims, collapses spaces and upper-cases', () => {
    expect(normalizeQuery('  iss   (zarya) ')).toBe('ISS (ZARYA)')
  })
})

describe('searchCatalog', () => {
  it('finds the ISS first when typing "ISS"', () => {
    expect(namesOf(searchCatalog(index, 'ISS', 10))[0]).toBe('ISS (ZARYA)')
  })

  it('is case-insensitive and ignores surrounding spaces', () => {
    expect(namesOf(searchCatalog(index, '  iss (zar ', 10))).toEqual(['ISS (ZARYA)'])
  })

  it('finds a satellite by exact NORAD ID', () => {
    expect(namesOf(searchCatalog(index, '25544', 10))[0]).toBe('ISS (ZARYA)')
  })

  it('finds satellites by NORAD ID prefix', () => {
    const results = searchCatalog(index, '255', 10)
    expect(results.map((i) => catalog.records[i]!.NORAD_CAT_ID)).toContain(25544)
  })

  it('returns nothing for an empty or whitespace query', () => {
    expect(searchCatalog(index, '', 10)).toEqual([])
    expect(searchCatalog(index, '   ', 10)).toEqual([])
  })

  it('returns nothing when nothing matches', () => {
    expect(searchCatalog(index, 'zzzzqqq', 10)).toEqual([])
  })

  it('respects the limit', () => {
    expect(searchCatalog(index, 'STARLINK', 5)).toHaveLength(5)
    expect(searchCatalog(index, 'STARLINK', 0)).toEqual([])
  })

  it('ranks exact, then prefix, then word start, then substring', () => {
    const ranked = indexOf([
      ['KISS-1', 1],
      ['CSS (ISS-LIKE)', 2],
      ['ISS (ZARYA)', 3],
      ['ISS', 4],
      ['MISSION 5', 5],
    ])
    expect(searchCatalog(ranked, 'iss', 10)).toEqual([3, 2, 1, 0, 4])
  })

  it('keeps catalog order within a rank', () => {
    const ranked = indexOf([
      ['ISS (ZARYA)', 25544],
      ['ISS (NAUKA)', 49044],
    ])
    expect(searchCatalog(ranked, 'ISS', 10)).toEqual([0, 1])
  })

  it('treats digits inside a name as a name match too', () => {
    const ranked = indexOf([
      ['STARLINK-1008', 44714],
      ['NAVSTAR 48', 1008],
    ])
    // Exact ID first, then the name containing the digits.
    expect(searchCatalog(ranked, '1008', 10)).toEqual([1, 0])
  })

  it('leaves out satellites the caller excludes', () => {
    const issIndex = catalog.indexByNoradId.get(25544)!
    const results = searchCatalog(index, 'ISS', 10, (i) => i !== issIndex)
    expect(results).not.toContain(issIndex)
  })

  it('stays fast on a full-size catalog', () => {
    const entries: Array<[string, number]> = []
    for (let i = 0; i < 17_000; i++) entries.push([`STARLINK-${30000 + i}`, 50000 + i])
    const big = indexOf(entries)

    searchCatalog(big, 'starlink-31', 50)
    const start = performance.now()
    const results = searchCatalog(big, 'starlink-31', 50)
    const elapsedMs = performance.now() - start

    expect(results).toHaveLength(50)
    expect(elapsedMs).toBeLessThan(16)
  })
})
