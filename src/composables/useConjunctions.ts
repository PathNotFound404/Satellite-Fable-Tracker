import { onBeforeUnmount, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import { Vector3 } from 'three'
import type { Catalog } from '../orbital/catalog'
import { createConjunctionScan, type CloseApproach } from '../orbital/conjunctions'
import { createHighlightMarker, type HighlightMarker } from '../three/highlightMarker'
import type { SatelliteLayer } from '../three/satelliteLayer'
import type { GlobeScene } from '../three/scene'
import { useSimClock } from './useSimClock'

/** Report approaches closer than this. Far above GP accuracy, so the list is rarely empty. */
export const CONJUNCTION_THRESHOLD_KM = 50
/** How many approaches are listed. */
const MAX_RESULTS = 8
/**
 * Scan work per frame, ms. A whole scan is 0.5 to 3 seconds of SGP4, far too long for
 * one frame, so it is spread out: with this budget the globe keeps moving while it runs.
 */
const FRAME_BUDGET_MS = 5
/** The progress figure is reactive; this keeps it from changing every frame. */
const PROGRESS_STEP = 0.02

export type ConjunctionStatus = 'idle' | 'scanning' | 'done'

/** One close approach, with what the list needs to show it. */
export interface ApproachRow extends CloseApproach {
  name: string
  noradId: number
}

/**
 * Close approaches to the selected satellite, found on request, and the ring that
 * marks the other satellite of the approach being looked at.
 */
export function useConjunctions(
  globeScene: ShallowRef<GlobeScene | null>,
  catalog: ShallowRef<Catalog | null>,
  layer: ShallowRef<SatelliteLayer | null>,
  selectedIndex: Readonly<Ref<number | null>>,
) {
  const { clock } = useSimClock()
  const status = ref<ConjunctionStatus>('idle')
  const progress = ref(0)
  const approaches = shallowRef<ApproachRow[]>([])
  /** Catalog index of the satellite with the ring on it, or null. */
  const highlightedIndex = ref<number | null>(null)

  let frameHandle = 0

  function cancel(): void {
    cancelAnimationFrame(frameHandle)
    frameHandle = 0
  }

  function reset(): void {
    cancel()
    status.value = 'idle'
    progress.value = 0
    approaches.value = []
    highlightedIndex.value = null
  }

  function start(): void {
    const loaded = catalog.value
    const index = selectedIndex.value
    if (loaded === null || index === null) return
    reset()
    status.value = 'scanning'
    const scan = createConjunctionScan(loaded.satrecs, index, clock.nowMs(), {
      thresholdKm: CONJUNCTION_THRESHOLD_KM,
      maxResults: MAX_RESULTS,
    })

    const work = (): void => {
      const done = scan.step(FRAME_BUDGET_MS)
      const nextProgress = scan.progress()
      if (done || nextProgress - progress.value >= PROGRESS_STEP) progress.value = nextProgress
      if (!done) {
        frameHandle = requestAnimationFrame(work)
        return
      }
      frameHandle = 0
      approaches.value = scan.results().map((approach) => ({
        ...approach,
        name: loaded.records[approach.index]!.OBJECT_NAME,
        noradId: loaded.records[approach.index]!.NORAD_CAT_ID,
      }))
      status.value = 'done'
    }
    frameHandle = requestAnimationFrame(work)
  }

  // Results belong to one satellite in one catalog.
  watch([catalog, selectedIndex], reset)

  // --- The ring on the other satellite ---------------------------------------------

  let marker: HighlightMarker | null = null
  let stopFrames: (() => void) | null = null
  // Read by the frame callback; plain variables so the loop never touches a ref.
  let currentLayer: SatelliteLayer | null = null
  let currentHighlight: number | null = null
  const markerPosition = new Vector3()

  function teardownMarker(): void {
    stopFrames?.()
    stopFrames = null
    marker?.object.removeFromParent()
    marker?.dispose()
    marker = null
  }

  watch(
    globeScene,
    (scene) => {
      teardownMarker()
      if (scene === null) return
      const created = createHighlightMarker(scene.renderer.getPixelRatio())
      marker = created
      scene.scene.add(created.object)
      stopFrames = scene.onFrame(() => {
        if (currentLayer === null || currentHighlight === null) {
          created.update(null)
          return
        }
        created.setPixelRatio(scene.renderer.getPixelRatio())
        created.update(currentLayer.getScenePosition(currentHighlight, markerPosition) ? markerPosition : null)
      })
    },
    { immediate: true },
  )

  watch(
    [layer, highlightedIndex],
    ([nextLayer, index]) => {
      currentLayer = nextLayer
      currentHighlight = index
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    cancel()
    teardownMarker()
  })

  return {
    status,
    progress,
    approaches,
    highlightedIndex,
    start,
    highlight(index: number | null) {
      highlightedIndex.value = index
    },
  }
}
