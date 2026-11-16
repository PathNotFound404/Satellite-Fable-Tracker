import {
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createGlobe } from './globe'
import { createStars } from './stars'

/** Camera distances from Earth's centre, in scene units (Earth radii). */
const CAMERA_START_DISTANCE = 3.4
const CAMERA_MIN_DISTANCE = 1.15
/** Far enough to see the whole geostationary belt (6.6 Earth radii). */
const CAMERA_MAX_DISTANCE = 22
const CAMERA_FOV_DEG = 42

/** Cap device pixel ratio: above 2 the fill-rate cost outweighs the sharpness. */
const MAX_PIXEL_RATIO = 2

/** Degrees per second-ish (OrbitControls units: 2.0 = one turn per 30 s at 60 fps). */
const AUTO_ROTATE_SPEED = 0.35

export type FrameCallback = (timeMs: number, deltaMs: number) => void

export interface GlobeSceneOptions {
  /** Idle spin before the first interaction. Turn off for reduced motion. */
  autoRotate?: boolean
  /** Called once, the first time the user drags or zooms. */
  onFirstInteraction?: () => void
}

export interface GlobeScene {
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly renderer: WebGLRenderer
  readonly controls: OrbitControls
  /** Register work to run every frame before rendering. Returns an unsubscribe function. */
  onFrame(callback: FrameCallback): () => void
  dispose(): void
}

/**
 * Builds the renderer, camera, controls, globe and backdrop on `canvas` and starts the
 * render loop. Throws if WebGL is unavailable. Plain three.js: never import Vue here.
 */
export function createGlobeScene(
  canvas: HTMLCanvasElement,
  options: GlobeSceneOptions = {},
): GlobeScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setClearColor(0x000000, 1)

  const scene = new Scene()

  const camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.01, 1000)
  // Start over the Atlantic, slightly north, so land fills the first view.
  camera.position.set(CAMERA_START_DISTANCE * 0.82, CAMERA_START_DISTANCE * 0.38, CAMERA_START_DISTANCE * 0.43)
  camera.position.setLength(CAMERA_START_DISTANCE)
  scene.add(camera)

  // Until day/night shading lands (M6), light rides with the camera so the visible
  // hemisphere is always evenly lit, like a product shot.
  const keyLight = new DirectionalLight(0xffffff, 2.6)
  keyLight.position.set(-1.2, 1.4, 2.2)
  camera.add(keyLight)
  const fillLight = new AmbientLight(0xffffff, 0.5)
  scene.add(fillLight)

  const globe = createGlobe(renderer.capabilities.getMaxAnisotropy())
  scene.add(globe.object)

  const stars = createStars()
  scene.add(stars.object)

  const controls = new OrbitControls(camera, canvas)
  controls.enablePan = false
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = CAMERA_MIN_DISTANCE
  controls.maxDistance = CAMERA_MAX_DISTANCE
  controls.zoomSpeed = 0.8
  controls.autoRotate = options.autoRotate ?? true
  controls.autoRotateSpeed = AUTO_ROTATE_SPEED

  let hasInteracted = false
  const handleControlStart = (): void => {
    controls.autoRotate = false
    if (hasInteracted) return
    hasInteracted = true
    options.onFirstInteraction?.()
  }
  controls.addEventListener('start', handleControlStart)

  const resize = (): void => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    // `false`: CSS owns the canvas's layout size; we only set the drawing buffer.
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  resize()

  const frameCallbacks: FrameCallback[] = []
  let lastTimeMs = 0
  let frameHandle = 0

  const renderFrame = (timeMs: number): void => {
    frameHandle = requestAnimationFrame(renderFrame)
    const deltaMs = lastTimeMs === 0 ? 0 : timeMs - lastTimeMs
    lastTimeMs = timeMs

    // Dragging should move the surface under the cursor by about the same amount at
    // any zoom, so rotation slows as the camera nears the surface.
    const surfaceDistance = camera.position.length() - 1
    controls.rotateSpeed = Math.min(1, Math.max(0.08, surfaceDistance / 2.4))

    for (let i = 0; i < frameCallbacks.length; i++) {
      frameCallbacks[i]!(timeMs, deltaMs)
    }
    controls.update()
    renderer.render(scene, camera)
  }
  frameHandle = requestAnimationFrame(renderFrame)

  return {
    scene,
    camera,
    renderer,
    controls,
    onFrame(callback) {
      frameCallbacks.push(callback)
      return () => {
        const index = frameCallbacks.indexOf(callback)
        if (index !== -1) frameCallbacks.splice(index, 1)
      }
    },
    dispose() {
      cancelAnimationFrame(frameHandle)
      resizeObserver.disconnect()
      controls.removeEventListener('start', handleControlStart)
      controls.dispose()
      globe.dispose()
      stars.dispose()
      renderer.dispose()
    },
  }
}
