import { EARTH_MU_KM3_S2, EARTH_RADIUS_KM, EARTH_ROTATION_RAD_S } from '../orbital/constants'

/**
 * Where a satellite is `dt` seconds after its last SGP4 refresh, without calling SGP4.
 *
 * A second-order step in the Earth-fixed (rotating) frame:
 *
 *   r(dt) = r + v·dt + ½·a·dt²
 *   a     = gravity + centrifugal + Coriolis
 *         = -μ·r/|r|³ - ω×(ω×r) - 2·ω×v
 *
 * Without the acceleration term a straight line is fine for a second of real time but
 * drifts kilometres when the clock runs at 1000x and states are a minute or two old.
 * With it, the remaining error is third order: about 1.6 km at 100 s for low orbit.
 *
 * Everything is in scene units (Earth radii) and seconds. The scene's +y is the
 * rotation axis, so ω = (0, ω, 0).
 *
 * The same formula exists twice, here for the CPU (picking, marker, camera) and as GLSL
 * for the vertex shader. They are generated from the same constants; keep the two
 * bodies in step.
 */

/** Earth's gravitational parameter in scene units: (Earth radii)³ / s². */
export const MU_SCENE = EARTH_MU_KM3_S2 / EARTH_RADIUS_KM ** 3

const OMEGA = EARTH_ROTATION_RAD_S

/** Writes the extrapolated position into `out` as [x, y, z]. Does not allocate. */
export function extrapolate(
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  dtSeconds: number,
  out: { set(x: number, y: number, z: number): unknown },
): void {
  const r2 = Math.max(x * x + y * y + z * z, 1e-6)
  const gravity = -MU_SCENE / (r2 * Math.sqrt(r2))
  const ax = gravity * x + OMEGA * OMEGA * x - 2 * OMEGA * vz
  const ay = gravity * y
  const az = gravity * z + OMEGA * OMEGA * z + 2 * OMEGA * vx
  const half = 0.5 * dtSeconds * dtSeconds
  out.set(x + vx * dtSeconds + ax * half, y + vy * dtSeconds + ay * half, z + vz * dtSeconds + az * half)
}

/** GLSL twin of `extrapolate`. Include in a vertex shader and call `extrapolate(r, v, dt)`. */
export const EXTRAPOLATE_GLSL = /* glsl */ `
  const float MU_SCENE = ${MU_SCENE.toExponential(8)};
  const float EARTH_OMEGA = ${OMEGA.toExponential(8)};

  vec3 extrapolate(vec3 r, vec3 v, float dt) {
    float r2 = max(dot(r, r), 1e-6);
    vec3 a = (-MU_SCENE / (r2 * sqrt(r2))) * r;
    a += EARTH_OMEGA * EARTH_OMEGA * vec3(r.x, 0.0, r.z);
    a += 2.0 * EARTH_OMEGA * vec3(-v.z, 0.0, v.x);
    return r + v * dt + 0.5 * a * dt * dt;
  }
`
