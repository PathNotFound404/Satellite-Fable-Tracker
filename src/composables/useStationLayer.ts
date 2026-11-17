import { onBeforeUnmount, watch, type ShallowRef } from 'vue'
import type { Catalog } from '../orbital/catalog'
import type { SatelliteLayer } from '../three/satelliteLayer'
import type { GlobeScene } from '../three/scene'
import { createStationLayer, type StationLayer } from '../three/stationLayer'

/**
 * Draws the space station glyphs over the satellite layer and keeps them on their
 * stations every frame. The three.js object stays in a plain variable, outside Vue
 * reactivity.
 */
export function useStationLayer(
  globeScene: ShallowRef<GlobeScene | null>,
  catalog: ShallowRef<Catalog | null>,
  layer: ShallowRef<SatelliteLayer | null>,
) {
  let stations: StationLayer | null = null
  let stopFrames: (() => void) | null = null

  function teardown(): void {
    stopFrames?.()
    stopFrames = null
    stations?.object.removeFromParent()
    stations?.dispose()
    stations = null
  }

  watch(
    [globeScene, catalog, layer],
    ([scene, loadedCatalog, shownLayer]) => {
      teardown()
      if (scene === null || loadedCatalog === null || shownLayer === null) return

      // Lowest NORAD ID first, so the glyph sits on a station's oldest (core) module
      // and clicking it selects that one, e.g. ISS (ZARYA) rather than a docked cargo ship.
      const members = Array.from(loadedCatalog.groupIndices.stations).sort(
        (a, b) => loadedCatalog.records[a]!.NORAD_CAT_ID - loadedCatalog.records[b]!.NORAD_CAT_ID,
      )
      const created = createStationLayer(members, scene.renderer.getPixelRatio())
      stations = created
      scene.scene.add(created.object)
      // Registered after the satellite layer's own frame callback, so positions are current.
      stopFrames = scene.onFrame(() => {
        created.setPixelRatio(scene.renderer.getPixelRatio())
        created.update(shownLayer)
      })
    },
    { immediate: true },
  )

  onBeforeUnmount(teardown)

  return {
    /** The satellite a click on `index` should select: a station's core module for any of its parts. */
    representativeOf: (index: number): number => stations?.representativeOf(index) ?? index,
  }
}
