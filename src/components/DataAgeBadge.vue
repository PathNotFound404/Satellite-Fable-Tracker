<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatDataAge, isStale } from '../composables/dataAge'
import type { LoadStatus } from '../composables/useSatellites'

const props = defineProps<{
  status: LoadStatus
  /** UTC ISO timestamp of the pipeline fetch, or null until loaded. */
  generatedAt: string | null
  errorMessage: string
}>()

// The label only changes once a minute, so a slow timer is enough.
const REFRESH_INTERVAL_MS = 30_000
const nowMs = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => {
    nowMs.value = Date.now()
  }, REFRESH_INTERVAL_MS)
})
onBeforeUnmount(() => clearInterval(timer))

const ageMs = computed(() =>
  props.generatedAt === null ? null : nowMs.value - Date.parse(props.generatedAt),
)

const tone = computed<'ok' | 'warning' | 'error' | 'pending'>(() => {
  if (props.status === 'error') return 'error'
  if (ageMs.value === null) return 'pending'
  return isStale(ageMs.value) ? 'warning' : 'ok'
})

const label = computed(() => {
  if (props.status === 'error') return 'Satellite data unavailable'
  if (ageMs.value === null) return 'Loading satellite data'
  return formatDataAge(ageMs.value)
})

const detail = computed(() => {
  if (props.status === 'error') return props.errorMessage
  if (props.generatedAt === null) return ''
  const fetched = new Date(props.generatedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return tone.value === 'warning'
    ? `Fetched from CelesTrak on ${fetched}. This is older than expected, so positions may be noticeably off.`
    : `Fetched from CelesTrak on ${fetched}. Positions are approximate.`
})
</script>

<template>
  <p class="badge glass" :class="`badge--${tone}`" :title="detail" role="status">
    <span class="badge__dot" aria-hidden="true"></span>
    <span class="numeric">{{ label }}</span>
    <span v-if="detail" class="visually-hidden">. {{ detail }}</span>
  </p>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.badge__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
}

.badge--ok .badge__dot {
  background: var(--color-success);
}

.badge--warning .badge__dot {
  background: var(--color-warning);
}

.badge--warning,
.badge--error {
  color: var(--color-text);
}

.badge--error .badge__dot {
  background: var(--color-danger);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
