/**
 * npm run fetch-data
 *
 * Fetches orbital data from CelesTrak, validates it and writes
 * public/data/satellites.json. Run by the scheduled data-refresh workflow.
 *
 * Each run counts against this machine's IP at CelesTrak. For normal development use
 * public/data/sample.json; only run this when working on the pipeline.
 *
 * Exit code 0: wrote a new file, or skipped because nothing newer can exist yet.
 * Exit code 1: something a human should look at. No file is written.
 *
 * In GitHub Actions it also sets the step output `status` to `fetched` or `skipped`,
 * which decides whether the workflow deploys.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSatelliteFile } from '../src/types/satellite-data.ts'
import { fetchAllGroups } from './lib/celestrak.ts'
import { fetchLiveData, isFresh, productionUrlFromEnv } from './lib/live-data.ts'
import { buildSatelliteFile } from './lib/validate.ts'

const OUTPUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/satellites.json')
const inGitHubActions = process.env.GITHUB_ACTIONS === 'true'

function log(message: string): void {
  console.log(`[fetch-data] ${message}`)
}

async function setOutput(status: 'fetched' | 'skipped'): Promise<void> {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `status=${status}\n`)
}

async function skip(reason: string): Promise<void> {
  log(`Skipped: ${reason}`)
  if (inGitHubActions) console.log(`::warning title=Data refresh skipped::${reason}`)
  await setOutput('skipped')
}

function fail(reason: string): never {
  console.error(`[fetch-data] FAILED: ${reason}`)
  if (inGitHubActions) console.log(`::error title=Data refresh failed::${reason}`)
  process.exit(1)
}

/** `generatedAt` of a satellites.json already on disk, or null if there isn't a usable one. */
async function localGeneratedAt(): Promise<string | null> {
  try {
    return parseSatelliteFile(JSON.parse(await readFile(OUTPUT_PATH, 'utf8'))).generatedAt
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const now = new Date()

  // Freshness guard, part 1: a file from this machine less than 2 hours old means we
  // already downloaded this update. Protects repeated local runs.
  const local = await localGeneratedAt()
  if (local !== null && isFresh(local, now)) {
    return skip(`Local data was fetched at ${local}, less than 2 hours ago.`)
  }

  // Freshness guard, part 2: the live site. Also gives us the count to compare against.
  let liveCount: number | null = null
  const productionUrl = productionUrlFromEnv(process.env)
  if (productionUrl === null) {
    log('PRODUCTION_URL is not set; skipping the live-site freshness and count checks.')
  } else {
    const live = await fetchLiveData(productionUrl)
    if (live.kind === 'ok') {
      if (isFresh(live.file.generatedAt, now)) {
        return skip(`Live data was fetched at ${live.file.generatedAt}, less than 2 hours ago.`)
      }
      liveCount = live.file.count
      log(`Live file: ${liveCount} satellites from ${live.file.generatedAt}.`)
    } else if (live.kind === 'missing') {
      log('No live file yet (first run).')
    } else {
      // Not fatal: the site being briefly unreachable shouldn't stop a refresh. We only
      // lose the count comparison; every other validation still applies.
      log(`Could not read the live file (${live.message}); continuing without it.`)
    }
  }

  const fetched = await fetchAllGroups(fetch, log)
  if (fetched.kind === 'not-updated') {
    return skip(
      `CelesTrak reports "${fetched.group}" has not updated since the last download from this IP.`,
    )
  }
  if (fetched.kind === 'error') {
    fail(`CelesTrak "${fetched.group}": ${fetched.message}. Not retrying (fair use).`)
  }

  const built = buildSatelliteFile({
    active: fetched.groups.active,
    stations: fetched.groups.stations,
    gpsOps: fetched.groups['gps-ops'],
    weather: fetched.groups.weather,
    generatedAt: now,
    liveCount,
  })
  for (const note of built.notes) log(note)
  if (!built.ok) fail(`Validation failed:\n  - ${built.errors.join('\n  - ')}`)

  // Write to a temp file and rename, so a crash can never leave a half-written file.
  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  const tempPath = `${OUTPUT_PATH}.tmp`
  await writeFile(tempPath, JSON.stringify(built.file))
  await rename(tempPath, OUTPUT_PATH)

  const { file } = built
  log(
    `Wrote ${file.count} satellites (stations ${file.groups.stations.length}, starlink ${file.groups.starlink.length}, gps-ops ${file.groups['gps-ops'].length}, weather ${file.groups.weather.length}).`,
  )
  await setOutput('fetched')
}

await main()
