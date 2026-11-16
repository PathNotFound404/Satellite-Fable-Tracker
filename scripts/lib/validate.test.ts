import { describe, expect, it } from 'vitest'
import {
  buildSatelliteFile,
  ISS_NORAD_ID,
  MIN_ACTIVE_RECORDS,
  toOmmRecord,
  type BuildInput,
} from './validate.ts'

/** A raw CelesTrak-shaped record, including a field the contract drops. */
function rawRecord(noradId: number, name = `SAT ${noradId}`): Record<string, unknown> {
  return {
    OBJECT_NAME: name,
    OBJECT_ID: '1998-067A',
    EPOCH: '2026-11-16T12:01:23.456789',
    MEAN_MOTION: 15.5,
    ECCENTRICITY: 0.0006703,
    INCLINATION: 51.6416,
    RA_OF_ASC_NODE: 247.4627,
    ARG_OF_PERICENTER: 130.536,
    MEAN_ANOMALY: 325.0288,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: noradId,
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 49999,
    BSTAR: 0.00025,
    MEAN_MOTION_DOT: 0.00001,
    MEAN_MOTION_DDOT: 0,
    SOME_FUTURE_FIELD: 'ignored',
  }
}

const GPS_ID = 30000
const WEATHER_ID = 30001

/** A healthy response set: enough records, the ISS, some Starlinks, every tag group. */
function healthyInput(overrides: Partial<BuildInput> = {}): BuildInput {
  const active: unknown[] = [rawRecord(ISS_NORAD_ID, 'ISS (ZARYA)')]
  for (let id = 30000; active.length < MIN_ACTIVE_RECORDS + 100; id++) {
    active.push(rawRecord(id, id % 2 === 0 ? `SAT ${id}` : `STARLINK-${id}`))
  }
  return {
    active,
    stations: [rawRecord(ISS_NORAD_ID, 'ISS (ZARYA)')],
    gpsOps: [rawRecord(GPS_ID)],
    weather: [rawRecord(WEATHER_ID)],
    generatedAt: new Date('2026-11-16T18:23:05.678Z'),
    liveCount: null,
    ...overrides,
  }
}

function expectFailure(input: BuildInput): string[] {
  const result = buildSatelliteFile(input)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.errors
}

describe('toOmmRecord', () => {
  it('keeps exactly the contract fields', () => {
    const record = toOmmRecord(rawRecord(25544))
    expect(record).not.toBeNull()
    expect(Object.keys(record!)).toHaveLength(17)
    expect(record).not.toHaveProperty('SOME_FUTURE_FIELD')
    expect(record!.NORAD_CAT_ID).toBe(25544)
  })

  it('accepts 6-digit catalog numbers', () => {
    expect(toOmmRecord(rawRecord(100712))?.NORAD_CAT_ID).toBe(100712)
  })

  it.each([
    ['a missing field', { MEAN_MOTION: undefined }],
    ['a numeric field sent as a string', { INCLINATION: '51.6' }],
    ['a string field sent as a number', { OBJECT_NAME: 42 }],
    ['NaN', { BSTAR: Number.NaN }],
    ['a non-integer catalog number', { NORAD_CAT_ID: 25544.5 }],
    ['a blank name', { OBJECT_NAME: '  ' }],
    ['an unparseable epoch', { EPOCH: 'yesterday' }],
    ['zero mean motion', { MEAN_MOTION: 0 }],
    ['eccentricity of 1 or more', { ECCENTRICITY: 1 }],
  ])('rejects %s', (_label, patch) => {
    expect(toOmmRecord({ ...rawRecord(25544), ...patch })).toBeNull()
  })

  it.each([null, 'text', 42, []])('rejects non-object %j', (value) => {
    expect(toOmmRecord(value)).toBeNull()
  })
})

