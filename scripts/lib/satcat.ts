import type { CatalogDetails, OmmRecord, SatelliteFile } from '../../src/types/satellite-data.ts'

/**
 * Catalog details (owner, launch date, launch site, object type, status) from the
 * CelesTrak satellite catalog (SATCAT). The GP element sets carry none of these.
 *
 * Fair use (docs/ci-cd.md): the SATCAT updates once or twice a day, so it is asked for
 * at most once per 24 hours, in one request, with no retries. Between checks the
 * details already on the live site are carried over. A failed check never blocks the
 * orbital data: the old details are kept and a human is told.
 */

export const SATCAT_URL = 'https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=JSON'

/** Never ask CelesTrak for the SATCAT more often than this, whether or not the last try worked. */
export const SATCAT_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000
/** A response covering fewer of our satellites than this share is treated as broken. */
export const MIN_SATCAT_COVERAGE = 0.8

const OBJECT_TYPES = ['PAY', 'R/B', 'DEB', 'UNK']
const DETAIL_FIELDS = ['OWNER', 'LAUNCH_DATE', 'LAUNCH_SITE', 'OBJECT_TYPE', 'OPS_STATUS_CODE'] as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A short code as CelesTrak writes them: 1 to 8 letters, digits or symbols, no spaces. */
function code(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\w+\-?/]{1,8}$/.test(value) ? value : undefined
}

/**
 * The details of one SATCAT record, keeping only fields that look right. Returns null
 * if the record has no usable catalog number or nothing worth keeping.
 */
export function toCatalogDetails(raw: unknown): { noradId: number; details: CatalogDetails } | null {
  if (!isObject(raw)) return null
  const noradId = raw.NORAD_CAT_ID
  if (typeof noradId !== 'number' || !Number.isInteger(noradId) || noradId <= 0) return null

  const details: CatalogDetails = {}
  const owner = code(raw.OWNER)
  if (owner !== undefined) details.OWNER = owner
  if (typeof raw.LAUNCH_DATE === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.LAUNCH_DATE)) {
    details.LAUNCH_DATE = raw.LAUNCH_DATE
  }
  const launchSite = code(raw.LAUNCH_SITE)
  if (launchSite !== undefined) details.LAUNCH_SITE = launchSite
  if (typeof raw.OBJECT_TYPE === 'string' && OBJECT_TYPES.includes(raw.OBJECT_TYPE)) {
    details.OBJECT_TYPE = raw.OBJECT_TYPE
  }
  const status = code(raw.OPS_STATUS_CODE)
  if (status !== undefined) details.OPS_STATUS_CODE = status

  return Object.keys(details).length === 0 ? null : { noradId, details }
}

/** NORAD ID -> details, from a raw SATCAT response. */
export function detailsFromSatcat(rawRecords: readonly unknown[]): Map<number, CatalogDetails> {
  const byId = new Map<number, CatalogDetails>()
  for (const raw of rawRecords) {
    const parsed = toCatalogDetails(raw)
    if (parsed !== null && !byId.has(parsed.noradId)) byId.set(parsed.noradId, parsed.details)
  }
  return byId
}

/** NORAD ID -> details already attached to a satellite file (the live one). */
export function detailsFromFile(file: SatelliteFile): Map<number, CatalogDetails> {
  const byId = new Map<number, CatalogDetails>()
  for (const record of file.satellites) {
    const details: CatalogDetails = {}
    for (const field of DETAIL_FIELDS) {
      const value = record[field]
      if (typeof value === 'string') details[field] = value
    }
    if (Object.keys(details).length > 0) byId.set(record.NORAD_CAT_ID, details)
  }
  return byId
}

/** True if the SATCAT was asked for recently enough that it must not be asked again yet. */
export function wasCheckedRecently(catalogCheckedAt: string | undefined, now: Date): boolean {
  if (catalogCheckedAt === undefined) return false
  const ageMs = now.getTime() - Date.parse(catalogCheckedAt)
  return Number.isFinite(ageMs) && ageMs < SATCAT_MIN_INTERVAL_MS
}

