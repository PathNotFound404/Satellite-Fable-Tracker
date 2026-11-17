<script setup lang="ts">
import { Vector3 } from 'three'
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import CloseApproaches from './components/CloseApproaches.vue'
import DataAgeBadge from './components/DataAgeBadge.vue'
import DebugReadout from './components/DebugReadout.vue'
import GlobeCanvas from './components/GlobeCanvas.vue'
import GroupFilter from './components/GroupFilter.vue'
import InfoPanel from './components/InfoPanel.vue'
import PassPredictor from './components/PassPredictor.vue'
import SearchBox, { type SearchResult } from './components/SearchBox.vue'
import TimeControls from './components/TimeControls.vue'
import { groupLabelsFor } from './composables/groups'
import { buildSearchIndex, searchCatalog } from './composables/search'
import { CONJUNCTION_THRESHOLD_KM, useConjunctions, type ApproachRow } from './composables/useConjunctions'
import { useFilters } from './composables/useFilters'
import { useObserverLocation } from './composables/useObserverLocation'
import { usePasses } from './composables/usePasses'
import { useSatelliteLayer } from './composables/useSatelliteLayer'
import { useSatellites } from './composables/useSatellites'
import { useSelection } from './composables/useSelection'
import { useSelectionVisuals } from './composables/useSelectionVisuals'
import { useStationLayer } from './composables/useStationLayer'
import { useSunlight } from './composables/useSunlight'
import { useTelemetry } from './composables/useTelemetry'
import { useTimeControls } from './composables/useTimeControls'
import { pickSatellite } from './three/picking'
import type { GlobeScene } from './three/scene'

const showHint = ref(true)
const { file, status, errorMessage } = useSatellites()

// Raw three.js scene handle: shallow and marked raw so Vue never proxies it.
const globeScene = shallowRef<GlobeScene | null>(null)
const { catalog, layer, trackedCount, stats } = useSatelliteLayer(globeScene, file)
useSunlight(globeScene)
const { representativeOf: stationRepresentativeOf } = useStationLayer(globeScene, catalog, layer)

const { selectedIndex, select, clear } = useSelection()
useSelectionVisuals(globeScene, catalog, layer, selectedIndex)
const { telemetry, available: telemetryAvailable } = useTelemetry(catalog, selectedIndex)

const {
  location: observerLocation,
  status: locationStatus,
  requestDeviceLocation,
  setLocation,
  clearLocation,
} = useObserverLocation()
const { passes: upcomingPasses } = usePasses(catalog, selectedIndex, observerLocation)

const { activeFilter, options: filterOptions, passes, setFilter } = useFilters(catalog, layer, trackedCount)

const generatedAt = computed(() => file.value?.generatedAt ?? null)
const timeControls = useTimeControls(generatedAt)

const conjunctions = useConjunctions(globeScene, catalog, layer, selectedIndex)

/** How long before the closest moment to drop the viewer, so they can watch it happen. */
const APPROACH_LEAD_MS = 10_000

function showApproach(approach: ApproachRow): void {
  conjunctions.highlight(approach.index)
  timeControls.jumpTo(approach.timeMs - APPROACH_LEAD_MS)
}

const selectedRecord = computed(() =>
  selectedIndex.value === null ? null : (catalog.value?.records[selectedIndex.value] ?? null),
)
const selectedGroups = computed(() =>
  selectedIndex.value === null || catalog.value === null
    ? []
    : groupLabelsFor(catalog.value, selectedIndex.value),
)

// A satellite hidden by the filter can't stay selected: its marker would have no point.
watch(activeFilter, () => {
  if (selectedIndex.value !== null && !passes(selectedIndex.value)) clear()
})

// --- Picking -----------------------------------------------------------------------

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
  // A station is a dozen catalog entries in one spot; a click on it selects its core module.
  else select(stationRepresentativeOf(index))
}

// --- Search ------------------------------------------------------------------------

const MAX_SEARCH_RESULTS = 50
const searchIndex = computed(() => (catalog.value === null ? null : buildSearchIndex(catalog.value)))

function search(query: string): SearchResult[] {
  const loaded = catalog.value
  const shownLayer = layer.value
  if (loaded === null || shownLayer === null || searchIndex.value === null) return []
  // Decayed or invalid satellites have no position to show, so they aren't offered.
  return searchCatalog(searchIndex.value, query, MAX_SEARCH_RESULTS, shownLayer.isValid).map(
    (index) => ({
      index,
      name: loaded.records[index]!.OBJECT_NAME,
      noradId: loaded.records[index]!.NORAD_CAT_ID,
    }),
  )
}

const focusPosition = new Vector3()

/** Select a satellite that may be off screen: make sure it is shown, then fly to it. */
async function selectAndFocus(index: number): Promise<void> {
  if (!passes(index)) {
    setFilter('all')
    // Let the filter reach the layer before asking it where the satellite is.
    await nextTick()
  }
  select(index)
  if (layer.value?.getScenePosition(index, focusPosition)) globeScene.value?.flyTo(focusPosition)
}

