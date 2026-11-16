import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { isBehindEarth, pickSatellite, type PickSource } from './picking'

const WIDTH = 800
const HEIGHT = 600

/** Camera on +z looking at the origin, like the app's default view. */
function makeCamera(distance = 4): PerspectiveCamera {
  const camera = new PerspectiveCamera(45, WIDTH / HEIGHT, 0.01, 1000)
  camera.position.set(0, 0, distance)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

/** A fixed set of points; null entries are "not shown". */
function source(points: Array<Vector3 | null>): PickSource {
  return {
    getScenePosition(index, target) {
      const point = points[index]
      if (!point) return false
      target.copy(point)
      return true
    },
  }
}

/** Where a scene point lands on screen, in CSS pixels. */
function toScreen(point: Vector3, camera: PerspectiveCamera): { x: number; y: number } {
  const ndc = point.clone().project(camera)
  return { x: (ndc.x * 0.5 + 0.5) * WIDTH, y: (1 - (ndc.y * 0.5 + 0.5)) * HEIGHT }
}

describe('isBehindEarth', () => {
  const camera = new Vector3(0, 0, 4)

  it('is false for points in front of the globe', () => {
    expect(isBehindEarth(camera, new Vector3(0, 0, 1.07))).toBe(false)
    expect(isBehindEarth(camera, new Vector3(0.5, 0.5, 1.2))).toBe(false)
  })

  it('is true for points directly behind the globe', () => {
    expect(isBehindEarth(camera, new Vector3(0, 0, -1.07))).toBe(true)
    expect(isBehindEarth(camera, new Vector3(0.3, -0.2, -2))).toBe(true)
  })

  it('is false for points beside the globe, even if farther than its centre', () => {
    expect(isBehindEarth(camera, new Vector3(3, 0, -1))).toBe(false)
  })
})

describe('pickSatellite', () => {
  it('picks the point under the click', () => {
    const camera = makeCamera()
    const points = [new Vector3(0.4, 0.3, 1.1), new Vector3(-0.5, 0.2, 1.05)]
    const click = toScreen(points[1]!, camera)

    expect(pickSatellite(source(points), 2, camera, WIDTH, HEIGHT, click.x, click.y, 10)).toBe(1)
  })

  it('picks the nearest of several points inside the tolerance', () => {
    const camera = makeCamera()
    const points = [new Vector3(0.4, 0.3, 1.1), new Vector3(0.41, 0.3, 1.1), new Vector3(0.43, 0.3, 1.1)]
    const click = toScreen(points[1]!, camera)

    expect(pickSatellite(source(points), 3, camera, WIDTH, HEIGHT, click.x + 0.5, click.y, 10)).toBe(1)
  })

  it('returns -1 when the click is farther than the tolerance from every point', () => {
    const camera = makeCamera()
    const points = [new Vector3(0.4, 0.3, 1.1)]
    const click = toScreen(points[0]!, camera)

    expect(pickSatellite(source(points), 1, camera, WIDTH, HEIGHT, click.x + 11, click.y, 10)).toBe(-1)
    expect(pickSatellite(source(points), 1, camera, WIDTH, HEIGHT, click.x + 9, click.y, 10)).toBe(0)
  })

  it('ignores points hidden behind the Earth', () => {
    const camera = makeCamera()
    const hidden = new Vector3(0.2, 0.1, -1.1)
    const click = toScreen(hidden, camera)

    expect(pickSatellite(source([hidden]), 1, camera, WIDTH, HEIGHT, click.x, click.y, 10)).toBe(-1)
  })

  it('prefers a visible point over a hidden one at the same screen position', () => {
    const camera = makeCamera()
    const front = new Vector3(0.2, 0.1, 1.1)
    // On the same line of sight from the camera, on the far side of the globe.
    const cameraPosition = new Vector3(0, 0, 4)
    const behind = cameraPosition.clone().add(front.clone().sub(cameraPosition).multiplyScalar(1.7))
    const click = toScreen(front, camera)

    expect(pickSatellite(source([behind, front]), 2, camera, WIDTH, HEIGHT, click.x, click.y, 10)).toBe(1)
    expect(pickSatellite(source([front, behind]), 2, camera, WIDTH, HEIGHT, click.x, click.y, 10)).toBe(0)
  })

  it('skips points that are not shown (invalid or filtered out)', () => {
    const camera = makeCamera()
    const point = new Vector3(0.4, 0.3, 1.1)
    const click = toScreen(point, camera)

    expect(pickSatellite(source([null, point]), 2, camera, WIDTH, HEIGHT, click.x, click.y, 10)).toBe(1)
    expect(pickSatellite(source([null]), 1, camera, WIDTH, HEIGHT, click.x, click.y, 10)).toBe(-1)
  })

  it('ignores points behind the camera', () => {
    const camera = makeCamera()
    const behindCamera = new Vector3(0, 0, 6)

    expect(pickSatellite(source([behindCamera]), 1, camera, WIDTH, HEIGHT, WIDTH / 2, HEIGHT / 2, 50)).toBe(-1)
  })

  it('picks from a full-size catalog quickly', () => {
    const camera = makeCamera()
    const count = 17_000
    const points: Vector3[] = []
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399963
      const y = 1 - (2 * (i + 0.5)) / count
      const ring = Math.sqrt(1 - y * y)
      points.push(new Vector3(Math.cos(angle) * ring, y, Math.sin(angle) * ring).multiplyScalar(1.08))
    }
    const target = 4321
    // Make sure the target is on the near side.
    points[target] = new Vector3(0.31, 0.27, 1.02)
    const click = toScreen(points[target]!, camera)
    const pickSource = source(points)

    // Best of several runs: other test files run in parallel and can steal the CPU
    // for any single measurement.
    let picked = -1
    let elapsedMs = Infinity
    for (let run = 0; run < 10; run++) {
      const start = performance.now()
      picked = pickSatellite(pickSource, count, camera, WIDTH, HEIGHT, click.x, click.y, 4)
      elapsedMs = Math.min(elapsedMs, performance.now() - start)
    }

    expect(picked).toBe(target)
    // "Within one frame or so": generous bound so slow CI machines don't flake.
    expect(elapsedMs).toBeLessThan(16)
  })
})
