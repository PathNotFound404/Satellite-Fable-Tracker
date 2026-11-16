import { onBeforeUnmount, watch, type Ref, type ShallowRef } from 'vue'
import { Vector3 } from 'three'
import type { Catalog } from '../orbital/catalog'
import type { SatelliteLayer } from '../three/satelliteLayer'
import type { GlobeScene } from '../three/scene'
import { createSelectionVisuals, type SelectionVisuals } from '../three/selectionVisuals'
import { useSimClock } from './useSimClock'

/**
 * Keeps the selection marker and orbit line in the scene in step with the selected
 * satellite. three.js objects stay in plain variables, outside Vue reactivity.
 */
export function useSelectionVisuals(
  globeScene: ShallowRef<GlobeScene | null>,
  catalog: ShallowRef<Catalog | null>,
  layer: ShallowRef<SatelliteLayer | null>,
  selectedIndex: Readonly<Ref<number | null>>,
) {
  const { clock } = useSimClock()
  let visuals: SelectionVisuals | null = null
  let stopFrames: (() => void) | null = null
  // Read by the frame callback; plain variables so the loop never touches a ref.
  let currentLayer: SatelliteLayer | null = null
  let currentIndex: number | null = null
  const markerPosition = new Vector3()

  function teardown(): void {
    stopFrames?.()
    stopFrames = null
    visuals?.object.removeFromParent()
    visuals?.dispose()
    visuals = null
  }

  watch(
    globeScene,
    (scene) => {
      teardown()
      if (scene === null) return
      const created = createSelectionVisuals(scene.renderer.getPixelRatio())
      visuals = created
      scene.scene.add(created.object)
      stopFrames = scene.onFrame(() => {
        if (currentLayer === null || currentIndex === null) return
        created.setPixelRatio(scene.renderer.getPixelRatio())
        const shown = currentLayer.getScenePosition(currentIndex, markerPosition)
        created.update(clock.nowMs(), shown ? markerPosition : null)
      })
    },
    { immediate: true },
  )

  watch(
    [catalog, layer, selectedIndex, globeScene],
    ([nextCatalog, nextLayer, index]) => {
      currentLayer = nextLayer
      currentIndex = index
      if (visuals === null) return
      if (nextCatalog === null || nextLayer === null || index === null) {
        visuals.setTarget(null)
        return
      }
      visuals.setTarget({
        satrec: nextCatalog.satrecs[index]!,
        meanMotionRevPerDay: nextCatalog.records[index]!.MEAN_MOTION,
      })
    },
    { immediate: true },
  )

  onBeforeUnmount(teardown)
}
