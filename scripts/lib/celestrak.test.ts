import { describe, expect, it } from 'vitest'
import { CELESTRAK_GROUPS, celestrakUrl, fetchAllGroups, type FetchLike } from './celestrak.ts'

const NOT_UPDATED_BODY =
  'GP data has not updated since your last successful download of GROUP=active at 2026-11-16 18:00:00 UTC.'

/** A fake fetch that records every URL and answers from a script, one entry per call. */
function scriptedFetch(responses: Array<Response | Error>): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = []
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url)
    const next = responses[urls.length - 1]
    if (next === undefined) throw new Error(`Unexpected extra request to ${url}`)
    if (next instanceof Error) throw next
    return next
  }
  return { fetchImpl, urls }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('celestrakUrl', () => {
  it('uses the .org GP endpoint with JSON format', () => {
    expect(celestrakUrl('gps-ops')).toBe(
      'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=JSON',
    )
  })

  it('never includes starlink (a subset of active)', () => {
    expect(CELESTRAK_GROUPS).toEqual(['active', 'stations', 'gps-ops', 'weather'])
  })
})

describe('fetchAllGroups', () => {
  it('requests each group exactly once, in order', async () => {
    const { fetchImpl, urls } = scriptedFetch([json([1, 2]), json([3]), json([4]), json([5])])
    const result = await fetchAllGroups(fetchImpl)

    expect(urls).toEqual(CELESTRAK_GROUPS.map(celestrakUrl))
    expect(result).toEqual({
      kind: 'ok',
      groups: { active: [1, 2], stations: [3], 'gps-ops': [4], weather: [5] },
    })
  })

  it('treats the "not updated" 403 as a skip and stops', async () => {
    const { fetchImpl, urls } = scriptedFetch([new Response(NOT_UPDATED_BODY, { status: 403 })])
    const result = await fetchAllGroups(fetchImpl)

    expect(result).toEqual({ kind: 'not-updated', group: 'active' })
    expect(urls).toHaveLength(1)
  })

  it('treats any other 403 as an error', async () => {
    const { fetchImpl, urls } = scriptedFetch([new Response('Forbidden', { status: 403 })])
    const result = await fetchAllGroups(fetchImpl)

    expect(result.kind).toBe('error')
    expect(urls).toHaveLength(1)
  })

  it.each([301, 404, 500, 503])('stops on HTTP %i with no retry and no further requests', async (status) => {
    const { fetchImpl, urls } = scriptedFetch([json([1]), new Response('nope', { status })])
    const result = await fetchAllGroups(fetchImpl)

    expect(result).toMatchObject({ kind: 'error', group: 'stations' })
    expect(result.kind === 'error' && result.message).toContain(String(status))
    expect(urls).toHaveLength(2)
  })

  it('stops on a network error', async () => {
    const { fetchImpl, urls } = scriptedFetch([new Error('ECONNRESET')])
    const result = await fetchAllGroups(fetchImpl)

    expect(result).toMatchObject({ kind: 'error', group: 'active' })
    expect(urls).toHaveLength(1)
  })

  it('stops on a 200 that is not JSON', async () => {
    const { fetchImpl, urls } = scriptedFetch([new Response('<html>maintenance</html>', { status: 200 })])
    const result = await fetchAllGroups(fetchImpl)

    expect(result).toMatchObject({ kind: 'error', group: 'active' })
    expect(urls).toHaveLength(1)
  })

  it('stops on a 200 that is JSON but not an array', async () => {
    const { fetchImpl, urls } = scriptedFetch([json({ error: 'Invalid query' })])
    const result = await fetchAllGroups(fetchImpl)

    expect(result).toMatchObject({ kind: 'error', group: 'active' })
    expect(urls).toHaveLength(1)
  })
})
