import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Line,
  LineBasicMaterial,
  Points,
  ShaderMaterial,
  type Vector3,
} from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
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
 * only a periodic re-sample to keep it centred on the present. It is drawn in its own
 * colour so it can't be mistaken for the orbit, and in two halves so its direction is
 * readable: where the satellite has been is solid and dimmer, where it is going is
 * dashed and brighter. Plain WebGL lines are always one pixel wide, so the track uses
 * three's screen-space wide lines (LineSegments2) to get a two-pixel stroke.
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
/** Matches --color-ground-track in tokens.css. */
const GROUND_TRACK_COLOR = 0xffd60a
/** CSS pixels. */
const GROUND_TRACK_WIDTH_PX = 2
const GROUND_TRACK_PAST_OPACITY = 0.55
const GROUND_TRACK_AHEAD_OPACITY = 0.95
/** Line segments in each half (past and ahead). */
const GROUND_TRACK_HALF_SEGMENTS = (GROUND_TRACK_SAMPLES - 1) / 2
/**
 * More often than the orbit, so the join between the solid and dashed halves stays
 * within about 40 km of the point under a low satellite.
 */
const GROUND_TRACK_RESAMPLE_AFTER_MS = 5_000
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

  // Ground track: two wide lines. Each segment is one instance holding its start and
  // end point; the buffers are filled by hand on each re-sample because the library's
  // setPositions and computeLineDistances allocate new buffers every call.
  const pastSegments = new Float32Array(GROUND_TRACK_HALF_SEGMENTS * 6)
  const aheadSegments = new Float32Array(GROUND_TRACK_HALF_SEGMENTS * 6)
  /** Distance along the line at the start and end of each segment, for the dashes. */
  const aheadDistances = new Float32Array(GROUND_TRACK_HALF_SEGMENTS * 2)
  const pastBuffer = new InstancedInterleavedBuffer(pastSegments, 6, 1).setUsage(DynamicDrawUsage)
  const aheadBuffer = new InstancedInterleavedBuffer(aheadSegments, 6, 1).setUsage(DynamicDrawUsage)
  const aheadDistanceBuffer = new InstancedInterleavedBuffer(aheadDistances, 2, 1).setUsage(
    DynamicDrawUsage,
  )

  const pastGeometry = new LineSegmentsGeometry()
  pastGeometry.setAttribute('instanceStart', new InterleavedBufferAttribute(pastBuffer, 3, 0))
  pastGeometry.setAttribute('instanceEnd', new InterleavedBufferAttribute(pastBuffer, 3, 3))
  pastGeometry.instanceCount = 0
  const aheadGeometry = new LineSegmentsGeometry()
  aheadGeometry.setAttribute('instanceStart', new InterleavedBufferAttribute(aheadBuffer, 3, 0))
  aheadGeometry.setAttribute('instanceEnd', new InterleavedBufferAttribute(aheadBuffer, 3, 3))
  aheadGeometry.setAttribute(
    'instanceDistanceStart',
    new InterleavedBufferAttribute(aheadDistanceBuffer, 1, 0),
  )
  aheadGeometry.setAttribute(
    'instanceDistanceEnd',
    new InterleavedBufferAttribute(aheadDistanceBuffer, 1, 1),
  )
  aheadGeometry.instanceCount = 0

  // The line width is in CSS pixels: LineSegments2 reads the viewport size from the
  // renderer before each draw, so no resize or pixel-ratio handling is needed here.
  const pastMaterial = new LineMaterial({
    color: GROUND_TRACK_COLOR,
    linewidth: GROUND_TRACK_WIDTH_PX,
    transparent: true,
    opacity: GROUND_TRACK_PAST_OPACITY,
    depthWrite: false,
  })
  const aheadMaterial = new LineMaterial({
    color: GROUND_TRACK_COLOR,
    linewidth: GROUND_TRACK_WIDTH_PX,
    dashed: true,
    dashSize: GROUND_TRACK_DASH,
    gapSize: GROUND_TRACK_GAP,
    transparent: true,
    opacity: GROUND_TRACK_AHEAD_OPACITY,
    depthWrite: false,
  })
  const trackPast = new LineSegments2(pastGeometry, pastMaterial)
  trackPast.name = 'ground-track-past'
  trackPast.frustumCulled = false
  trackPast.renderOrder = 2
  object.add(trackPast)
  const trackAhead = new LineSegments2(aheadGeometry, aheadMaterial)
  trackAhead.name = 'ground-track-ahead'
  trackAhead.frustumCulled = false
  trackAhead.renderOrder = 2
  object.add(trackAhead)

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
  let trackSampledAtMs = Number.NaN
  let sampledGmstRad = 0
  const temeSamples = new Float64Array(ORBIT_SAMPLES * 3)
  const trackSamples = new Float64Array(GROUND_TRACK_SAMPLES * 3)
  /** The track in scene coordinates, before it is split into segments. */
  const trackPoints = new Float32Array(GROUND_TRACK_SAMPLES * 3)
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
    orbitGeometry.setDrawRange(0, written)
    sampledAtMs = simTimeMs
  }

  function resampleTrack(simTimeMs: number): void {
    if (target === null) return
    trackSampledAtMs = simTimeMs
    const written = sampleGroundTrackEcf(
      target.satrec,
      simTimeMs,
      target.meanMotionRevPerDay,
      GROUND_TRACK_SAMPLES,
      trackSamples,
    )
    // A satellite that can't be propagated across the whole window (about to decay)
    // gets no track rather than a partial one whose middle isn't the present.
    if (written < GROUND_TRACK_SAMPLES) {
      pastGeometry.instanceCount = 0
      aheadGeometry.instanceCount = 0
      return
    }
    for (let i = 0; i < GROUND_TRACK_SAMPLES; i++) {
      const offset = i * 3
      writeEcfKmToScene(
        trackSamples[offset]! * trackRadiusKm,
        trackSamples[offset + 1]! * trackRadiusKm,
        trackSamples[offset + 2]! * trackRadiusKm,
        trackPoints,
        offset,
      )
    }
    // Segment s runs from point s to point s + 1, which are six consecutive numbers.
    // The dash distance starts at the present, so the dashes lead away from the
    // satellite.
    let distance = 0
    for (let s = 0; s < GROUND_TRACK_HALF_SEGMENTS; s++) {
      const pastFrom = s * 3
      const aheadFrom = (GROUND_TRACK_HALF_SEGMENTS + s) * 3
      for (let k = 0; k < 6; k++) {
        pastSegments[s * 6 + k] = trackPoints[pastFrom + k]!
        aheadSegments[s * 6 + k] = trackPoints[aheadFrom + k]!
      }
      aheadDistances[s * 2] = distance
      distance += Math.hypot(
        trackPoints[aheadFrom + 3]! - trackPoints[aheadFrom]!,
        trackPoints[aheadFrom + 4]! - trackPoints[aheadFrom + 1]!,
        trackPoints[aheadFrom + 5]! - trackPoints[aheadFrom + 2]!,
      )
      aheadDistances[s * 2 + 1] = distance
    }
    pastBuffer.needsUpdate = true
    aheadBuffer.needsUpdate = true
    aheadDistanceBuffer.needsUpdate = true
    pastGeometry.instanceCount = GROUND_TRACK_HALF_SEGMENTS
    aheadGeometry.instanceCount = GROUND_TRACK_HALF_SEGMENTS
  }

  return {
    object,

    setTarget(nextTarget) {
      target = nextTarget
      sampledAtMs = Number.NaN
      trackSampledAtMs = Number.NaN
      object.visible = nextTarget !== null
      if (nextTarget === null) {
        orbitGeometry.setDrawRange(0, 0)
        pastGeometry.instanceCount = 0
        aheadGeometry.instanceCount = 0
      }
    },

    update(simTimeMs, markerPosition) {
      if (target === null) return

      // NaN (never sampled) fails this comparison, so it also triggers the first sample.
      if (!(Math.abs(simTimeMs - sampledAtMs) < RESAMPLE_AFTER_MS)) resample(simTimeMs)
      if (!(Math.abs(simTimeMs - trackSampledAtMs) < GROUND_TRACK_RESAMPLE_AFTER_MS)) {
        resampleTrack(simTimeMs)
      }

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
      pastGeometry.dispose()
      pastMaterial.dispose()
      aheadGeometry.dispose()
      aheadMaterial.dispose()
      markerGeometry.dispose()
      markerMaterial.dispose()
    },
  }
}
