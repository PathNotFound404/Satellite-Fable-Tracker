<script setup lang="ts">
import { computed, markRaw, ref, shallowRef } from 'vue'
import DataAgeBadge from './components/DataAgeBadge.vue'
import DebugReadout from './components/DebugReadout.vue'
import GlobeCanvas from './components/GlobeCanvas.vue'
import { useSatelliteLayer } from './composables/useSatelliteLayer'
import { useSatellites } from './composables/useSatellites'
import type { GlobeScene } from './three/scene'

const showHint = ref(true)
const { file, status, errorMessage } = useSatellites()

// Raw three.js scene handle: shallow and marked raw so Vue never proxies it.
const globeScene = shallowRef<GlobeScene | null>(null)
const { trackedCount, stats } = useSatelliteLayer(globeScene, file)

// Opt-in performance readout: add ?debug to the URL.
const showDebug = new URLSearchParams(window.location.search).has('debug')

const countFormat = new Intl.NumberFormat()
const subtitle = computed(() =>
  trackedCount.value === null
    ? 'Live orbital data on a 3D globe'
    : `${countFormat.format(trackedCount.value)} satellites, live`,
)
</script>

<template>
  <main class="app">
    <GlobeCanvas @ready="globeScene = markRaw($event)" @interact="showHint = false" />

    <header class="app__title glass">
      <h1>Satellite Tracker</h1>
      <p class="numeric">{{ subtitle }}</p>
    </header>

    <div class="app__status">
      <DataAgeBadge
        :status="status"
        :generated-at="file?.generatedAt ?? null"
        :error-message="errorMessage"
      />
    </div>

    <DebugReadout v-if="showDebug" class="app__debug" :stats="stats" />

    <Transition name="fade">
      <p v-if="showHint" class="app__hint glass">Drag to rotate · Scroll to zoom</p>
    </Transition>
  </main>
</template>

<style scoped>
.app {
  position: relative;
  height: 100%;
}

.app__title {
  position: absolute;
  top: var(--inset-top);
  left: var(--inset-left);
  padding: var(--space-3) var(--space-4);
  /* The title is a label, not a control: clicks fall through to the globe. */
  pointer-events: none;
}

.app__title h1 {
  margin: 0;
  font-size: var(--font-size-title);
  font-weight: var(--font-weight-semibold);
  line-height: 1.25;
}

.app__title p {
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.app__status {
  position: absolute;
  top: var(--inset-top);
  right: var(--inset-right);
}

.app__debug {
  position: absolute;
  bottom: var(--inset-bottom);
  left: var(--inset-left);
}

.app__hint {
  position: absolute;
  bottom: var(--inset-bottom);
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
  white-space: nowrap;
  pointer-events: none;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--duration-slow) var(--ease-out);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
