<script setup lang="ts">
import { ref } from 'vue'
import GlobeCanvas from './components/GlobeCanvas.vue'

const showHint = ref(true)
</script>

<template>
  <main class="app">
    <GlobeCanvas @interact="showHint = false" />

    <header class="app__title glass">
      <h1>Satellite Tracker</h1>
      <p>Live orbital data on a 3D globe</p>
    </header>

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
