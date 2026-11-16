<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import DataAgeBadge from './components/DataAgeBadge.vue'
import DebugReadout from './components/DebugReadout.vue'
import GlobeCanvas from './components/GlobeCanvas.vue'
import InfoPanel from './components/InfoPanel.vue'
import { groupLabelsFor } from './composables/groups'
import { useSatelliteLayer } from './composables/useSatelliteLayer'
import { useSatellites } from './composables/useSatellites'
import { useSelection } from './composables/useSelection'
import { useSelectionVisuals } from './composables/useSelectionVisuals'
import { useTelemetry } from './composables/useTelemetry'
import { pickSatellite } from './three/picking'
import type { GlobeScene } from './three/scene'

const showHint = ref(true)
const { file, status, errorMessage } = useSatellites()

// Raw three.js scene handle: shallow and marked raw so Vue never proxies it.
const globeScene = shallowRef<GlobeScene | null>(null)
const { catalog, layer, trackedCount, stats } = useSatelliteLayer(globeScene, file)

const { selectedIndex, select, clear } = useSelection()
useSelectionVisuals(globeScene, catalog, layer, selectedIndex)
const { telemetry, available: telemetryAvailable } = useTelemetry(catalog, selectedIndex)

const selectedRecord = computed(() =>
  selectedIndex.value === null ? null : (catalog.value?.records[selectedIndex.value] ?? null),
)
const selectedGroups = computed(() =>
  selectedIndex.value === null || catalog.value === null
    ? []
    : groupLabelsFor(catalog.value, selectedIndex.value),
)

// Fingers are less precise than a mouse pointer.
const PICK_TOLERANCE_MOUSE_PX = 10
const PICK_TOLERANCE_TOUCH_PX = 22

function onPick(point: { x: number; y: number; width: number; height: number; isTouch: boolean }): void {
  const scene = globeScene.value
  if (scene === null || layer.value === null || catalog.value === null) return
  const index = pickSatellite(
    layer.value,
    catalog.value.count,
    scene.camera,
    point.width,
    point.height,
    point.x,
    point.y,
    point.isTouch ? PICK_TOLERANCE_TOUCH_PX : PICK_TOLERANCE_MOUSE_PX,
  )
  if (index === -1) clear()
  else select(index)
}

// Deep link: ?sat=25544 selects that NORAD ID once the data has loaded.
const linkedNoradId = Number(new URLSearchParams(window.location.search).get('sat'))
if (Number.isInteger(linkedNoradId) && linkedNoradId > 0) {
  const stop = watch(catalog, (loaded) => {
    if (loaded === null) return
    const index = loaded.indexByNoradId.get(linkedNoradId)
    if (index !== undefined) select(index)
    stop()
  })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') clear()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const countFormat = new Intl.NumberFormat()
const subtitle = computed(() =>
  trackedCount.value === null
    ? 'Live orbital data on a 3D globe'
    : `${countFormat.format(trackedCount.value)} satellites, live`,
)

// Opt-in performance readout: add ?debug to the URL.
const showDebug = new URLSearchParams(window.location.search).has('debug')
</script>

<template>
  <main class="app">
    <GlobeCanvas
      @ready="globeScene = markRaw($event)"
      @interact="showHint = false"
      @pick="onPick"
    />

    <div class="app__left">
      <header class="app__title glass">
        <h1>Satellite Tracker</h1>
        <p class="numeric">{{ subtitle }}</p>
      </header>

      <Transition name="panel">
        <InfoPanel
          v-if="selectedRecord"
          :record="selectedRecord"
          :groups="selectedGroups"
          :telemetry="telemetry"
          :telemetry-available="telemetryAvailable"
          @close="clear"
        />
      </Transition>
    </div>

    <div class="app__status">
      <DataAgeBadge
        :status="status"
        :generated-at="file?.generatedAt ?? null"
        :error-message="errorMessage"
      />
    </div>

    <DebugReadout v-if="showDebug" class="app__debug" :stats="stats" />

    <Transition name="fade">
      <p v-if="showHint && !selectedRecord" class="app__hint glass">
        Drag to rotate · Scroll to zoom · Click a satellite
      </p>
    </Transition>
  </main>
</template>

<style scoped>
.app {
  position: relative;
  height: 100%;
}

/* Overlay columns ignore the pointer so the globe stays draggable between panels;
   the panels themselves opt back in. */
.app__left {
  position: absolute;
  top: var(--inset-top);
  left: var(--inset-left);
  bottom: var(--inset-bottom);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  max-width: calc(100% - var(--inset-left) - var(--inset-right));
  pointer-events: none;
}

.app__left > * {
  pointer-events: auto;
}

.app__title {
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
  right: var(--inset-right);
  bottom: var(--inset-bottom);
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

.panel-enter-active,
.panel-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* Phones: the panel becomes a sheet along the bottom edge. */
@media (max-width: 600px) {
  .app__left {
    right: var(--inset-right);
    justify-content: space-between;
    align-items: stretch;
  }

  .app__title {
    align-self: flex-start;
  }

  .app__left :deep(.panel) {
    width: 100%;
  }

  .panel-enter-from,
  .panel-leave-to {
    transform: translateY(6px);
  }
}
</style>
