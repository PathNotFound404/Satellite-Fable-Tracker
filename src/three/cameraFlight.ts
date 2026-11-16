import { Quaternion, Vector3 } from 'three'

/**
 * Animates the camera around the globe to look at a point: the camera's direction
 * from Earth's centre sweeps along a great circle while its distance eases to a new
 * value. The camera always looks at the centre, so only its position changes.
 */
export interface CameraFlight {
  readonly active: boolean
  /**
   * Begin a flight from `fromPosition` to a point `toDistance` from the centre in the
   * direction of `toward`. A duration of 0 completes on the next `update`.
   */
  start(fromPosition: Vector3, toward: Vector3, toDistance: number, durationMs: number): void
  /** Advance by `deltaMs` and write the new camera position. No-op if not active. */
  update(deltaMs: number, cameraPosition: Vector3): void
  cancel(): void
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

export function createCameraFlight(): CameraFlight {
  const fromDirection = new Vector3()
  const toDirection = new Vector3()
  const fullRotation = new Quaternion()
  const partialRotation = new Quaternion()
  let fromDistance = 0
  let toDistance = 0
  let durationMs = 0
  let elapsedMs = 0
  let active = false

  return {
    get active() {
      return active
    },

    start(fromPosition, toward, nextDistance, nextDurationMs) {
      fromDistance = fromPosition.length()
      // A degenerate target (at the centre) has no direction to fly to.
      if (fromDistance === 0 || toward.lengthSq() === 0) return
      fromDirection.copy(fromPosition).divideScalar(fromDistance)
      toDirection.copy(toward).normalize()
      fullRotation.setFromUnitVectors(fromDirection, toDirection)
      toDistance = nextDistance
      durationMs = nextDurationMs
      elapsedMs = 0
      active = true
    },

    update(deltaMs, cameraPosition) {
      if (!active) return
      elapsedMs += deltaMs
      const progress = durationMs <= 0 ? 1 : Math.min(1, elapsedMs / durationMs)
      const eased = easeInOutCubic(progress)

      partialRotation.identity().slerp(fullRotation, eased)
      cameraPosition
        .copy(fromDirection)
        .applyQuaternion(partialRotation)
        .multiplyScalar(fromDistance + (toDistance - fromDistance) * eased)

      if (progress >= 1) active = false
    },

    cancel() {
      active = false
    },
  }
}
