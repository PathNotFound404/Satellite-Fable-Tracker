import { markRaw, onBeforeUnmount, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import { buildCatalogInSlices, type Catalog } from '../orbital/catalog'
import { createSatelliteLayer, type SatelliteLayer } from '../three/satelliteLayer'
import type { GlobeScene } from '../three/scene'
import type { SatelliteFile } from '../types/satellite-data'
import { useSimClock } from './useSimClock'

/**
 * Glue between the loaded data and the scene: once both exist, builds the catalog,
 * adds the point cloud and keeps it moving every frame.
 *
 * The catalog and layer are exposed through shallow refs holding raw objects, so Vue
 * never walks thousands of records or any three.js object.
 */
export function useSatelliteLayer(
  globeScene: ShallowRef<GlobeScene | null>,
  file: Ref<SatelliteFile | null>,
) {
  const { clock } = useSimClock()
  const catalog = shallowRef<Catalog | null>(null)
  const layer = shallowRef<SatelliteLayer | null>(null)
  /** Satellites actually on screen: the catalog minus failed propagations. */
  const trackedCount = shallowRef<number | null>(null)

  /**
   * Plain, non-reactive performance numbers for the ?debug readout, which polls them.
   * Smoothed with an exponential moving average.
   */
  const stats = { fps: 0, updateMs: 0, invalid: 0, unreadable: 0 }

  let stopFrames: (() => void) | null = null
  /** Bumped whenever the inputs change, so a catalog build for old inputs is dropped. */
  let generation = 0

  /** Lets the browser paint and handle input before the next slice of work. */
  const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve))

  function teardown(): void {
    generation++
    stopFrames?.()
    stopFrames = null
    if (layer.value !== null) {
      layer.value.object.removeFromParent()
      layer.value.dispose()
    }
    layer.value = null
    catalog.value = null
    trackedCount.value = null
  }

  watch(
    [globeScene, file],
    async ([scene, loadedFile]) => {
      teardown()
      if (scene === null || loadedFile === null) return

      // Built in slices so the globe stays responsive while SGP4 is set up for
      // thousands of satellites.
      const mine = generation
      const built = await buildCatalogInSlices(loadedFile, nextTask, () => mine !== generation)
      if (built === null || mine !== generation) return
      const nextCatalog = markRaw(built)
      const nextLayer = markRaw(
        createSatelliteLayer(nextCatalog, clock.nowMs(), scene.renderer.getPixelRatio()),
      )
      scene.scene.add(nextLayer.object)

      let lastInvalid = -1
      stats.unreadable = nextCatalog.droppedCount
      stopFrames = scene.onFrame((_timeMs, deltaMs) => {
        nextLayer.setPixelRatio(scene.renderer.getPixelRatio())
        const updateStart = performance.now()
        nextLayer.update(clock.nowMs())
        stats.updateMs += (performance.now() - updateStart - stats.updateMs) * 0.05
        if (deltaMs > 0) stats.fps += (1000 / deltaMs - stats.fps) * 0.05
        stats.invalid = nextLayer.invalidCount()
        // Only touch reactive state when the number actually changes (rare).
        const invalid = nextLayer.invalidCount()
        if (invalid !== lastInvalid) {
          lastInvalid = invalid
          trackedCount.value = nextCatalog.count - invalid
        }
      })

      catalog.value = nextCatalog
      layer.value = nextLayer
      if (nextCatalog.droppedCount > 0 || nextLayer.invalidCount() > 0) {
        console.info(
          `Satellites: ${nextCatalog.count} loaded, ${nextCatalog.droppedCount} unreadable, ${nextLayer.invalidCount()} decayed or invalid (hidden).`,
        )
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(teardown)

  return { catalog, layer, trackedCount, stats }
}
