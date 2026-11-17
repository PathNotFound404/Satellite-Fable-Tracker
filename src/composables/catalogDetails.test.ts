import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSatelliteFile } from '../types/satellite-data'
import { describeCatalogDetails } from './catalogDetails'

const sample = parseSatelliteFile(
  JSON.parse(readFileSync(new URL('../../public/data/sample.json', import.meta.url), 'utf8')),
)

describe('describeCatalogDetails', () => {
  it('spells out the codes, in display order', () => {
    const rows = describeCatalogDetails({
      OWNER: 'US',
      LAUNCH_DATE: '1998-11-20',
      LAUNCH_SITE: 'TYMSC',
      OBJECT_TYPE: 'PAY',
      OPS_STATUS_CODE: '+',
    })
    expect(rows.map((row) => row.label)).toEqual(['Owner', 'Launched', 'Launch site', 'Type', 'Status'])
    expect(rows[0]!.value).toBe('United States')
    expect(rows[1]!.value).toMatch(/1998/)
    expect(rows[1]!.value).toMatch(/20/)
    expect(rows[2]!.value).toBe('Baikonur Cosmodrome, Kazakhstan')
    expect(rows[3]!.value).toBe('Payload')
    expect(rows[4]!.value).toBe('Operational')
  })

  it('does not shift the launch date into the previous day in western time zones', () => {
    // Formatted in UTC, so the day is 1 whatever the viewer's zone.
    const [row] = describeCatalogDetails({ LAUNCH_DATE: '2024-03-01' })
    expect(row!.value).toMatch(/\b0?1\b/)
    expect(row!.value).toMatch(/2024/)
  })

  it('shows a code it does not know as it is', () => {
    const rows = describeCatalogDetails({ OWNER: 'NEWX', LAUNCH_SITE: 'MOON', OBJECT_TYPE: 'XYZ', OPS_STATUS_CODE: 'Q' })
    expect(rows.map((row) => row.value)).toEqual(['NEWX', 'MOON', 'XYZ', 'Q'])
  })

  it('leaves out what the catalog does not have', () => {
    expect(describeCatalogDetails({})).toEqual([])
    expect(describeCatalogDetails({ OWNER: 'ESA' })).toEqual([{ label: 'Owner', value: 'European Space Agency' }])
  })

  it('knows every code in the sample data', () => {
    const withDetails = sample.satellites.filter((record) => record.OWNER !== undefined)
    expect(withDetails.length).toBe(sample.count)
    for (const record of withDetails) {
      const rows = describeCatalogDetails(record)
      expect(rows).toHaveLength(5)
      expect(rows[0]!.value, `owner ${record.OWNER}`).not.toBe(record.OWNER)
      expect(rows[2]!.value, `site ${record.LAUNCH_SITE}`).not.toBe(record.LAUNCH_SITE)
      expect(rows[3]!.value).not.toBe(record.OBJECT_TYPE)
      expect(rows[4]!.value).not.toBe(record.OPS_STATUS_CODE)
    }
  })
})
