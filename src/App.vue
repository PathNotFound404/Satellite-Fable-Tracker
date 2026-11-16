<script setup lang="ts">
import { computed, ref } from 'vue'
import DataAgeBadge from './components/DataAgeBadge.vue'
import GlobeCanvas from './components/GlobeCanvas.vue'
import { useSatellites } from './composables/useSatellites'

const showHint = ref(true)
const { file, status, errorMessage } = useSatellites()

const countFormat = new Intl.NumberFormat()
const subtitle = computed(() =>
  file.value === null
    ? 'Live orbital data on a 3D globe'
    : `${countFormat.format(file.value.count)} satellites`,
)
</script>

<template>
  <main class="app">
    <GlobeCanvas @interact="showHint = false" />

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
