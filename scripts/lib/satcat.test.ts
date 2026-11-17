import { describe, expect, it } from 'vitest'
import type { OmmRecord, SatelliteFile } from '../../src/types/satellite-data.ts'
import {
  addCatalogDetails,
  detailsFromFile,
  detailsFromSatcat,
  fetchSatcat,
  SATCAT_URL,
  toCatalogDetails,
  wasCheckedRecently,
  type FetchLike,
} from './satcat.ts'

const NOW = new Date('2026-11-17T06:23:00Z')

const ISS_SATCAT = {
  OBJECT_NAME: 'ISS (ZARYA)',
  OBJECT_ID: '1998-067A',
  NORAD_CAT_ID: 25544,
  OBJECT_TYPE: 'PAY',
  OPS_STATUS_CODE: '+',
  OWNER: 'ISS',
  LAUNCH_DATE: '1998-11-20',
  LAUNCH_SITE: 'TYMSC',
  DECAY_DATE: '',
  PERIOD: 92.94,
}
const ISS_DETAILS = {
  OWNER: 'ISS',
  LAUNCH_DATE: '1998-11-20',
  LAUNCH_SITE: 'TYMSC',
  OBJECT_TYPE: 'PAY',
  OPS_STATUS_CODE: '+',
}

function record(noradId: number, extra: Partial<OmmRecord> = {}): OmmRecord {
  return {
    OBJECT_NAME: `SAT ${noradId}`,
    OBJECT_ID: '2020-001A',
    NORAD_CAT_ID: noradId,
    EPOCH: '2026-11-16T12:00:00.000000',
    MEAN_MOTION: 15,
    ECCENTRICITY: 0.001,
    INCLINATION: 51,
    RA_OF_ASC_NODE: 0,
    ARG_OF_PERICENTER: 0,
    MEAN_ANOMALY: 0,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 1,
    BSTAR: 0,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
    ...extra,
  }
}

function fileOf(satellites: OmmRecord[], catalogCheckedAt?: string): SatelliteFile {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-17T06:23:00Z',
    source: 'CelesTrak GP',
    count: satellites.length,
    groups: { stations: [], starlink: [], 'gps-ops': [], weather: [] },
    satellites,
    ...(catalogCheckedAt === undefined ? {} : { catalogCheckedAt }),
  }
}

function respondWith(body: unknown, status = 200): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    fetchImpl: (url) => {
      urls.push(url)
      return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
    },
  }
}

describe('toCatalogDetails', () => {
  it('keeps only the five detail fields', () => {
    expect(toCatalogDetails(ISS_SATCAT)).toEqual({ noradId: 25544, details: ISS_DETAILS })
  })

  it('drops fields that do not look right, keeping the rest', () => {
    const parsed = toCatalogDetails({
      ...ISS_SATCAT,
      LAUNCH_DATE: 'soon',
      OBJECT_TYPE: 'SHIP',
      OWNER: '<script>',
    })
    expect(parsed!.details).toEqual({ LAUNCH_SITE: 'TYMSC', OPS_STATUS_CODE: '+' })
  })

  it('rejects records without a catalog number or with nothing usable', () => {
    expect(toCatalogDetails({ ...ISS_SATCAT, NORAD_CAT_ID: '25544' })).toBeNull()
    expect(toCatalogDetails({ NORAD_CAT_ID: 5 })).toBeNull()
    expect(toCatalogDetails(null)).toBeNull()
  })
})

describe('detailsFromSatcat and detailsFromFile', () => {
  it('indexes by NORAD ID, first occurrence winning', () => {
    const byId = detailsFromSatcat([ISS_SATCAT, { ...ISS_SATCAT, OWNER: 'US' }, 'junk'])
    expect(byId.size).toBe(1)
    expect(byId.get(25544)!.OWNER).toBe('ISS')
  })

  it('reads details back from a file that has them', () => {
    const byId = detailsFromFile(fileOf([record(25544, ISS_DETAILS), record(7)]))
    expect([...byId.keys()]).toEqual([25544])
    expect(byId.get(25544)).toEqual(ISS_DETAILS)
  })
})

describe('wasCheckedRecently', () => {
  it('is true inside 24 hours and false at or beyond it', () => {
    expect(wasCheckedRecently('2026-11-16T06:24:00Z', NOW)).toBe(true)
    expect(wasCheckedRecently('2026-11-16T06:23:00Z', NOW)).toBe(false)
    expect(wasCheckedRecently(undefined, NOW)).toBe(false)
    expect(wasCheckedRecently('nonsense', NOW)).toBe(false)
  })
})

