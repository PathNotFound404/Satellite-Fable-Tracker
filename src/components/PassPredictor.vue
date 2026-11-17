<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatObserver, parseCoordinates } from '../composables/observerLocation'
import { describePass } from '../composables/passFormat'
import type { LocationStatus } from '../composables/useObserverLocation'
import type { Observer, Pass } from '../orbital/passes'

const props = defineProps<{
  location: Observer | null
  status: LocationStatus
  /** Null while there is nothing to list (no location, or no position for the satellite). */
  passes: readonly Pass[] | null
}>()

const emit = defineEmits<{
  'use-device': []
  'set-location': [observer: Observer]
  'clear-location': []
}>()

const latitudeText = ref('')
const longitudeText = ref('')
const formError = ref('')
const showForm = ref(false)

// Asking the device failed, so typing is the only way left: open the form unasked.
const formOpen = computed(() => showForm.value || props.status === 'denied' || props.status === 'unavailable')

const statusText = computed(() => {
  if (props.status === 'locating') return 'Finding your location…'
  if (props.status === 'denied') return 'Location permission was denied. Enter coordinates instead.'
  if (props.status === 'unavailable') return 'Your location could not be found. Enter coordinates instead.'
  return ''
})

function submit(): void {
  const result = parseCoordinates(latitudeText.value, longitudeText.value)
  if (typeof result === 'string') {
    formError.value = result
    return
  }
  formError.value = ''
  showForm.value = false
  emit('set-location', result)
}

const where = computed(() => (props.location === null ? '' : formatObserver(props.location)))
/** A week of a low orbit is dozens of passes; show the soonest and offer the rest. */
const COLLAPSED_COUNT = 5
const showAll = ref(false)
const labels = computed(() => (props.passes ?? []).map((pass) => ({ key: pass.riseMs, ...describePass(pass) })))
const shownLabels = computed(() => (showAll.value ? labels.value : labels.value.slice(0, COLLAPSED_COUNT)))
</script>

<template>
  <section class="passes" aria-label="Passes over you">
    <h3>Passes over you</h3>

    <template v-if="location === null">
      <p class="passes__note">See when this satellite is above your horizon in the next 7 days.</p>

      <div class="passes__actions">
        <button
          class="passes__button passes__button--primary"
          type="button"
          :disabled="status === 'locating'"
          @click="$emit('use-device')"
        >
          Use my location
        </button>
        <button
          v-if="!formOpen"
          class="passes__button"
          type="button"
          @click="showForm = true"
        >
          Enter coordinates
        </button>
      </div>

      <p v-if="statusText" class="passes__note" role="status">{{ statusText }}</p>

      <form v-if="formOpen" class="passes__form" novalidate @submit.prevent="submit">
        <label>
          <span>Latitude</span>
          <input v-model="latitudeText" type="text" inputmode="text" placeholder="51.48" autocomplete="off" />
        </label>
        <label>
          <span>Longitude</span>
          <input v-model="longitudeText" type="text" inputmode="text" placeholder="-0.13" autocomplete="off" />
        </label>
        <button class="passes__button" type="submit">Show passes</button>
        <p v-if="formError" class="passes__error" role="alert">{{ formError }}</p>
        <p v-else class="passes__note passes__form-hint">Decimal degrees. South and west are negative.</p>
      </form>

      <p class="passes__note">Your location stays in this browser and is not saved.</p>
    </template>

    <template v-else>
      <p class="passes__where numeric">
        <span>{{ where }}</span>
        <button class="passes__link" type="button" @click="$emit('clear-location')">Change</button>
      </p>

      <ol v-if="labels.length > 0" class="passes__list numeric">
        <li v-for="label in shownLabels" :key="label.key" :class="{ 'passes__item--now': label.now }">
          <span>{{ label.when }}</span>
          <span class="passes__peak">Peak {{ label.peakDeg }}°</span>
        </li>
      </ol>
      <button
        v-if="labels.length > COLLAPSED_COUNT"
        class="passes__link passes__more"
        type="button"
        :aria-expanded="showAll"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Show fewer' : `Show all ${labels.length}` }}
      </button>
      <p v-else-if="passes !== null" class="passes__note">
        No passes higher than 10° in the next 7 days.
      </p>
      <p v-else class="passes__note">No passes to show: this satellite has no current position.</p>

      <p class="passes__note">
        Next 7 days, in your local time. Times several days ahead can be off by minutes. Above the
        horizon does not always mean visible to the eye. Your location stays in this browser and is
        not saved.
      </p>
    </template>
  </section>
</template>

<style scoped>
.passes {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--surface-border);
}

.passes h3 {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
}

.passes__note,
.passes__error {
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.passes__error {
  color: var(--color-danger);
}

.passes__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.passes__button {
  padding: 6px var(--space-3);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-fill-active);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.passes__button:hover {
  background: var(--surface-fill-hover);
}

.passes__button--primary,
.passes__button--primary:hover {
  background: var(--color-accent);
  color: var(--color-accent-contrast);
}

.passes__button:disabled {
  opacity: 0.5;
  cursor: default;
}

.passes__form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2) var(--space-3);
  align-items: end;
}

.passes__form label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.passes__form input {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 var(--space-2);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--surface-fill-hover);
  color: var(--color-text);
  /* 16px stops iOS Safari zooming the page when the field is focused. */
  font-size: 16px;
}

.passes__form input::placeholder {
  color: var(--color-text-tertiary);
}

.passes__form .passes__button {
  justify-self: start;
}

.passes__form .passes__error,
.passes__form-hint {
  grid-column: 1 / -1;
}

@media (min-width: 601px) {
  .passes__form input {
    font-size: var(--font-size-body);
  }
}

.passes__where {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.passes__link {
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-accent);
  font-size: var(--font-size-caption);
  cursor: pointer;
}

.passes__more {
  align-self: flex-start;
}

.passes__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.passes__list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.passes__peak {
  flex: none;
  color: var(--color-text-secondary);
}

.passes__item--now {
  color: var(--color-success);
}
</style>
