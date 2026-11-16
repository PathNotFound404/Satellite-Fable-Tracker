/**
 * node scripts/make-sample.ts
 *
 * Regenerates public/data/sample.json (the small committed sample used for development,
 * tests and as the build fallback) from a full public/data/satellites.json already on
 * disk. Offline: it never contacts CelesTrak. Run it only when the data contract
 * changes or the sample has aged badly.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GROUP_NAMES,
  parseSatelliteFile,
  type GroupName,
  type SatelliteFile,
} from '../src/types/satellite-data.ts'

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data')

/** How many satellites to take from each group. */
const PER_GROUP: Record<GroupName, number> = { stations: 6, starlink: 16, 'gps-ops': 10, weather: 10 }

/** Recognisable or orbit-diverse extras outside the tag groups (matched by exact name). */
const EXTRA_NAMES = ['HST', 'LANDSAT 9', 'SENTINEL-2A', 'TERRA', 'AQUA', 'GOES 18', 'INTELSAT 40E (IS-40E)', 'LAGEOS 1']

/** `count` items spread evenly across `items`, so the pick isn't all one launch. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items]
  const step = items.length / count
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]!)
}

const full = parseSatelliteFile(JSON.parse(await readFile(resolve(dataDir, 'satellites.json'), 'utf8')))

const picked = new Set<number>([25544])
for (const name of GROUP_NAMES) {
  for (const id of spread(full.groups[name], PER_GROUP[name])) picked.add(id)
}
for (const record of full.satellites) {
  if (EXTRA_NAMES.includes(record.OBJECT_NAME)) picked.add(record.NORAD_CAT_ID)
}

const satellites = full.satellites.filter((record) => picked.has(record.NORAD_CAT_ID))
const groups = Object.fromEntries(
  GROUP_NAMES.map((name) => [name, full.groups[name].filter((id) => picked.has(id))]),
) as Record<GroupName, number[]>

const sample: SatelliteFile = {
  schemaVersion: full.schemaVersion,
  generatedAt: full.generatedAt,
  source: full.source,
  count: satellites.length,
  groups,
  satellites,
}

await writeFile(resolve(dataDir, 'sample.json'), `${JSON.stringify(sample, null, 1)}\n`)
console.log(`Wrote sample.json with ${sample.count} satellites from ${sample.generatedAt}.`)
