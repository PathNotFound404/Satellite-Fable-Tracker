import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createCameraFlight } from './cameraFlight'

describe('createCameraFlight', () => {
  it('ends directly above the target at the requested distance', () => {
    const flight = createCameraFlight()
    const camera = new Vector3(0, 0, 3.4)
    const target = new Vector3(1.07, 0.2, -0.3)

    flight.start(camera, target, 3.4, 900)
    for (let frame = 0; frame < 60 && flight.active; frame++) flight.update(16.7, camera)

    expect(flight.active).toBe(false)
    expect(camera.length()).toBeCloseTo(3.4, 6)
    expect(camera.clone().normalize().angleTo(target.clone().normalize())).toBeCloseTo(0, 6)
  })

  it('moves along the great circle at a steady distance, never through the Earth', () => {
    const flight = createCameraFlight()
    const camera = new Vector3(0, 0, 3)
    flight.start(camera, new Vector3(-0.2, 0.1, -1), 3, 1000)

    let previousAngle = 0
    const start = camera.clone()
    for (let frame = 0; frame < 100 && flight.active; frame++) {
      flight.update(10, camera)
      expect(camera.length()).toBeCloseTo(3, 6)
      const angle = camera.angleTo(start)
      expect(angle).toBeGreaterThanOrEqual(previousAngle - 1e-9)
      previousAngle = angle
    }
    expect(previousAngle).toBeGreaterThan(2.8)
  })

  it('eases the distance when the target needs a different one', () => {
    const flight = createCameraFlight()
    const camera = new Vector3(0, 0, 2)
    flight.start(camera, new Vector3(6.6, 0, 0), 8, 500)

    flight.update(250, camera)
    expect(camera.length()).toBeCloseTo(5, 6)
    flight.update(250, camera)
    expect(camera.length()).toBeCloseTo(8, 6)
  })

  it('jumps straight there with a zero duration (reduced motion)', () => {
    const flight = createCameraFlight()
    const camera = new Vector3(0, 0, 3)
    flight.start(camera, new Vector3(0, 1, 0), 3, 0)
    flight.update(0, camera)

    expect(flight.active).toBe(false)
    expect(camera.x).toBeCloseTo(0, 9)
    expect(camera.y).toBeCloseTo(3, 9)
    expect(camera.z).toBeCloseTo(0, 9)
  })

  it('stops where it is when cancelled', () => {
    const flight = createCameraFlight()
    const camera = new Vector3(0, 0, 3)
    flight.start(camera, new Vector3(1, 0, 0), 3, 1000)
    flight.update(300, camera)
    const paused = camera.clone()

    flight.cancel()
    flight.update(300, camera)
    expect(camera.equals(paused)).toBe(true)
  })

  it('ignores a target at the centre of the Earth', () => {
    const flight = createCameraFlight()
    flight.start(new Vector3(0, 0, 3), new Vector3(0, 0, 0), 3, 500)
    expect(flight.active).toBe(false)
  })
})
