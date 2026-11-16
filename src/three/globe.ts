import {
  AdditiveBlending,
  BackSide,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three'

/** NASA Blue Marble (public domain), equirectangular with longitude 0 at the centre. */
const EARTH_TEXTURE_URL = '/textures/earth-blue-marble.jpg'

/** Shown until the texture arrives, so the first frame is never a black hole. */
const OCEAN_PLACEHOLDER_COLOR = 0x0b1f3a

/**
 * The halo is drawn on the inside of a slightly larger sphere, so it only shows
 * past the Earth's limb and fades outward.
 */
const ATMOSPHERE_SCALE = 1.14
const ATMOSPHERE_COLOR = 0x4da2ff

const atmosphereVertexShader = /* glsl */ `
  varying vec3 vViewNormal;
  void main() {
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const atmosphereFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vViewNormal;
  void main() {
    float rim = pow(max(0.62 - dot(vViewNormal, vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
    gl_FragColor = vec4(uColor, 1.0) * rim;
  }
`

/** How bright the night side is, relative to day. Dim, but coastlines stay readable. */
const NIGHT_BRIGHTNESS = 0.2
/**
 * Half-width of the twilight band, as the cosine of the angle from the terminator.
 * 0.12 is about 7 degrees either side: roughly civil to nautical twilight.
 */
const TWILIGHT_HALF_WIDTH = 0.12

export interface Globe {
  /** Earth-fixed group. Radius 1 scene unit; axes as documented in units.ts. */
  readonly object: Group
  /** Unit vector from Earth's centre toward the Sun, in scene axes. Drives day/night. */
  setSunDirection(x: number, y: number, z: number): void
  dispose(): void
}

export function createGlobe(maxAnisotropy: number, onTextureLoaded?: () => void): Globe {
  const object = new Group()
  object.name = 'globe'

  const earthGeometry = new SphereGeometry(1, 96, 64)
  const earthMaterial = new MeshStandardMaterial({
    color: OCEAN_PLACEHOLDER_COLOR,
    roughness: 0.92,
    metalness: 0,
  })
  // Day/night shading is added to the standard material's shader instead of with a
  // second mesh or light: no extra draw call, and the texture and lighting are kept.
  // The globe is never rotated, so the object-space normal is already in scene axes.
  // One shared uniform object: the material recompiles when the texture arrives, and
  // each compile must bind the same value.
  const sunUniform = { value: new Vector3(1, 0, 0) }
  earthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDirection = sunUniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSceneNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSceneNormal = normal;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uSunDirection;\nvarying vec3 vSceneNormal;',
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        float sunCosine = dot(normalize(vSceneNormal), uSunDirection);
        float daylight = smoothstep(-${TWILIGHT_HALF_WIDTH.toFixed(3)}, ${TWILIGHT_HALF_WIDTH.toFixed(3)}, sunCosine);
        gl_FragColor.rgb *= mix(${NIGHT_BRIGHTNESS.toFixed(3)}, 1.0, daylight);`,
      )
  }

  const earth = new Mesh(earthGeometry, earthMaterial)
  earth.name = 'earth'
  object.add(earth)

  let disposed = false
  const texture = new TextureLoader().load(EARTH_TEXTURE_URL, () => {
    if (disposed) return
    earthMaterial.color.set(0xffffff)
    earthMaterial.map = texture
    earthMaterial.needsUpdate = true
    onTextureLoaded?.()
  })
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = maxAnisotropy

  const atmosphereMaterial = new ShaderMaterial({
    uniforms: { uColor: { value: new Color(ATMOSPHERE_COLOR) } },
    vertexShader: atmosphereVertexShader,
    fragmentShader: atmosphereFragmentShader,
    side: BackSide,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  const atmosphere = new Mesh(earthGeometry, atmosphereMaterial)
  atmosphere.name = 'atmosphere'
  atmosphere.scale.setScalar(ATMOSPHERE_SCALE)
  object.add(atmosphere)

  return {
    object,
    setSunDirection(x, y, z) {
      sunUniform.value.set(x, y, z).normalize()
    },
    dispose() {
      disposed = true
      earthGeometry.dispose()
      earthMaterial.dispose()
      atmosphereMaterial.dispose()
      texture.dispose()
    },
  }
}
