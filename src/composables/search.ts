import type { Catalog } from '../orbital/catalog'

/**
 * Name and NORAD ID search over the catalog. Plain functions with no Vue, so they are
 * easy to test and cheap to call on every keystroke: one linear pass over upper-cased
 * names, which is well under a millisecond for 17k satellites.
 */

export interface SearchIndex {
  /** Upper-cased names, indexed like the catalog. */
  readonly names: readonly string[]
  /** NORAD IDs as strings, indexed like the catalog. */
  readonly ids: readonly string[]
}

export function buildSearchIndex(catalog: Catalog): SearchIndex {
  return {
    names: catalog.records.map((record) => record.OBJECT_NAME.toUpperCase()),
    ids: catalog.records.map((record) => String(record.NORAD_CAT_ID)),
  }
}

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Characters that start a new "word" inside a satellite name, e.g. "CSS (TIANHE)". */
const WORD_BREAKS = ' -(/['

/**
 * Catalog indices matching `query`, best first, at most `limit`.
 *
 * Ranking: exact name or ID, then names starting with the query, then IDs starting
 * with it or a word inside the name starting with it, then any other substring.
 * Within a rank, catalog order (ascending NORAD ID) is kept, so "ISS" lists
 * ISS (ZARYA) first.
 *
 * `include` lets the caller leave out satellites that can't be shown (decayed).
 */
export function searchCatalog(
  index: SearchIndex,
  query: string,
  limit: number,
  include: (catalogIndex: number) => boolean = () => true,
): number[] {
  const q = normalizeQuery(query)
  if (q === '' || limit <= 0) return []

  const ranks: number[][] = [[], [], [], []]
  const isNumeric = /^\d+$/.test(q)

  for (let i = 0; i < index.names.length; i++) {
    const name = index.names[i]!
    const id = index.ids[i]!
    let rank = -1

    if (name === q || id === q) {
      rank = 0
    } else if (name.startsWith(q)) {
      rank = 1
    } else if (isNumeric && id.startsWith(q)) {
      rank = 2
    } else {
      const at = name.indexOf(q)
      if (at > 0) rank = WORD_BREAKS.includes(name[at - 1]!) ? 2 : 3
    }

    if (rank === -1) continue
    const bucket = ranks[rank]!
    // No point collecting more than `limit` in any one rank.
    if (bucket.length >= limit) continue
    if (!include(i)) continue
    bucket.push(i)
  }

  return ranks.flat().slice(0, limit)
}
