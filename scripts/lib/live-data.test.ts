import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseSatelliteFile } from '../../src/types/satellite-data.ts'
import { fetchLiveData, isFresh, productionUrlFromEnv } from './live-data.ts'
import { toOmmRecord } from './validate.ts'

describe('productionUrlFromEnv', () => {
  it('returns null when nothing is set', () => {
    expect(productionUrlFromEnv({})).toBeNull()
    expect(productionUrlFromEnv({ PRODUCTION_URL: '  ' })).toBeNull()
  })

  it('strips trailing slashes', () => {
    expect(productionUrlFromEnv({ PRODUCTION_URL: 'https://example.test/' })).toBe('https://example.test')
  })

  it("adds https to Vercel's bare hostname", () => {
    expect(productionUrlFromEnv({ VERCEL_PROJECT_PRODUCTION_URL: 'example.vercel.app' })).toBe(
      'https://example.vercel.app',
    )
  })

  it('prefers the explicit variable', () => {
    expect(
      productionUrlFromEnv({
        PRODUCTION_URL: 'https://custom.test',
        VERCEL_PROJECT_PRODUCTION_URL: 'example.vercel.app',
      }),
    ).toBe('https://custom.test')
  })
})

describe('isFresh', () => {
  const now = new Date('2026-11-16T12:00:00Z')

  it('is true inside the 2-hour CelesTrak update window', () => {
    expect(isFresh('2026-11-16T10:00:01Z', now)).toBe(true)
  })

  it('is false at 2 hours and beyond', () => {
    expect(isFresh('2026-11-16T10:00:00Z', now)).toBe(false)
    expect(isFresh('2026-11-15T12:00:00Z', now)).toBe(false)
  })

  it('is false for an unparseable timestamp', () => {
    expect(isFresh('not a date', now)).toBe(false)
  })
})

describe('fetchLiveData', () => {
  const validFile = {
    schemaVersion: 1,
    generatedAt: '2026-11-16T10:00:00Z',
    source: 'CelesTrak GP',
    count: 0,
    groups: { stations: [], starlink: [], 'gps-ops': [], weather: [] },
    satellites: [],
  }

  it('reads /data/satellites.json from the production site', async () => {
    let requested = ''
    const result = await fetchLiveData('https://example.test', async (url) => {
      requested = url
      return new Response(JSON.stringify(validFile))
    })
    expect(requested).toBe('https://example.test/data/satellites.json')
    expect(result.kind).toBe('ok')
  })

  it('reports a 404 as missing (first ever run)', async () => {
    const result = await fetchLiveData('https://example.test', async () => new Response('', { status: 404 }))
    expect(result).toEqual({ kind: 'missing' })
  })

  it('reports an HTML page served with a 200 as an error', async () => {
    const result = await fetchLiveData('https://example.test', async () => new Response('<!doctype html>'))
    expect(result.kind).toBe('error')
  })

  it('reports an unknown schema version as an error', async () => {
    const result = await fetchLiveData(
      'https://example.test',
      async () => new Response(JSON.stringify({ ...validFile, schemaVersion: 2 })),
    )
    expect(result.kind).toBe('error')
  })

  it('reports a network failure as an error instead of throwing', async () => {
    const result = await fetchLiveData('https://example.test', async () => {
      throw new Error('offline')
    })
    expect(result).toMatchObject({ kind: 'error' })
  })
})

describe('public/data/sample.json', () => {
  it('matches the data contract', async () => {
    const sample = parseSatelliteFile(
      JSON.parse(await readFile(new URL('../../public/data/sample.json', import.meta.url), 'utf8')),
    )
    const ids = new Set(sample.satellites.map((s) => s.NORAD_CAT_ID))

    expect(sample.count).toBeGreaterThanOrEqual(40)
    expect(ids.size).toBe(sample.count)
    expect(sample.groups.stations).toContain(25544)
    for (const record of sample.satellites) {
      expect(toOmmRecord(record)).toEqual(record)
    }
    for (const [name, groupIds] of Object.entries(sample.groups)) {
      expect(groupIds.length, name).toBeGreaterThan(0)
      for (const id of groupIds) expect(ids.has(id), `${name} ${id}`).toBe(true)
    }
  })
})
