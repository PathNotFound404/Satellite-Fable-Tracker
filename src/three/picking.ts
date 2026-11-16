import { Vector3, type Camera } from 'three'

/**
 * Click picking for the satellite point cloud.
 *
 * Done in screen space rather than with THREE.Raycaster because points are moved in
 * the vertex shader (the raw position buffer is up to a second stale) and because a
 * pixel tolerance is what "clicking a dot" means at every zoom level. It is one pass
 * of plain arithmetic over the catalog, well under a millisecond for 17k points, and
 * only runs on a click.
 */

/** What picking needs from the satellite layer. */
export interface PickSource {
  /** Scene position of satellite `index` as currently drawn; false if it isn't shown. */
  getScenePosition(index: number, target: Vector3): boolean
}

/** Slightly inside the surface so satellites skimming the limb stay pickable. */
const OCCLUDING_RADIUS = 0.995

const scenePosition = new Vector3()
const projected = new Vector3()
const cameraPosition = new Vector3()

/**
 * True if the unit-sphere Earth blocks the straight line from the camera to `point`.
 * Both in scene units.
 */
export function isBehindEarth(camera: Vector3, point: Vector3): boolean {
  const dx = point.x - camera.x
  const dy = point.y - camera.y
  const dz = point.z - camera.z
  const lengthSquared = dx * dx + dy * dy + dz * dz
  if (lengthSquared === 0) return false
  // Parameter of the closest approach to Earth's centre along camera -> point.
  const t = -(camera.x * dx + camera.y * dy + camera.z * dz) / lengthSquared
  if (t <= 0 || t >= 1) return false
  const cx = camera.x + t * dx
  const cy = camera.y + t * dy
  const cz = camera.z + t * dz
  return cx * cx + cy * cy + cz * cz < OCCLUDING_RADIUS * OCCLUDING_RADIUS
}

/**
 * Index of the visible satellite nearest to a click, or -1 if none is within
 * `tolerancePx`. Coordinates and sizes are CSS pixels relative to the canvas.
 * The camera's world and projection matrices must be current (they are after a render).
 */
export function pickSatellite(
  source: PickSource,
  count: number,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  clickX: number,
  clickY: number,
  tolerancePx: number,
): number {
  cameraPosition.setFromMatrixPosition(camera.matrixWorld)
  let bestIndex = -1
  let bestDistanceSquared = tolerancePx * tolerancePx

  for (let index = 0; index < count; index++) {
    if (!source.getScenePosition(index, scenePosition)) continue

    projected.copy(scenePosition).project(camera)
    // Outside the near/far planes (including behind the camera).
    if (projected.z < -1 || projected.z > 1) continue

    const x = (projected.x * 0.5 + 0.5) * viewportWidth
    const y = (1 - (projected.y * 0.5 + 0.5)) * viewportHeight
    const dx = x - clickX
    const dy = y - clickY
    const distanceSquared = dx * dx + dy * dy
    // `<=` so that of two points equally near the click, the later one doesn't win
    // only by order; occlusion below is the expensive test, so do it last.
    if (distanceSquared > bestDistanceSquared) continue
    if (isBehindEarth(cameraPosition, scenePosition)) continue

    bestDistanceSquared = distanceSquared
    bestIndex = index
  }

  return bestIndex
}
