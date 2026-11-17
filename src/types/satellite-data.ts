/**
 * The data contract between the pipeline and the app. Must match docs/data-contract.md.
 * Any breaking change bumps SCHEMA_VERSION and updates the doc, sample.json and the
 * fetch script in the same PR.
 */

export const SCHEMA_VERSION = 1

/**
 * One satellite's orbital elements, with CelesTrak's CCSDS OMM field names unchanged so
 * records can go straight to satellite.js's `json2satrec`.
 *
 * Units are OMM's: MEAN_MOTION in rev/day, angles in degrees, EPOCH in UTC without a
 * `Z` suffix.
 */
/**
 * Facts about a satellite from the CelesTrak satellite catalog (SATCAT), as its short
 * codes. All optional: the catalog is fetched separately from the orbital elements and
 * a satellite may be missing from it. `composables/catalogDetails.ts` turns the codes
 * into words.
 */
export interface CatalogDetails {
  /** Owner code, e.g. "US", "PRC", "ESA". */
  OWNER?: string
  /** UTC date, "YYYY-MM-DD". */
  LAUNCH_DATE?: string
  /** Launch site code, e.g. "AFETR". */
  LAUNCH_SITE?: string
  /** "PAY" (payload), "R/B" (rocket body), "DEB" (debris) or "UNK". */
  OBJECT_TYPE?: string
  /** Operational status code, e.g. "+" (operational). */
  OPS_STATUS_CODE?: string
}

export interface OmmRecord extends CatalogDetails {
  OBJECT_NAME: string
  /** International designator, e.g. "1998-067A". */
  OBJECT_ID: string
  /** Unique key. */
  NORAD_CAT_ID: number
  /** UTC, ISO 8601 without a zone suffix, e.g. "2026-11-16T12:01:23.456789". */
  EPOCH: string
  /** Revolutions per day. */
  MEAN_MOTION: number
  ECCENTRICITY: number
  /** Degrees. */
  INCLINATION: number
  /** Degrees. */
  RA_OF_ASC_NODE: number
  /** Degrees. */
  ARG_OF_PERICENTER: number
  /** Degrees. */
  MEAN_ANOMALY: number
  EPHEMERIS_TYPE: number
  CLASSIFICATION_TYPE: string
  ELEMENT_SET_NO: number
  REV_AT_EPOCH: number
  BSTAR: number
  MEAN_MOTION_DOT: number
  MEAN_MOTION_DDOT: number
}

export const GROUP_NAMES = ['stations', 'starlink', 'gps-ops', 'weather'] as const
export type GroupName = (typeof GROUP_NAMES)[number]

export interface SatelliteFile {
  schemaVersion: typeof SCHEMA_VERSION
  /** UTC ISO 8601 with `Z`: when the pipeline fetched the data. */
  generatedAt: string
  source: string
  /** Always equals `satellites.length`. */
  count: number
  /** Group name -> NORAD catalog IDs. A satellite can be in several groups or none. */
  groups: Record<GroupName, number[]>
  satellites: OmmRecord[]
  /**
   * UTC ISO 8601 with `Z`: when the pipeline last asked CelesTrak for the SATCAT,
   * whether or not it worked. Absent if it never has.
   */
  catalogCheckedAt?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Checks the envelope of a loaded file: version, timestamp, counts and group index.
 * Individual records are validated by the pipeline before deploy and again, cheaply,
 * when the app builds satrecs, so they are not re-walked here.
 *
 * Throws an Error with a user-presentable message if the file can't be used.
 */
export function parseSatelliteFile(json: unknown): SatelliteFile {
  if (!isObject(json)) throw new Error('Satellite data is not a JSON object.')

  if (json.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Satellite data has schema version ${String(json.schemaVersion)}, but this app reads version ${SCHEMA_VERSION}. Try reloading the page.`,
    )
  }
  if (typeof json.generatedAt !== 'string' || Number.isNaN(Date.parse(json.generatedAt))) {
    throw new Error('Satellite data has no valid generatedAt timestamp.')
  }
  if (!Array.isArray(json.satellites)) {
    throw new Error('Satellite data has no satellites array.')
  }
  if (json.count !== json.satellites.length) {
    throw new Error('Satellite data is incomplete: count does not match the satellites array.')
  }
  if (!isObject(json.groups)) throw new Error('Satellite data has no groups index.')
  for (const name of GROUP_NAMES) {
    if (!Array.isArray(json.groups[name])) {
      throw new Error(`Satellite data is missing the "${name}" group.`)
    }
  }

  return json as unknown as SatelliteFile
}
