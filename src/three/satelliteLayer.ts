import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three'
import type { Catalog } from '../orbital/catalog'
import { gmstRadFromUnixMs } from '../orbital/frames'
import { propagateEcf } from '../orbital/propagation'
import { writeEcfKmToScene } from './units'

/**
 * Every satellite in one THREE.Points object: one draw call.
 *
 * Propagation strategy (docs/adr/0002-propagation-strategy.md): a full SGP4 pass over
 * the catalog costs more than a frame, so each satellite is re-propagated about once a
 * second, a slice of the catalog per frame. Between refreshes the vertex shader moves
 * each point along its Earth-fixed velocity, so motion is smooth at any frame rate and
 * the per-frame CPU cost is a fraction of a millisecond.
 */

/** Target age of a satellite's propagated state, in simulation time. */
const REFRESH_PERIOD_MS = 1000
/**
 * Upper bound on SGP4 calls per frame (as a share of the catalog), so a fast-forwarded
 * clock degrades extrapolation accuracy instead of frame rate.
 */
const MAX_REFRESH_SHARE_PER_FRAME = 1 / 8
/** A clock jump larger than this (seek, tab asleep) re-propagates everything at once. */
const FULL_REFRESH_JUMP_MS = 10_000
/**
 * Shader time is a 32-bit float of seconds since `timeBaseMs`. Rebase before it grows
 * large enough to lose millisecond resolution.
 */
const REBASE_AFTER_S = 1800

const POINT_COLOR = 0xf5f5f7
/** CSS pixels at the default camera distance. */
const POINT_SIZE_PX = 2.6

const vertexShader = /* glsl */ `
  attribute vec3 aVelocity;   // scene units per second, Earth-fixed
  attribute float aTime0;     // seconds since the time base when position was computed
  attribute float aState;     // 0 = hidden (invalid or filtered out), 1 = shown

  uniform float uTime;        // seconds since the time base
  uniform float uSize;        // device pixels

  void main() {
    vec3 current = position + aVelocity * (uTime - aTime0);
    vec4 viewPosition = modelViewMatrix * vec4(current, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    // Points grow gently as the camera closes in, within a narrow range, so dense
    // shells stay readable from afar and single satellites are easy to hit up close.
    gl_PointSize = uSize * clamp(3.4 / -viewPosition.z, 0.8, 2.2);
    // Hidden points are moved outside the clip volume: never drawn, never at the origin.
    if (aState < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    float distanceFromCentre = length(gl_PointCoord - 0.5);
    float alpha = 1.0 - smoothstep(0.3, 0.5, distanceFromCentre);
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(uColor, alpha * uOpacity);
    #include <colorspace_fragment>
  }
`

export interface SatelliteLayer {
  readonly object: Points
  /** Advance to `simTimeMs` (Unix ms). Call once per frame. Does not allocate. */
  update(simTimeMs: number): void
  /** Satellites whose latest propagation failed (decayed or invalid). They are hidden. */
  invalidCount(): number
  /** True if satellite `index` propagated successfully last time, whatever the filter. */
  isValid(index: number): boolean
  /** True if satellite `index` is currently drawn (valid and not filtered out). */
  isShown(index: number): boolean
  /**
   * Writes the scene position of satellite `index` at the last `update` time into
   * `target`, exactly where the shader draws it. Returns false if it is not shown.
   */
  getScenePosition(index: number, target: Vector3): boolean
  /**
   * Show only satellites whose entry in `mask` is non-zero (indexed like the catalog),
   * or everything valid if `mask` is null. Updates a per-point flag; the geometry is
   * not rebuilt.
   */
  setFilter(mask: Uint8Array | null): void
  setPixelRatio(pixelRatio: number): void
  dispose(): void
}

