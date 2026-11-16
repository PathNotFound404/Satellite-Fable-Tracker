import { describe, expect, it } from 'vitest'
import { parseSatelliteFile } from './satellite-data'

function validFile(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-16T18:23:05Z',
    source: 'CelesTrak GP',
    count: 1,
    groups: { stations: [25544], starlink: [], 'gps-ops': [], weather: [] },
    satellites: [{ OBJECT_NAME: 'ISS (ZARYA)', NORAD_CAT_ID: 25544 }],
  }
}

describe('parseSatelliteFile', () => {
  it('accepts a valid file and returns it unchanged', () => {
    const json = validFile()
    expect(parseSatelliteFile(json)).toBe(json)
  })

  it('rejects an unknown schema version with a message that names both versions', () => {
    expect(() => parseSatelliteFile({ ...validFile(), schemaVersion: 2 })).toThrow(
      /schema version 2.*reads version 1/,
    )
  })

  it.each([
    ['a non-object', [1, 2, 3], /not a JSON object/],
    ['null', null, /not a JSON object/],
    ['a missing timestamp', { ...validFile(), generatedAt: undefined }, /generatedAt/],
    ['an invalid timestamp', { ...validFile(), generatedAt: 'soon' }, /generatedAt/],
    ['a missing satellites array', { ...validFile(), satellites: undefined }, /satellites array/],
    ['a truncated satellites array', { ...validFile(), count: 2 }, /count does not match/],
    ['missing groups', { ...validFile(), groups: undefined }, /groups index/],
    [
      'a missing group',
      { ...validFile(), groups: { stations: [], starlink: [], weather: [] } },
      /"gps-ops" group/,
    ],
  ])('rejects %s', (_label, json, message) => {
    expect(() => parseSatelliteFile(json)).toThrow(message)
  })
})
