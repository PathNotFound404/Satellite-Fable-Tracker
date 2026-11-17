import { BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, type Vector3 } from 'three'

/**
 * A ring drawn round one extra satellite, in the warning colour, to point out the
 * other object in a close approach. One vertex, one draw call, shader-drawn like the
 * selection marker but without the centre dot, so the two can sit on top of each other.
 */

/** Matches --color-warning in styles/tokens.css. */
const HIGHLIGHT_COLOR = 0xff9f0a
/** CSS pixels. Larger than the selection marker so both show when the two are close. */
const HIGHLIGHT_SIZE_PX = 32

const vertexShader = /* glsl */ `
  uniform float uSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;           // 0 centre, 1 edge
    float alpha = smoothstep(0.74, 0.82, r) * (1.0 - smoothstep(0.92, 1.0, r));
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`

export interface HighlightMarker {
  readonly object: Points
  /** Per frame: put the ring at `position`, or hide it if null. */
  update(position: Vector3 | null): void
  setPixelRatio(pixelRatio: number): void
  dispose(): void
}

export function createHighlightMarker(pixelRatio: number): HighlightMarker {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
  const material = new ShaderMaterial({
    uniforms: {
      uSize: { value: HIGHLIGHT_SIZE_PX * pixelRatio },
      uColor: { value: new Color(HIGHLIGHT_COLOR) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  })
  const object = new Points(geometry, material)
  object.name = 'highlight-marker'
  object.frustumCulled = false
  object.renderOrder = 4
  object.visible = false

  return {
    object,
    update(position) {
      object.visible = position !== null
      if (position !== null) object.position.copy(position)
    },
    setPixelRatio(nextPixelRatio) {
      material.uniforms.uSize!.value = HIGHLIGHT_SIZE_PX * nextPixelRatio
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
