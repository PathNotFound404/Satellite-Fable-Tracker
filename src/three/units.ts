import { EARTH_RADIUS_KM } from '../orbital/constants'

/**
 * The only place km become scene units and Earth-fixed axes become three.js axes.
 *
 * Scene scale: 1 scene unit = 1 Earth radius.
 *
 * Axes: ECF has +x through (lat 0, lon 0), +y through (lat 0, lon 90E) and +z through
 * the North Pole. three.js is y-up, and its SphereGeometry puts the centre of an
 * equirectangular texture (lon 0) on +x and lon 90E on -z. So:
 *
 *   scene.x =  ecf.x
 *   scene.y =  ecf.z
 *   scene.z = -ecf.y
 *
 * which keeps the frame right-handed and needs no rotation of the Earth mesh.
 */
export const SCENE_UNITS_PER_KM = 1 / EARTH_RADIUS_KM

export function kmToScene(km: number): number {
  return km * SCENE_UNITS_PER_KM
}

export function sceneToKm(sceneUnits: number): number {
  return sceneUnits * EARTH_RADIUS_KM
}

/**
 * Writes one ECF position (km) into `out` as scene coordinates at `offset`.
 * Takes scalars and a target array so the render loop can call it without allocating.
 */
export function writeEcfKmToScene(
  xKm: number,
  yKm: number,
  zKm: number,
  out: Float32Array | number[],
  offset = 0,
): void {
  out[offset] = xKm * SCENE_UNITS_PER_KM
  out[offset + 1] = zKm * SCENE_UNITS_PER_KM
  // `0 - y` rather than `-y` so a zero component stays +0, not -0.
  out[offset + 2] = 0 - yKm * SCENE_UNITS_PER_KM
}

const DEG_TO_RAD = Math.PI / 180

/**
 * Scene position of a point above a spherical Earth. Used for visual checks and camera
 * moves, not for orbit math (which stays in src/orbital).
 */
export function geodeticToScene(
  latitudeDeg: number,
  longitudeDeg: number,
  altitudeKm: number,
  out: Float32Array | number[],
  offset = 0,
): void {
  const lat = latitudeDeg * DEG_TO_RAD
  const lon = longitudeDeg * DEG_TO_RAD
  const rKm = EARTH_RADIUS_KM + altitudeKm
  const cosLat = Math.cos(lat)
  writeEcfKmToScene(
    rKm * cosLat * Math.cos(lon),
    rKm * cosLat * Math.sin(lon),
    rKm * Math.sin(lat),
    out,
    offset,
  )
}
