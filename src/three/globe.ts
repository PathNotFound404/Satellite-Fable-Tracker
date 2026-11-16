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

export interface Globe {
  /** Earth-fixed group. Radius 1 scene unit; axes as documented in units.ts. */
  readonly object: Group
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
    dispose() {
      disposed = true
      earthGeometry.dispose()
      earthMaterial.dispose()
      atmosphereMaterial.dispose()
      texture.dispose()
    },
  }
}
