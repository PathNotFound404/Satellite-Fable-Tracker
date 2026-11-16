import type { GroupName, OmmRecord, SatelliteFile } from '../../src/types/satellite-data.ts'

/**
 * Turns raw CelesTrak responses into a SatelliteFile, or explains why it refused to.
 * Implements the validation list in docs/data-contract.md. Pure: no I/O, no clock.
 */

export const ISS_NORAD_ID = 25544
/** Fewer `active` records than this means a truncated or wrong response. */
export const MIN_ACTIVE_RECORDS = 5000
/** A new file must have at least this share of the live file's count. */
export const MIN_SHARE_OF_LIVE_COUNT = 0.8
/** More malformed records than this share fails the run instead of quietly shrinking. */
export const MAX_DROPPED_SHARE = 0.01

const STRING_FIELDS = ['OBJECT_NAME', 'OBJECT_ID', 'EPOCH', 'CLASSIFICATION_TYPE'] as const
const NUMBER_FIELDS = [
  'NORAD_CAT_ID',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'EPHEMERIS_TYPE',
  'ELEMENT_SET_NO',
  'REV_AT_EPOCH',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
] as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Returns a record holding only the contract's fields, or null if any required field
 * is missing or has the wrong type. Extra CelesTrak fields are dropped to save size.
 */
export function toOmmRecord(raw: unknown): OmmRecord | null {
  if (!isObject(raw)) return null

  for (const field of STRING_FIELDS) {
    if (typeof raw[field] !== 'string') return null
  }
  for (const field of NUMBER_FIELDS) {
    const value = raw[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
  }

  const noradId = raw.NORAD_CAT_ID as number
  if (!Number.isInteger(noradId) || noradId <= 0) return null
  if ((raw.OBJECT_NAME as string).trim() === '') return null
  // EPOCH has no zone suffix; it is UTC by contract.
  if (Number.isNaN(Date.parse(`${raw.EPOCH as string}Z`))) return null
  if ((raw.MEAN_MOTION as number) <= 0) return null
  const eccentricity = raw.ECCENTRICITY as number
  if (eccentricity < 0 || eccentricity >= 1) return null

  return {
    OBJECT_NAME: raw.OBJECT_NAME as string,
    OBJECT_ID: raw.OBJECT_ID as string,
    NORAD_CAT_ID: noradId,
    EPOCH: raw.EPOCH as string,
    MEAN_MOTION: raw.MEAN_MOTION as number,
    ECCENTRICITY: eccentricity,
    INCLINATION: raw.INCLINATION as number,
    RA_OF_ASC_NODE: raw.RA_OF_ASC_NODE as number,
    ARG_OF_PERICENTER: raw.ARG_OF_PERICENTER as number,
    MEAN_ANOMALY: raw.MEAN_ANOMALY as number,
    EPHEMERIS_TYPE: raw.EPHEMERIS_TYPE as number,
    CLASSIFICATION_TYPE: raw.CLASSIFICATION_TYPE as string,
    ELEMENT_SET_NO: raw.ELEMENT_SET_NO as number,
    REV_AT_EPOCH: raw.REV_AT_EPOCH as number,
    BSTAR: raw.BSTAR as number,
    MEAN_MOTION_DOT: raw.MEAN_MOTION_DOT as number,
    MEAN_MOTION_DDOT: raw.MEAN_MOTION_DDOT as number,
  }
}

/** NORAD IDs from a tag-group response. Only the ID matters; elements come from `active`. */
function noradIdsOf(rawRecords: readonly unknown[]): number[] {
  const ids: number[] = []
  for (const raw of rawRecords) {
    if (isObject(raw) && typeof raw.NORAD_CAT_ID === 'number' && Number.isInteger(raw.NORAD_CAT_ID)) {
      ids.push(raw.NORAD_CAT_ID)
    }
  }
  return ids
}

export interface BuildInput {
  /** Raw JSON arrays exactly as CelesTrak returned them. */
  active: readonly unknown[]
  stations: readonly unknown[]
  gpsOps: readonly unknown[]
  weather: readonly unknown[]
  /** When the fetch happened. */
  generatedAt: Date
  /** `count` of the file currently live, or null if there is none yet. */
  liveCount: number | null
}

export type BuildResult =
  | { ok: true; file: SatelliteFile; notes: string[] }
  | { ok: false; errors: string[]; notes: string[] }

export function buildSatelliteFile(input: BuildInput): BuildResult {
  const errors: string[] = []
  const notes: string[] = []

  // Records: keep valid ones, first occurrence of each NORAD ID wins.
  const satellites: OmmRecord[] = []
  const seenIds = new Set<number>()
  let malformed = 0
  let duplicates = 0
  for (const raw of input.active) {
    const record = toOmmRecord(raw)
    if (record === null) {
      malformed++
      continue
    }
    if (seenIds.has(record.NORAD_CAT_ID)) {
      duplicates++
      continue
    }
    seenIds.add(record.NORAD_CAT_ID)
    satellites.push(record)
  }
  if (malformed > 0) notes.push(`Dropped ${malformed} malformed record(s) from active.`)
  if (duplicates > 0) notes.push(`Dropped ${duplicates} duplicate NORAD ID(s) from active.`)

  if (input.active.length < MIN_ACTIVE_RECORDS) {
    errors.push(
      `active has ${input.active.length} records; expected at least ${MIN_ACTIVE_RECORDS}.`,
    )
  }
  if (input.active.length > 0 && malformed / input.active.length > MAX_DROPPED_SHARE) {
    errors.push(
      `${malformed} of ${input.active.length} active records are malformed (more than ${MAX_DROPPED_SHARE * 100}%).`,
    )
  }
  if (input.liveCount !== null && satellites.length < input.liveCount * MIN_SHARE_OF_LIVE_COUNT) {
    errors.push(
      `New file has ${satellites.length} satellites, under ${MIN_SHARE_OF_LIVE_COUNT * 100}% of the live file's ${input.liveCount}.`,
    )
  }

  // Groups: tag-group IDs are kept only if the satellite is also in `active`.
  const inActive = (ids: number[]): number[] => [...new Set(ids)].filter((id) => seenIds.has(id))
  const groups: Record<GroupName, number[]> = {
    stations: inActive(noradIdsOf(input.stations)),
    // Not fetched: `starlink` is a subset of `active`, so we tag it by name instead.
    starlink: satellites
      .filter((record) => record.OBJECT_NAME.toUpperCase().startsWith('STARLINK'))
      .map((record) => record.NORAD_CAT_ID),
    'gps-ops': inActive(noradIdsOf(input.gpsOps)),
    weather: inActive(noradIdsOf(input.weather)),
  }
  for (const [name, ids] of Object.entries(groups)) {
    if (ids.length === 0) errors.push(`Group "${name}" is empty.`)
  }
  if (!groups.stations.includes(ISS_NORAD_ID)) {
    errors.push(`Group "stations" does not contain the ISS (${ISS_NORAD_ID}).`)
  }

  if (errors.length > 0) return { ok: false, errors, notes }

  return {
    ok: true,
    notes,
    file: {
      schemaVersion: 1,
      // Whole seconds: sub-second precision would be false precision for a fetch time.
      generatedAt: input.generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      source: 'CelesTrak GP',
      count: satellites.length,
      groups,
      satellites,
    },
  }
}
