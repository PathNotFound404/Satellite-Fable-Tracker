import { parseSatelliteFile, type SatelliteFile } from '../../src/types/satellite-data.ts'

/**
 * Reads the satellite file currently served by our own production site. Used by the
 * freshness guard and by builds; this never contacts CelesTrak.
 */

export const DATA_PATH = '/data/satellites.json'

/** CelesTrak updates GP data every 2 hours; fetching more often is against fair use. */
export const MIN_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000

/**
 * Production base URL from the environment, without a trailing slash, or null.
 *
 * `PRODUCTION_URL` is set as a repository variable for GitHub Actions.
 * `VERCEL_PROJECT_PRODUCTION_URL` is provided by Vercel during its own builds, as a bare
 * hostname.
 */
export function productionUrlFromEnv(env: Record<string, string | undefined>): string | null {
  const explicit = env.PRODUCTION_URL?.trim()
  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  const raw = explicit || vercelHost
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}

export type LiveDataResult =
  | { kind: 'ok'; file: SatelliteFile; text: string }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

export async function fetchLiveData(
  productionUrl: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 20_000,
): Promise<LiveDataResult> {
  const url = `${productionUrl}${DATA_PATH}`
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (response.status === 404) return { kind: 'missing' }
    if (!response.ok) return { kind: 'error', message: `${url} returned HTTP ${response.status}` }
    const text = await response.text()
    // A static host can answer a missing file with its HTML index page and a 200.
    const file = parseSatelliteFile(JSON.parse(text))
    return { kind: 'ok', file, text }
  } catch (error) {
    return { kind: 'error', message: `${url}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** True if `generatedAt` is recent enough that CelesTrak cannot have newer data yet. */
export function isFresh(generatedAt: string, now: Date): boolean {
  const ageMs = now.getTime() - Date.parse(generatedAt)
  return Number.isFinite(ageMs) && ageMs < MIN_REFRESH_INTERVAL_MS
}
