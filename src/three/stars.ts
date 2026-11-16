import { BufferAttribute, BufferGeometry, Points, PointsMaterial } from 'three'

const STAR_COUNT = 1800
/** Scene units. Far outside the widest camera orbit, inside the far plane. */
const STAR_SHELL_RADIUS = 400

/** Small seeded PRNG so the backdrop is identical on every load (and in screenshots). */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Stars {
  readonly object: Points
  dispose(): void
}

/** A quiet, decorative star backdrop: one draw call, not real star positions. */
export function createStars(): Stars {
  const random = mulberry32(20261116)
  const positions = new Float32Array(STAR_COUNT * 3)
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform on a sphere: uniform in z and in azimuth.
    const z = random() * 2 - 1
    const azimuth = random() * Math.PI * 2
    const ring = Math.sqrt(1 - z * z)
    positions[i * 3] = STAR_SHELL_RADIUS * ring * Math.cos(azimuth)
    positions[i * 3 + 1] = STAR_SHELL_RADIUS * z
    positions[i * 3 + 2] = STAR_SHELL_RADIUS * ring * Math.sin(azimuth)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))

  const material = new PointsMaterial({
    color: 0xffffff,
    size: 1.4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })

  const object = new Points(geometry, material)
  object.name = 'stars'
  // Drawn first so it never needs depth sorting against the globe.
  object.renderOrder = -1

  return {
    object,
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