export function createSatelliteLayer(
  catalog: Catalog,
  simTimeMs: number,
  pixelRatio: number,
): SatelliteLayer {
  const count = catalog.count
  const satrecs = catalog.satrecs

  // Typed arrays shared with the GPU. Indexed like the catalog.
  const positions = new Float32Array(count * 3)
  const velocities = new Float32Array(count * 3)
  const time0 = new Float32Array(count)
  const state = new Float32Array(count)

  // CPU-side flags behind `state`.
  const valid = new Uint8Array(count)
  let filterMask: Uint8Array | null = null
  let invalid = 0

  const positionAttribute = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage)
  const velocityAttribute = new BufferAttribute(velocities, 3).setUsage(DynamicDrawUsage)
  const time0Attribute = new BufferAttribute(time0, 1).setUsage(DynamicDrawUsage)
  const stateAttribute = new BufferAttribute(state, 1).setUsage(DynamicDrawUsage)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', positionAttribute)
  geometry.setAttribute('aVelocity', velocityAttribute)
  geometry.setAttribute('aTime0', time0Attribute)
  geometry.setAttribute('aState', stateAttribute)
  // Positions move in the shader, so three.js can't compute bounds from the buffer.
  // Everything we track is inside this sphere (well beyond geostationary orbit).
  geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), 80)

  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: POINT_SIZE_PX * pixelRatio },
      uColor: { value: new Color(POINT_COLOR) },
      uOpacity: { value: 0.9 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  })

  const object = new Points(geometry, material)
  object.name = 'satellites'
  object.frustumCulled = false
  // After the globe, so points blend over it and are depth-tested against it.
  object.renderOrder = 1

  let timeBaseMs = simTimeMs
  let lastSimTimeMs = simTimeMs
  let cursor = 0
  /** Fractional satellites owed from previous frames, so slow frames don't lose refreshes. */
  let refreshDebt = 0
  const ecfScratch = new Float64Array(6)

  function writeState(index: number): void {
    state[index] = valid[index] === 1 && (filterMask === null || filterMask[index] !== 0) ? 1 : 0
  }

  /** Re-propagates satellites [start, start + length) for `timeMs`. */
  function refreshRange(start: number, length: number, timeMs: number, gmstRad: number): void {
    const time0Seconds = (timeMs - timeBaseMs) / 1000
    for (let index = start; index < start + length; index++) {
      const ok = propagateEcf(satrecs[index]!, timeMs, gmstRad, ecfScratch)
      if (ok) {
        const offset = index * 3
        writeEcfKmToScene(ecfScratch[0]!, ecfScratch[1]!, ecfScratch[2]!, positions, offset)
        writeEcfKmToScene(ecfScratch[3]!, ecfScratch[4]!, ecfScratch[5]!, velocities, offset)
        time0[index] = time0Seconds
      }
      const nowValid = ok ? 1 : 0
      if (valid[index] !== nowValid) {
        invalid += ok ? -1 : 1
        valid[index] = nowValid
      }
      writeState(index)
    }
    positionAttribute.addUpdateRange(start * 3, length * 3)
    velocityAttribute.addUpdateRange(start * 3, length * 3)
    time0Attribute.addUpdateRange(start, length)
    stateAttribute.addUpdateRange(start, length)
    positionAttribute.needsUpdate = true
    velocityAttribute.needsUpdate = true
    time0Attribute.needsUpdate = true
    stateAttribute.needsUpdate = true
  }

  function refreshAll(timeMs: number): void {
    timeBaseMs = timeMs
    refreshRange(0, count, timeMs, gmstRadFromUnixMs(timeMs))
    cursor = 0
    refreshDebt = 0
  }

  // Every satellite starts invalid until its first propagation says otherwise.
  invalid = count
  refreshAll(simTimeMs)

  return {
    object,

    update(nowMs) {
      const elapsedMs = Math.abs(nowMs - lastSimTimeMs)
      lastSimTimeMs = nowMs
      if (count === 0) return

      if (elapsedMs > FULL_REFRESH_JUMP_MS) {
        refreshAll(nowMs)
      } else if (elapsedMs > 0) {
        const shaderTimeS = (nowMs - timeBaseMs) / 1000
        if (Math.abs(shaderTimeS) > REBASE_AFTER_S) {
          // Move the time base to now and shift every stored time to match. Cheap
          // (one pass over a float array) and needs no propagation.
          timeBaseMs = nowMs
          for (let index = 0; index < count; index++) time0[index]! -= shaderTimeS
          time0Attribute.addUpdateRange(0, count)
          time0Attribute.needsUpdate = true
        }

        refreshDebt += (count * elapsedMs) / REFRESH_PERIOD_MS
        let due = Math.floor(refreshDebt)
        const maxPerFrame = Math.max(1, Math.ceil(count * MAX_REFRESH_SHARE_PER_FRAME))
        if (due > maxPerFrame) {
          due = maxPerFrame
          // Don't bank work we will never catch up on.
          refreshDebt = due
        }
        refreshDebt -= due

        if (due > 0) {
          const gmstRad = gmstRadFromUnixMs(nowMs)
          const firstLength = Math.min(due, count - cursor)
          refreshRange(cursor, firstLength, nowMs, gmstRad)
          // Wrap around to the start of the catalog.
          if (due > firstLength) refreshRange(0, due - firstLength, nowMs, gmstRad)
          cursor = (cursor + due) % count
        }
      }

      material.uniforms.uTime!.value = (nowMs - timeBaseMs) / 1000
    },

    invalidCount: () => invalid,

    isValid: (index) => valid[index] === 1,

    isShown: (index) => state[index] === 1,

    getScenePosition(index, target) {
      if (state[index] !== 1) return false
      const offset = index * 3
      const dtSeconds = (lastSimTimeMs - timeBaseMs) / 1000 - time0[index]!
      target.set(
        positions[offset]! + velocities[offset]! * dtSeconds,
        positions[offset + 1]! + velocities[offset + 1]! * dtSeconds,
        positions[offset + 2]! + velocities[offset + 2]! * dtSeconds,
      )
      return true
    },

    setFilter(mask) {
      filterMask = mask
      for (let index = 0; index < count; index++) writeState(index)
      stateAttribute.addUpdateRange(0, count)
      stateAttribute.needsUpdate = true
    },

    setPixelRatio(nextPixelRatio) {
      material.uniforms.uSize!.value = POINT_SIZE_PX * nextPixelRatio
    },

    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
