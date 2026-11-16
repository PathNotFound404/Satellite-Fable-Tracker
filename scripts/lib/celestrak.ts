/**
 * The only code in this project that talks to CelesTrak. Rules it implements are in
 * docs/ci-cd.md ("CelesTrak fair use"): one request at a time, stop on the first
 * non-200, never retry, never fetch `starlink` (a subset of `active`).
 */

/** Order matters: `active` first, because nothing is usable without it. */
export const CELESTRAK_GROUPS = ['active', 'stations', 'gps-ops', 'weather'] as const
export type CelestrakGroup = (typeof CELESTRAK_GROUPS)[number]

export function celestrakUrl(group: CelestrakGroup): string {
  return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=JSON`
}

/**
 * CelesTrak answers a repeat download inside one 2-hour update window with HTTP 403 and
 * this message. On shared CI runner IPs that can happen through no fault of ours, so it
 * is a skip, not a failure.
 */
const NOT_UPDATED_PATTERN = /has not updated since your last successful download/i

export type FetchAllResult =
  | { kind: 'ok'; groups: Record<CelestrakGroup, unknown[]> }
  /** Data hasn't changed since the last download from this IP. Keep the live file. */
  | { kind: 'not-updated'; group: CelestrakGroup }
  /** Anything else. A human should look. */
  | { kind: 'error'; group: CelestrakGroup; message: string }

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

const REQUEST_TIMEOUT_MS = 60_000

/**
 * Fetches every group in order and stops at the first response that isn't a 200 with a
 * JSON array. Makes at most one request per group and never retries.
 */
export async function fetchAllGroups(
  fetchImpl: FetchLike = fetch,
  log: (message: string) => void = () => {},
): Promise<FetchAllResult> {
  const groups: Partial<Record<CelestrakGroup, unknown[]>> = {}

  for (const group of CELESTRAK_GROUPS) {
    let response: Response
    try {
      response = await fetchImpl(celestrakUrl(group), {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      return { kind: 'error', group, message: `Request failed: ${String(error)}` }
    }

    if (response.status !== 200) {
      const body = (await response.text().catch(() => '')).trim().slice(0, 300)
      if (response.status === 403 && NOT_UPDATED_PATTERN.test(body)) {
        return { kind: 'not-updated', group }
      }
      return { kind: 'error', group, message: `HTTP ${response.status}: ${body}` }
    }

    let json: unknown
    try {
      json = await response.json()
    } catch {
      return { kind: 'error', group, message: 'Response was not valid JSON.' }
    }
    if (!Array.isArray(json)) {
      return { kind: 'error', group, message: 'Response was JSON but not an array.' }
    }

    log(`${group}: ${json.length} records`)
    groups[group] = json
  }

  return { kind: 'ok', groups: groups as Record<CelestrakGroup, unknown[]> }
}
