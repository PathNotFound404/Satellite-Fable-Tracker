import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
  Points,
  ShaderMaterial,
  type Vector3,
} from 'three'
import { gmstRadFromUnixMs, temeStateToEcf } from '../orbital/frames'
import { sampleOrbitTeme } from '../orbital/orbitPath'
import type { SatRec } from '../orbital/propagation'
import { writeEcfKmToScene } from './units'

/**
 * What is drawn for the selected satellite: a ring marker on the point and its orbit.
 *
 * The orbit is one period sampled in the inertial frame, where it is a closed ellipse,
 * then placed in the Earth-fixed scene using the sidereal angle at sampling time. As
 * the Earth turns under the orbit, the whole line is rotated about the polar axis by
 * the change in sidereal angle, which costs one number per frame instead of a
 * re-sample. It is re-sampled every so often so drag and precession don't accumulate.
 */

/** Matches --color-accent in tokens.css. */
const ACCENT_COLOR = 0x0a84ff
/** Enough for a smooth ellipse, including sparse perigee passes of eccentric orbits. */
const ORBIT_SAMPLES = 361
const RESAMPLE_AFTER_MS = 20_000
/** CSS pixels. */
const MARKER_SIZE_PX = 22

const markerVertexShader = /* glsl */ `
  uniform float uSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
  }
`

const markerFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;           // 0 centre, 1 edge
    float ring = smoothstep(0.62, 0.72, r) * (1.0 - smoothstep(0.88, 1.0, r));
    float dot = 1.0 - smoothstep(0.2, 0.3, r);
    float alpha = max(ring, dot);
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`

export interface SelectionVisuals {
  readonly object: Group
  /** Show the orbit and marker for this satellite, or pass null to hide both. */
  setTarget(target: { satrec: SatRec; meanMotionRevPerDay: number } | null): void
  /**
   * Per frame: place the marker at `markerPosition` (or hide it if null) and keep the
   * orbit aligned with the turning Earth. Does not allocate.
   */
  update(simTimeMs: number, markerPosition: Vector3 | null): void
  setPixelRatio(pixelRatio: number): void
  dispose(): void
}

export function createSelectionVisuals(pixelRatio: number): SelectionVisuals {
  const object = new Group()
  object.name = 'selection'
  object.visible = false

  // Orbit line
  const orbitPositions = new Float32Array(ORBIT_SAMPLES * 3)
  const orbitAttribute = new BufferAttribute(orbitPositions, 3).setUsage(DynamicDrawUsage)
  const orbitGeometry = new BufferGeometry()
  orbitGeometry.setAttribute('position', orbitAttribute)
  orbitGeometry.setDrawRange(0, 0)
  const orbitMaterial = new LineBasicMaterial({
    color: ACCENT_COLOR,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  })
  const orbit = new Line(orbitGeometry, orbitMaterial)
  orbit.name = 'orbit'
  orbit.frustumCulled = false
  orbit.renderOrder = 2
  object.add(orbit)

  // Marker: a single point whose object position is moved each frame.
  const markerGeometry = new BufferGeometry()
  markerGeometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
  const markerMaterial = new ShaderMaterial({
    uniforms: {
      uSize: { value: MARKER_SIZE_PX * pixelRatio },
      uColor: { value: new Color(ACCENT_COLOR) },
    },
    vertexShader: markerVertexShader,
    fragmentShader: markerFragmentShader,
    transparent: true,
    depthWrite: false,
  })
  const marker = new Points(markerGeometry, markerMaterial)
  marker.name = 'selection-marker'
  marker.frustumCulled = false
  marker.renderOrder = 3
  object.add(marker)

  let target: { satrec: SatRec; meanMotionRevPerDay: number } | null = null
  let sampledAtMs = Number.NaN
  let sampledGmstRad = 0
  const temeSamples = new Float64Array(ORBIT_SAMPLES * 3)
  const stateScratch = new Float64Array(6)

  function resample(simTimeMs: number): void {
    if (target === null) return
    const written = sampleOrbitTeme(
      target.satrec,
      simTimeMs,
      target.meanMotionRevPerDay,
      ORBIT_SAMPLES,
      temeSamples,
    )
    sampledGmstRad = gmstRadFromUnixMs(simTimeMs)
    for (let i = 0; i < written; i++) {
      stateScratch[0] = temeSamples[i * 3]!
      stateScratch[1] = temeSamples[i * 3 + 1]!
      stateScratch[2] = temeSamples[i * 3 + 2]!
      // Every sample uses the same sidereal angle: this freezes the inertial ellipse
      // into the Earth-fixed scene as of `simTimeMs`.
      temeStateToEcf(stateScratch, sampledGmstRad, stateScratch)
      writeEcfKmToScene(stateScratch[0]!, stateScratch[1]!, stateScratch[2]!, orbitPositions, i * 3)
    }
    orbitAttribute.needsUpdate = true
    orbitGeometry.setDrawRange(0, written)
    sampledAtMs = simTimeMs
  }

  return {
    object,

    setTarget(nextTarget) {
      target = nextTarget
      sampledAtMs = Number.NaN
      object.visible = nextTarget !== null
      if (nextTarget === null) orbitGeometry.setDrawRange(0, 0)
    },

    update(simTimeMs, markerPosition) {
      if (target === null) return

      // NaN (never sampled) fails this comparison, so it also triggers the first sample.
      if (!(Math.abs(simTimeMs - sampledAtMs) < RESAMPLE_AFTER_MS)) resample(simTimeMs)

      // Earth-fixed coordinates rotate by -GMST about the pole, which is +y in the
      // scene, so the drift since sampling is a rotation of -(delta GMST) about y.
      orbit.rotation.y = -(gmstRadFromUnixMs(simTimeMs) - sampledGmstRad)

      marker.visible = markerPosition !== null
      if (markerPosition !== null) marker.position.copy(markerPosition)
    },

    setPixelRatio(nextPixelRatio) {
      markerMaterial.uniforms.uSize!.value = MARKER_SIZE_PX * nextPixelRatio
    },

    dispose() {
      orbitGeometry.dispose()
      orbitMaterial.dispose()
      markerGeometry.dispose()
      markerMaterial.dispose()
    },
  }
}
