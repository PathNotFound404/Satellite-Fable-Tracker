import { readonly, ref, shallowRef } from 'vue'
import { parseSatelliteFile, type SatelliteFile } from '../types/satellite-data'

/** Served by our own site. The browser never calls CelesTrak (see CLAUDE.md). */
const DATA_URL = `${import.meta.env.BASE_URL}data/satellites.json`

export type LoadStatus = 'loading' | 'ready' | 'error'

// Module-level so every caller shares one load. `shallowRef` because the file holds
// thousands of records: making them deeply reactive would cost memory and frame time.
const file = shallowRef<SatelliteFile | null>(null)
const status = ref<LoadStatus>('loading')
const errorMessage = ref('')
let started = false

async function load(): Promise<void> {
  status.value = 'loading'
  errorMessage.value = ''
  try {
    const response = await fetch(DATA_URL)
    if (!response.ok) throw new Error(`Could not load satellite data (HTTP ${response.status}).`)
    let json: unknown
    try {
      json = await response.json()
    } catch {
      throw new Error('Satellite data could not be read.')
    }
    file.value = parseSatelliteFile(json)
    status.value = 'ready'
  } catch (error) {
    console.error(error)
    errorMessage.value =
      error instanceof TypeError
        ? 'Could not load satellite data. Check your connection and reload.'
        : error instanceof Error
          ? error.message
          : 'Could not load satellite data.'
    status.value = 'error'
  }
}

/** Loads the satellite file once per page load and shares it. */
export function useSatellites() {
  if (!started) {
    started = true
    void load()
  }
  return {
    file,
    status: readonly(status),
    errorMessage: readonly(errorMessage),
    /** Try the download again after a failure. Does nothing while one is in progress. */
    retry() {
      if (status.value === 'error') void load()
    },
  }
}