/** Share of `satellites` that `details` has an entry for. */
export function coverage(satellites: readonly OmmRecord[], details: ReadonlyMap<number, CatalogDetails>): number {
  if (satellites.length === 0) return 0
  let covered = 0
  for (const record of satellites) if (details.has(record.NORAD_CAT_ID)) covered++
  return covered / satellites.length
}

/**
 * Returns `file` with details attached to each record that has them and
 * `catalogCheckedAt` set. Records without details are left as they are.
 */
export function withCatalogDetails(
  file: SatelliteFile,
  details: ReadonlyMap<number, CatalogDetails>,
  catalogCheckedAt: string | undefined,
): SatelliteFile {
  const satellites = file.satellites.map((record) => {
    const found = details.get(record.NORAD_CAT_ID)
    return found === undefined ? record : { ...record, ...found }
  })
  return catalogCheckedAt === undefined ? { ...file, satellites } : { ...file, catalogCheckedAt, satellites }
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>

export type SatcatResult = { kind: 'ok'; records: unknown[] } | { kind: 'error'; message: string }

/** One request, no retries. Any non-200 or non-array answer is an error. */
export async function fetchSatcat(fetchImpl: FetchLike = fetch, timeoutMs = 60_000): Promise<SatcatResult> {
  let response: Response
  try {
    response = await fetchImpl(SATCAT_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return { kind: 'error', message: `Request failed: ${String(error)}` }
  }
  if (response.status !== 200) return { kind: 'error', message: `HTTP ${response.status}` }
  let json: unknown
  try {
    json = await response.json()
  } catch {
    return { kind: 'error', message: 'Response was not valid JSON.' }
  }
  if (!Array.isArray(json)) return { kind: 'error', message: 'Response was JSON but not an array.' }
  return { kind: 'ok', records: json }
}

export interface CatalogStepInput {
  /** The new file, built from this run's GP data. */
  file: SatelliteFile
  /** The file currently live, if it could be read. Its details are the fallback. */
  live: SatelliteFile | null
  now: Date
  fetchImpl?: FetchLike
}

export interface CatalogStepResult {
  file: SatelliteFile
  notes: string[]
  /** Set when the SATCAT was asked for and the answer could not be used. */
  warning: string | null
}

/**
 * Decides whether to ask for the SATCAT, asks at most once, and returns the file with
 * the best details available. Never throws and never fails the run.
 */
export async function addCatalogDetails(input: CatalogStepInput): Promise<CatalogStepResult> {
  const { file, live, now } = input
  const notes: string[] = []
  const carried = live === null ? new Map<number, CatalogDetails>() : detailsFromFile(live)
  const lastChecked = live?.catalogCheckedAt

  if (wasCheckedRecently(lastChecked, now)) {
    notes.push(`Catalog details: SATCAT was checked at ${lastChecked}, less than 24 hours ago; reusing ${carried.size} entries from the live file.`)
    return { file: withCatalogDetails(file, carried, lastChecked), notes, warning: null }
  }

  // Whole seconds, like generatedAt. Recorded even if the request fails, so a broken
  // endpoint is tried once a day, not on every run.
  const checkedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const fetched = await fetchSatcat(input.fetchImpl)
  if (fetched.kind === 'error') {
    return {
      file: withCatalogDetails(file, carried, checkedAt),
      notes,
      warning: `CelesTrak SATCAT: ${fetched.message}. Keeping ${carried.size} existing entries; not retrying for 24 hours (fair use).`,
    }
  }

  const fresh = detailsFromSatcat(fetched.records)
  const share = coverage(file.satellites, fresh)
  if (share < MIN_SATCAT_COVERAGE) {
    return {
      file: withCatalogDetails(file, carried, checkedAt),
      notes,
      warning: `CelesTrak SATCAT covered only ${Math.round(share * 100)}% of satellites (${fetched.records.length} records). Keeping ${carried.size} existing entries.`,
    }
  }

  // Satellites the new SATCAT answer misses keep what the live file knew about them.
  const merged = new Map(carried)
  for (const [noradId, details] of fresh) merged.set(noradId, details)
  notes.push(`Catalog details: ${fetched.records.length} SATCAT records, covering ${Math.round(share * 100)}% of satellites.`)
  return { file: withCatalogDetails(file, merged, checkedAt), notes, warning: null }
}
