<script setup lang="ts">
import { computed } from 'vue'
import { periodMinutes } from '../orbital/propagation'
import type { Telemetry } from '../orbital/orbitPath'
import type { OmmRecord } from '../types/satellite-data'

const props = defineProps<{
  record: OmmRecord
  /** Display names of the groups this satellite belongs to. */
  groups: string[]
  telemetry: Telemetry
  /** False if the satellite's position can't be computed right now. */
  telemetryAvailable: boolean
}>()

defineEmits<{ close: [] }>()

// GP accuracy is about a kilometre at best, so never show finer than that for
// distances, and no more than a tenth of a degree (about 11 km) for ground position.
const wholeNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const twoDecimals = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const oneDecimal = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const altitude = computed(() => wholeNumber.format(props.telemetry.altitudeKm))
const speed = computed(() => twoDecimals.format(props.telemetry.speedKmS))
const inclination = computed(() => oneDecimal.format(props.record.INCLINATION))
const period = computed(() => oneDecimal.format(periodMinutes(props.record.MEAN_MOTION)))

const latitude = computed(() => {
  const value = props.telemetry.latitudeDeg
  return `${oneDecimal.format(Math.abs(value))}° ${value >= 0 ? 'N' : 'S'}`
})
const longitude = computed(() => {
  const value = props.telemetry.longitudeDeg
  return `${oneDecimal.format(Math.abs(value))}° ${value >= 0 ? 'E' : 'W'}`
})

// OMM epochs carry no zone suffix; they are UTC by contract.
const epochDate = computed(() => new Date(`${props.record.EPOCH}Z`))
const epoch = computed(() =>
  epochDate.value.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }),
)
</script>

<template>
  <section class="panel glass" aria-label="Selected satellite">
    <header class="panel__header">
      <div class="panel__heading">
        <h2>{{ record.OBJECT_NAME }}</h2>
        <p class="numeric">NORAD {{ record.NORAD_CAT_ID }} · {{ record.OBJECT_ID }}</p>
      </div>
      <button class="panel__close" type="button" aria-label="Close" @click="$emit('close')">
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </header>

    <ul v-if="groups.length > 0" class="panel__groups">
      <li v-for="group in groups" :key="group">{{ group }}</li>
    </ul>

    <dl v-if="telemetryAvailable" class="panel__stats numeric" aria-live="off">
      <div>
        <dt>Altitude</dt>
        <dd>{{ altitude }} <span>km</span></dd>
      </div>
      <div>
        <dt>Speed</dt>
        <dd>{{ speed }} <span>km/s</span></dd>
      </div>
      <div>
        <dt>Latitude</dt>
        <dd>{{ latitude }}</dd>
      </div>
      <div>
        <dt>Longitude</dt>
        <dd>{{ longitude }}</dd>
      </div>
    </dl>
    <p v-else class="panel__unavailable" role="status">
      No current position. This object has probably re-entered or its data is too old.
    </p>

    <dl class="panel__stats numeric">
      <div>
        <dt>Inclination</dt>
        <dd>{{ inclination }}°</dd>
      </div>
      <div>
        <dt>Period</dt>
        <dd>{{ period }} <span>min</span></dd>
      </div>
    </dl>

    <p class="panel__epoch numeric">Orbit data from {{ epoch }} UTC. Positions are approximate.</p>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 300px;
  max-width: 100%;
  padding: var(--space-4);
}

.panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.panel__heading {
  min-width: 0;
}

.panel__heading h2 {
  margin: 0;
  font-size: var(--font-size-large);
  font-weight: var(--font-weight-semibold);
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.panel__heading p {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.panel__close {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--surface-fill-hover);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.panel__close:hover {
  background: var(--surface-fill-active);
  color: var(--color-text);
}

.panel__groups {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.panel__groups li {
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--surface-fill-hover);
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.panel__stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4) var(--space-3);
  margin: 0;
}

.panel__stats dt {
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.panel__stats dd {
  margin: 2px 0 0;
  font-size: var(--font-size-title);
  font-weight: var(--font-weight-medium);
}

.panel__stats dd span {
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-regular);
  color: var(--color-text-secondary);
}

.panel__unavailable,
.panel__epoch {
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.panel__epoch {
  padding-top: var(--space-3);
  border-top: 1px solid var(--surface-border);
}
</style>
