<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createGlobeScene, type GlobeScene } from '../three/scene'

const emit = defineEmits<{
  /** The scene exists and is rendering. three.js objects are passed raw, never made reactive. */
  ready: [scene: GlobeScene]
  /** The user dragged or zoomed for the first time. */
  interact: []
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const webglFailed = ref(false)

// Deliberately not a ref: three.js objects stay out of Vue reactivity.
let globeScene: GlobeScene | null = null

onMounted(() => {
  if (!canvas.value) return
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  try {
    globeScene = createGlobeScene(canvas.value, {
      autoRotate: !prefersReducedMotion,
      onFirstInteraction: () => emit('interact'),
    })
    emit('ready', globeScene)
  } catch (error) {
    console.error('Could not start WebGL', error)
    webglFailed.value = true
  }
})

onBeforeUnmount(() => {
  globeScene?.dispose()
  globeScene = null
})
</script>

<template>
  <div class="globe">
    <canvas
      v-show="!webglFailed"
      ref="canvas"
      class="globe__canvas"
      aria-label="Interactive 3D globe. Drag to rotate, scroll or pinch to zoom."
    ></canvas>
    <div v-if="webglFailed" class="globe__fallback glass" role="alert">
      <h2>3D graphics are unavailable</h2>
      <p>
        This app needs WebGL to draw the globe. Try a current version of Chrome, Edge, Firefox or
        Safari, or turn on hardware acceleration in your browser settings.
      </p>
    </div>
  </div>
</template>

<style scoped>
.globe {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}

.globe__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
  /* Let OrbitControls handle touch gestures instead of the browser. */
  touch-action: none;
}

.globe__canvas:active {
  cursor: grabbing;
}

.globe__fallback {
  max-width: 420px;
  margin: var(--space-4);
  padding: var(--space-6);
  text-align: center;
}

.globe__fallback h2 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-title);
  font-weight: var(--font-weight-semibold);
}

.globe__fallback p {
  margin: 0;
  color: var(--color-text-secondary);
}
</style>