// Deep link: ?sat=25544 selects that NORAD ID once the data has loaded.
const linkedNoradId = Number(new URLSearchParams(window.location.search).get('sat'))
if (Number.isInteger(linkedNoradId) && linkedNoradId > 0) {
  const stop = watch(layer, (shownLayer) => {
    if (shownLayer === null || catalog.value === null) return
    const index = catalog.value.indexByNoradId.get(linkedNoradId)
    if (index !== undefined) void selectAndFocus(index)
    stop()
  })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    clear()
    return
  }
  // Space toggles pause, unless it belongs to a field or control that has focus.
  if (event.key === ' ' && !event.repeat) {
    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') return
    event.preventDefault()
    timeControls.togglePause()
  }
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

      <SearchBox :search="search" :disabled="catalog === null" @select="selectAndFocus" />

      <Transition name="panel">
        <InfoPanel
          v-if="selectedRecord"
          class="app__panel"
          :record="selectedRecord"
          :groups="selectedGroups"
          :telemetry="telemetry"
          :telemetry-available="telemetryAvailable"
          @close="clear"
        >
          <PassPredictor
            :location="observerLocation"
            :status="locationStatus"
            :passes="upcomingPasses"
            @use-device="requestDeviceLocation"
            @set-location="setLocation"
            @clear-location="clearLocation"
          />
          <CloseApproaches
            :status="conjunctions.status.value"
            :progress="conjunctions.progress.value"
            :approaches="conjunctions.approaches.value"
            :highlighted-index="conjunctions.highlightedIndex.value"
            :threshold-km="CONJUNCTION_THRESHOLD_KM"
            @scan="conjunctions.start"
            @show="showApproach"
          />
        </InfoPanel>
      </Transition>
    </div>

    <div class="app__filter">
      <GroupFilter
        v-if="catalog !== null"
        :options="filterOptions"
        :model-value="activeFilter"
        @update:model-value="setFilter"
      />
    </div>

    <div class="app__status">
      <DataAgeBadge
        :status="status"
        :generated-at="file?.generatedAt ?? null"
        :error-message="errorMessage"
      />
    </div>

    <div class="app__time">
      <TimeControls
        :time-ms="timeControls.simTimeMs.value"
        :live="timeControls.live.value"
        :paused="timeControls.paused.value"
        :speed="timeControls.speed.value"
        :reversed="timeControls.reversed.value"
        :notice="timeControls.notice.value"
        @toggle-pause="timeControls.togglePause"
        @toggle-reverse="timeControls.toggleReverse"
        @set-speed="timeControls.setSpeed"
        @go-live="timeControls.goLive"
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
  /* Room the time bar takes along the bottom edge; other bottom-anchored things sit
     above it. */
  --time-bar-space: 56px;
  --above-time-bar: calc(var(--inset-bottom) + var(--time-bar-space));
}

/* Overlay containers ignore the pointer so the globe stays draggable between panels;
   the panels themselves opt back in. */
.app__left {
  position: absolute;
  top: var(--inset-top);
  left: var(--inset-left);
  bottom: var(--above-time-bar);
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

.app__panel {
  /* If the window is short, the panel scrolls instead of running off screen. */
  min-height: 0;
  overflow-y: auto;
}

.app__filter {
  position: absolute;
  top: var(--inset-top);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  justify-content: center;
  max-width: calc(100% - var(--inset-left) - var(--inset-right));
}

.app__status {
  position: absolute;
  top: var(--inset-top);
  right: var(--inset-right);
}

.app__time {
  position: absolute;
  bottom: var(--inset-bottom);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  justify-content: center;
  width: max-content;
  max-width: calc(100% - var(--inset-left) - var(--inset-right));
}

.app__debug {
  position: absolute;
  right: var(--inset-right);
  bottom: var(--above-time-bar);
}

.app__hint {
  position: absolute;
  bottom: var(--above-time-bar);
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

/* Not enough width for a centred filter between the side columns: move it to the
   bottom edge, and lift the hint above it. */
@media (max-width: 1080px) {
  .app__filter {
    top: auto;
    bottom: var(--above-time-bar);
  }

  .app__hint,
  .app__debug,
  .app__left {
    bottom: calc(var(--above-time-bar) + 48px);
  }
}

/* Phones: full-width search, and the panel becomes a sheet above the filter. */
@media (max-width: 600px) {
  /* The time bar wraps onto two rows. */
  .app {
    --time-bar-space: 92px;
  }

  /* Too many things along the bottom edge already. */
  .app__hint {
    display: none;
  }

  .app__left {
    right: var(--inset-right);
    align-items: stretch;
  }

  .app__title {
    align-self: flex-start;
  }

  .app__left :deep(.search),
  .app__left :deep(.panel) {
    width: 100%;
  }

  .app__panel {
    margin-top: auto;
  }

  .panel-enter-from,
  .panel-leave-to {
    transform: translateY(6px);
  }

  /* The title and the data badge share the top row; keep the badge compact. */
  .app__status {
    max-width: 55%;
  }
}
</style>