describe('buildSatelliteFile', () => {
  it('builds a file that satisfies the contract', () => {
    const input = healthyInput()
    const result = buildSatelliteFile(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { file } = result
    expect(file.schemaVersion).toBe(1)
    expect(file.source).toBe('CelesTrak GP')
    expect(file.generatedAt).toBe('2026-11-16T18:23:05Z')
    expect(file.count).toBe(input.active.length)
    expect(file.count).toBe(file.satellites.length)
    expect(file.groups.stations).toEqual([ISS_NORAD_ID])
    expect(file.groups['gps-ops']).toEqual([GPS_ID])
    expect(file.groups.weather).toEqual([WEATHER_ID])
  })

  it('tags Starlink by name instead of fetching the starlink group', () => {
    const result = buildSatelliteFile(healthyInput())
    if (!result.ok) throw new Error('expected success')
    const names = new Map(result.file.satellites.map((s) => [s.NORAD_CAT_ID, s.OBJECT_NAME]))
    expect(result.file.groups.starlink.length).toBeGreaterThan(1000)
    for (const id of result.file.groups.starlink) {
      expect(names.get(id)).toMatch(/^STARLINK/)
    }
  })

  it('drops tag-group IDs that are not in active', () => {
    const result = buildSatelliteFile(
      healthyInput({ gpsOps: [rawRecord(GPS_ID), rawRecord(999999)] }),
    )
    if (!result.ok) throw new Error('expected success')
    expect(result.file.groups['gps-ops']).toEqual([GPS_ID])
  })

  it('drops duplicates, keeps the first and says so', () => {
    const input = healthyInput()
    const withDuplicate = [...input.active, rawRecord(ISS_NORAD_ID, 'ISS COPY')]
    const result = buildSatelliteFile({ ...input, active: withDuplicate })
    if (!result.ok) throw new Error('expected success')
    expect(result.file.count).toBe(input.active.length)
    expect(result.file.satellites.filter((s) => s.NORAD_CAT_ID === ISS_NORAD_ID)).toHaveLength(1)
    expect(result.file.satellites.find((s) => s.NORAD_CAT_ID === ISS_NORAD_ID)!.OBJECT_NAME).toBe('ISS (ZARYA)')
    expect(result.notes.join(' ')).toMatch(/1 duplicate/)
  })

  it('drops a few malformed records and says so', () => {
    const input = healthyInput()
    const result = buildSatelliteFile({ ...input, active: [...input.active, { junk: true }] })
    if (!result.ok) throw new Error('expected success')
    expect(result.file.count).toBe(input.active.length)
    expect(result.notes.join(' ')).toMatch(/1 malformed/)
  })

  describe('refuses to build (so the last good file stays live)', () => {
    it('an empty response', () => {
      const errors = expectFailure(healthyInput({ active: [] }))
      expect(errors.join(' ')).toMatch(/active has 0 records/)
    })

    it('too few records', () => {
      const input = healthyInput()
      const errors = expectFailure({ ...input, active: input.active.slice(0, MIN_ACTIVE_RECORDS - 1) })
      expect(errors.join(' ')).toMatch(/expected at least 5000/)
    })

    it('a partial response compared with the live file', () => {
      const input = healthyInput()
      const errors = expectFailure({ ...input, liveCount: input.active.length * 2 })
      expect(errors.join(' ')).toMatch(/under 80% of the live file/)
    })

    it('more than 1% malformed records', () => {
      const input = healthyInput()
      const junk = Array.from({ length: Math.ceil(input.active.length * 0.02) }, () => ({ junk: true }))
      const errors = expectFailure({ ...input, active: [...input.active, ...junk] })
      expect(errors.join(' ')).toMatch(/malformed/)
    })

    it('stations without the ISS', () => {
      const errors = expectFailure(healthyInput({ stations: [rawRecord(GPS_ID)] }))
      expect(errors.join(' ')).toMatch(/does not contain the ISS/)
    })

    it.each([
      ['stations', { stations: [] }],
      ['gps-ops', { gpsOps: [] }],
      ['weather', { weather: [] }],
    ])('an empty %s group', (name, patch) => {
      const errors = expectFailure(healthyInput(patch))
      expect(errors.join(' ')).toContain(`Group "${name}" is empty`)
    })

    it('no Starlink satellites at all', () => {
      const input = healthyInput()
      const renamed = input.active.map((raw) => ({
        ...(raw as Record<string, unknown>),
        OBJECT_NAME: 'PLAIN SAT',
      }))
      const errors = expectFailure({ ...input, active: renamed })
      expect(errors.join(' ')).toContain('Group "starlink" is empty')
    })
  })

  it('accepts a count at exactly 80% of the live file', () => {
    const input = healthyInput()
    const result = buildSatelliteFile({ ...input, liveCount: input.active.length / 0.8 })
    expect(result.ok).toBe(true)
  })
})
