import { onBeforeUnmount, watch, type ShallowRef } from 'vue'
import { sunDirectionEcf } from '../orbital/sun'
import type { GlobeScene } from '../three/scene'
import { writeEcfKmToScene } from '../three/units'
import { useSimClock } from './useSimClock'

/**
 * The Sun moves a quarter of a degree per simulated minute, so there is no need to
 * recompute it every frame: only when simulation time has moved this far.
 */
const RECOMPUTE_AFTER_MS = 20_000

/** Keeps the globe's day and night sides in step with simulation time. */
export function useSunlight(globeScene: ShallowRef<GlobeScene | null>) {
  const { clock } = useSimClock()
  const ecf = new Float64Array(3)
  const scene = [0, 0, 0]
  let stopFrames: (() => void) | null = null

  watch(
    globeScene,
    (globe) => {
      stopFrames?.()
      stopFrames = null
      if (globe === null) return

      let computedForMs = Number.NaN
      stopFrames = globe.onFrame(() => {
        const nowMs = clock.nowMs()
        // NaN (first frame) fails the comparison, so it computes straight away.
        if (Math.abs(nowMs - computedForMs) < RECOMPUTE_AFTER_MS) return
        computedForMs = nowMs
        sunDirectionEcf(nowMs, ecf)
        // Only the direction matters; the globe normalises it.
        writeEcfKmToScene(ecf[0]!, ecf[1]!, ecf[2]!, scene)
        globe.setSunDirection(scene[0]!, scene[1]!, scene[2]!)
      })
    },
    { immediate: true },
  )

  onBeforeUnmount(() => stopFrames?.())
}
