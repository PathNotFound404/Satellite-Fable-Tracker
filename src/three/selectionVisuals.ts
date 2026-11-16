import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Points,
  ShaderMaterial,
  type Vector3,
} from 'three'
import { gmstRadFromUnixMs, temeStateToEcf } from '../orbital/frames'
import { sampleGroundTrackEcf, sampleOrbitTeme } from '../orbital/orbitPath'
import type { SatRec } from '../orbital/propagation'
import { sceneToKm, writeEcfKmToScene } from './units'

/**
 * What is drawn for the selected satellite: a ring marker on the point, its orbit and
 * its ground track.
 *
 * The orbit is one period sampled in the inertial frame, where it is a closed ellipse,
 * then placed in the Earth-fixed scene using the sidereal angle at sampling time. As
 * the Earth turns under the orbit, the whole line is rotated about the polar axis by
 * the change in sidereal angle, which costs one number per frame instead of a
 * re-sample. It is re-sampled every so often so drag and precession don't accumulate.
 *
 * The ground track is the path of the point directly below the satellite, one orbit
 * behind and one ahead. It is fixed to the Earth, so it needs no per-frame rotation,
 * only the same periodic re-sample to keep it centred on the present. It is drawn
 * dashed and neutral so it can't be mistaken for the solid, accent-coloured orbit.
 */

/** Matches --color-accent in tokens.css. */
const ACCENT_COLOR = 0x0a84ff
/** Enough for a smooth ellipse, including sparse perigee passes of eccentric orbits. */
const ORBIT_SAMPLES = 361
const RESAMPLE_AFTER_MS = 20_000
/** Odd, so the middle sample is exactly the present. About 2 degrees of orbit apart. */
const GROUND_TRACK_SAMPLES = 361
/** Just above the surface (about 19 km) so the line doesn't fight the globe for depth. */
const GROUND_TRACK_RADIUS = 1.003
const GROUND_TRACK_COLOR = 0xf5f5f7
/** Dash and gap lengths in scene units (Earth radii): about 115 km and 75 km. */
const GROUND_TRACK_DASH = 0.018
const GROUND_TRACK_GAP = 0.012
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

  // Ground track
  const trackPositions = new Float32Array(GROUND_TRACK_SAMPLES * 3)
  const trackDistances = new Float32Array(GROUND_TRACK_SAMPLES)
  const trackPositionAttribute = new BufferAttribute(trackPositions, 3).setUsage(DynamicDrawUsage)
  // LineDashedMaterial reads the distance along the line from this attribute. Filled in
  // by hand on each re-sample; Line.computeLineDistances would allocate every time.
  const trackDistanceAttribute = new BufferAttribute(trackDistances, 1).setUsage(DynamicDrawUsage)
  const trackGeometry = new BufferGeometry()
  trackGeometry.setAttribute('position', trackPositionAttribute)
  trackGeometry.setAttribute('lineDistance', trackDistanceAttribute)
  trackGeometry.setDrawRange(0, 0)
  const trackMaterial = new LineDashedMaterial({
    color: GROUND_TRACK_COLOR,
    dashSize: GROUND_TRACK_DASH,
    gapSize: GROUND_TRACK_GAP,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  })
  const track = new Line(trackGeometry, trackMaterial)
  track.name = 'ground-track'
  track.frustumCulled = false
  track.renderOrder = 2
  object.add(track)

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
  const trackSamples = new Float64Array(GROUND_TRACK_SAMPLES * 3)
  const trackRadiusKm = sceneToKm(GROUND_TRACK_RADIUS)
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

    const trackWritten = sampleGroundTrackEcf(
      target.satrec,
      simTimeMs,
      target.meanMotionRevPerDay,
      GROUND_TRACK_SAMPLES,
      trackSamples,
    )
    let distance = 0
    for (let i = 0; i < trackWritten; i++) {
      const offset = i * 3
      writeEcfKmToScene(
        trackSamples[offset]! * trackRadiusKm,
        trackSamples[offset + 1]! * trackRadiusKm,
        trackSamples[offset + 2]! * trackRadiusKm,
        trackPositions,
        offset,
      )
      if (i > 0) {
        distance += Math.hypot(
          trackPositions[offset]! - trackPositions[offset - 3]!,
          trackPositions[offset + 1]! - trackPositions[offset - 2]!,
          trackPositions[offset + 2]! - trackPositions[offset - 1]!,
        )
      }
      trackDistances[i] = distance
    }
    trackPositionAttribute.needsUpdate = true
    trackDistanceAttribute.needsUpdate = true
    trackGeometry.setDrawRange(0, trackWritten)
    orbitGeometry.setDrawRange(0, written)
    sampledAtMs = simTimeMs
  }

  return {
    object,

    setTarget(nextTarget) {
      target = nextTarget
      sampledAtMs = Number.NaN
      object.visible = nextTarget !== null
      if (nextTarget === null) {
        orbitGeometry.setDrawRange(0, 0)
        trackGeometry.setDrawRange(0, 0)
      }
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
      trackGeometry.dispose()
      trackMaterial.dispose()
      markerGeometry.dispose()
      markerMaterial.dispose()
    },
  }
}
