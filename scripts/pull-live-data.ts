/**
 * Runs before every build and dev server start (npm `prebuild` / `predev`).
 *
 * Makes sure public/data/satellites.json exists:
 *   1. Already there (e.g. the data-refresh workflow just wrote it)? Keep it.
 *   2. Otherwise download the copy our own production site is serving.
 *   3. Otherwise fall back to the committed sample.
 *
 * It never contacts CelesTrak and never fails the build: stale or sample data is
 * visible in the app's data-age badge, which is better than no deploy.
 */
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchLiveData, productionUrlFromEnv } from './lib/live-data.ts'

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data')
const OUTPUT_PATH = resolve(dataDir, 'satellites.json')
const SAMPLE_PATH = resolve(dataDir, 'sample.json')

function log(message: string): void {
  console.log(`[pull-live-data] ${message}`)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  if (await exists(OUTPUT_PATH)) {
    log('public/data/satellites.json already exists; keeping it.')
    return
  }
  await mkdir(dataDir, { recursive: true })

  const productionUrl = productionUrlFromEnv(process.env)
  if (productionUrl === null) {
    log('No production URL in the environment.')
  } else {
    const live = await fetchLiveData(productionUrl)
    if (live.kind === 'ok') {
      await writeFile(OUTPUT_PATH, live.text)
      log(`Using live data: ${live.file.count} satellites from ${live.file.generatedAt}.`)
      return
    }
    log(live.kind === 'missing' ? 'Production has no data file yet.' : `Live data unavailable (${live.message}).`)
  }

  await copyFile(SAMPLE_PATH, OUTPUT_PATH)
  log('Using the committed sample (public/data/sample.json).')
}

await main()