describe('fetchSatcat', () => {
  it('makes exactly one request to the documented URL', async () => {
    const { fetchImpl, urls } = respondWith([ISS_SATCAT])
    const result = await fetchSatcat(fetchImpl)
    expect(result).toEqual({ kind: 'ok', records: [ISS_SATCAT] })
    expect(urls).toEqual([SATCAT_URL])
    expect(SATCAT_URL).toMatch(/^https:\/\/celestrak\.org\/satcat\/records\.php\?GROUP=active&FORMAT=JSON$/)
  })

  it.each([403, 404, 500, 503])('does not retry on HTTP %i', async (status) => {
    const { fetchImpl, urls } = respondWith('no', status)
    expect(await fetchSatcat(fetchImpl)).toEqual({ kind: 'error', message: `HTTP ${status}` })
    expect(urls).toHaveLength(1)
  })

  it('rejects a body that is not a JSON array', async () => {
    expect((await fetchSatcat(respondWith('Invalid query').fetchImpl)).kind).toBe('error')
    expect((await fetchSatcat(respondWith({ error: 1 }).fetchImpl)).kind).toBe('error')
  })

  it('reports a network failure without throwing', async () => {
    const result = await fetchSatcat(() => Promise.reject(new Error('offline')))
    expect(result.kind).toBe('error')
  })
})

describe('addCatalogDetails', () => {
  const fresh = fileOf([record(25544), record(7)])

  it('fetches when the live file has never been checked, and stamps the time', async () => {
    const { fetchImpl, urls } = respondWith([ISS_SATCAT, { ...ISS_SATCAT, NORAD_CAT_ID: 7, OWNER: 'US' }])
    const result = await addCatalogDetails({ file: fresh, live: null, now: NOW, fetchImpl })
    expect(urls).toHaveLength(1)
    expect(result.warning).toBeNull()
    expect(result.file.catalogCheckedAt).toBe('2026-11-17T06:23:00Z')
    expect(result.file.satellites[0]).toMatchObject(ISS_DETAILS)
    expect(result.file.satellites[1]!.OWNER).toBe('US')
    // Orbital fields are untouched.
    expect(result.file.satellites[0]!.MEAN_MOTION).toBe(15)
    expect(result.file.count).toBe(2)
  })

  it('does not contact CelesTrak within 24 hours of the last check, and carries details over', async () => {
    const live = fileOf([record(25544, ISS_DETAILS)], '2026-11-17T00:23:00Z')
    const { fetchImpl, urls } = respondWith([])
    const result = await addCatalogDetails({ file: fresh, live, now: NOW, fetchImpl })
    expect(urls).toEqual([])
    expect(result.file.catalogCheckedAt).toBe('2026-11-17T00:23:00Z')
    expect(result.file.satellites[0]).toMatchObject(ISS_DETAILS)
    expect(result.file.satellites[1]!.OWNER).toBeUndefined()
  })

  it('keeps the old details and warns when the request fails, and still stamps the attempt', async () => {
    const live = fileOf([record(25544, ISS_DETAILS)], '2026-11-15T00:00:00Z')
    const { fetchImpl, urls } = respondWith('gone', 404)
    const result = await addCatalogDetails({ file: fresh, live, now: NOW, fetchImpl })
    expect(urls).toHaveLength(1)
    expect(result.warning).toMatch(/HTTP 404/)
    expect(result.file.satellites[0]).toMatchObject(ISS_DETAILS)
    // So the next run, six hours later, does not ask again.
    expect(result.file.catalogCheckedAt).toBe('2026-11-17T06:23:00Z')
  })

  it('refuses an answer that covers too few satellites', async () => {
    const many = fileOf(Array.from({ length: 10 }, (_, i) => record(i + 1)))
    const live = fileOf([record(1, { OWNER: 'UK' })], '2026-11-15T00:00:00Z')
    const { fetchImpl } = respondWith([{ ...ISS_SATCAT, NORAD_CAT_ID: 1 }])
    const result = await addCatalogDetails({ file: many, live, now: NOW, fetchImpl })
    expect(result.warning).toMatch(/only 10%/)
    expect(result.file.satellites[0]!.OWNER).toBe('UK')
  })

  it('keeps live details for satellites a good answer leaves out', async () => {
    const five = fileOf([1, 2, 3, 4, 5].map((id) => record(id)))
    const live = fileOf([record(5, { OWNER: 'JPN' })], '2026-11-15T00:00:00Z')
    const { fetchImpl } = respondWith([1, 2, 3, 4].map((id) => ({ ...ISS_SATCAT, NORAD_CAT_ID: id })))
    const result = await addCatalogDetails({ file: five, live, now: NOW, fetchImpl })
    expect(result.warning).toBeNull()
    expect(result.file.satellites[4]!.OWNER).toBe('JPN')
    expect(result.file.satellites[0]!.OWNER).toBe('ISS')
  })
})
