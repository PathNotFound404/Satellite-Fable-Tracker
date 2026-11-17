import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import { EARTH_RADIUS_KM } from '../orbital/constants'

/**
 * Space station glyphs: a small station-shaped mark drawn over each space station.
 *
 * Stations are still points in the main satellite layer; this is one extra Points
 * object (one draw call) holding a handful of vertices, drawn on top. The glyph is
 * drawn in the fragment shader, so there is no texture to load.
 *
 * The catalog lists every module and docked vehicle of a station separately, all in
 * the same place. Members closer together than CLUSTER_DISTANCE_KM share one glyph,
 * worked out again every frame so a vehicle that undocks gets its own glyph as it
 * drifts away. With a few dozen members that is a few hundred comparisons.
 */

/** What the layer needs from the satellite layer. */
export interface StationPositionSource {
  /** Scene position of satellite `index` as currently drawn; false if it isn't shown. */
  getScenePosition(index: number, target: Vector3): boolean
}

export interface StationLayer {
  readonly object: Points
  /** Re-reads member positions and rebuilds the glyphs. Call once per frame. Does not allocate. */
  update(source: StationPositionSource): void
  /** How many glyphs are drawn after the last `update`. */
  glyphCount(): number
  /**
   * The catalog index that stands for the station `index` belongs to: the member the
   * glyph is drawn on. Returns `index` itself for anything that isn't a shown station.
   */
  representativeOf(index: number): number
  setPixelRatio(pixelRatio: number): void
  dispose(): void
}

const CLUSTER_DISTANCE_KM = 50
const CLUSTER_DISTANCE_SQUARED = (CLUSTER_DISTANCE_KM / EARTH_RADIUS_KM) ** 2

const GLYPH_COLOR = 0xf5f5f7
/** CSS pixels, edge to edge. */
const GLYPH_SIZE_PX = 22

const vertexShader = /* glsl */ `
  uniform float uSize; // device pixels

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
  }
`

// The glyph: a central module, a truss across it and a pair of solar panels at each
// end, with a dark halo so it reads over both the globe and the white satellite dots.
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;

  float box(vec2 p, vec2 centre, vec2 halfSize) {
    vec2 d = abs(p - centre) - halfSize;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  void main() {
    // -1 to 1 across the sprite.
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = box(p, vec2(0.0), vec2(0.13, 0.4));          // module
    d = min(d, box(p, vec2(0.0), vec2(0.8, 0.045)));       // truss
    d = min(d, box(p, vec2(-0.6, 0.0), vec2(0.17, 0.52))); // panels
    d = min(d, box(p, vec2(0.6, 0.0), vec2(0.17, 0.52)));

    float edge = fwidth(d);
    float fill = 1.0 - smoothstep(-edge, edge, d);
    float halo = (1.0 - smoothstep(0.06, 0.22, d)) * 0.7;
    float alpha = max(fill, halo);
    if (alpha <= 0.01) discard;
    gl_FragColor = vec4(uColor * fill, alpha);
    #include <colorspace_fragment>
  }
`

/**
 * `memberIndices` are the catalog indices of the stations group, in order of
 * preference for carrying the glyph (the first shown member of a cluster wins).
 */
export function createStationLayer(memberIndices: ArrayLike<number>, pixelRatio: number): StationLayer {
  const memberCount = memberIndices.length
  const slotByIndex = new Map<number, number>()
  for (let slot = 0; slot < memberCount; slot++) slotByIndex.set(memberIndices[slot]!, slot)

  // One vertex per glyph; at most one glyph per member.
  const positions = new Float32Array(memberCount * 3)
  /** Catalog index carrying glyph g. */
  const glyphOwner = new Int32Array(memberCount)
  /** For each member slot, the catalog index of its cluster's glyph owner, or -1 if not shown. */
  const representative = new Int32Array(memberCount).fill(-1)
  let glyphs = 0

  const positionAttribute = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', positionAttribute)
  geometry.setDrawRange(0, 0)

  const material = new ShaderMaterial({
    uniforms: {
      uSize: { value: GLYPH_SIZE_PX * pixelRatio },
      uColor: { value: new Color(GLYPH_COLOR) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  })

  const object = new Points(geometry, material)
  object.name = 'stations'
  object.frustumCulled = false
  // Over the satellite dots (1) and the selection's lines (2).
  object.renderOrder = 3

  const scratch = new Vector3()

  return {
    object,

    update(source) {
      glyphs = 0
      for (let slot = 0; slot < memberCount; slot++) {
        const index = memberIndices[slot]!
        if (!source.getScenePosition(index, scratch)) {
          representative[slot] = -1
          continue
        }
        let owner = -1
        for (let glyph = 0; glyph < glyphs; glyph++) {
          const dx = positions[glyph * 3]! - scratch.x
          const dy = positions[glyph * 3 + 1]! - scratch.y
          const dz = positions[glyph * 3 + 2]! - scratch.z
          if (dx * dx + dy * dy + dz * dz < CLUSTER_DISTANCE_SQUARED) {
            owner = glyphOwner[glyph]!
            break
          }
        }
        if (owner === -1) {
          positions[glyphs * 3] = scratch.x
          positions[glyphs * 3 + 1] = scratch.y
          positions[glyphs * 3 + 2] = scratch.z
          glyphOwner[glyphs] = index
          owner = index
          glyphs++
        }
        representative[slot] = owner
      }
      geometry.setDrawRange(0, glyphs)
      positionAttribute.needsUpdate = true
    },

    glyphCount: () => glyphs,

    representativeOf(index) {
      const slot = slotByIndex.get(index)
      if (slot === undefined) return index
      const owner = representative[slot]!
      return owner === -1 ? index : owner
    },

    setPixelRatio(nextPixelRatio) {
      material.uniforms.uSize!.value = GLYPH_SIZE_PX * nextPixelRatio
    },

    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
