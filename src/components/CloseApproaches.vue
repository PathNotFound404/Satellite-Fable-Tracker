<script setup lang="ts">
import { computed } from 'vue'
import { describeApproach } from '../composables/approachFormat'
import type { ApproachRow, ConjunctionStatus } from '../composables/useConjunctions'

const props = defineProps<{
  status: ConjunctionStatus
  /** 0 to 1 while scanning. */
  progress: number
  approaches: readonly ApproachRow[]
  /** Catalog index of the satellite currently marked on the globe, or null. */
  highlightedIndex: number | null
  /** Approaches closer than this are listed, km. */
  thresholdKm: number
}>()

defineEmits<{
  scan: []
  /** Mark the other satellite and move time to just before the approach. */
  show: [approach: ApproachRow]
}>()

const percent = computed(() => Math.round(props.progress * 100))
const rows = computed(() =>
  props.approaches.map((approach) => ({
    approach,
    key: `${approach.index}:${approach.timeMs}`,
    ...describeApproach(approach),
  })),
)
</script>

<template>
  <section class="approaches" aria-label="Close approaches">
    <h3>Close approaches</h3>

    <template v-if="status === 'idle'">
      <p class="approaches__note">
        Find satellites that pass within {{ thresholdKm }} km of this one in the next 24 hours.
      </p>
      <button class="approaches__button" type="button" @click="$emit('scan')">Scan</button>
    </template>

    <template v-else-if="status === 'scanning'">
      <p class="approaches__note numeric" role="status">Scanning the catalog… {{ percent }}%</p>
      <div
        class="approaches__bar"
        role="progressbar"
        aria-label="Scan progress"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="percent"
      >
        <span :style="{ width: `${percent}%` }"></span>
      </div>
    </template>

    <template v-else>
      <ol v-if="rows.length > 0" class="approaches__list">
        <li v-for="row in rows" :key="row.key">
          <button
            class="approaches__row"
            :class="{ 'approaches__row--on': row.approach.index === highlightedIndex }"
            type="button"
            :aria-pressed="row.approach.index === highlightedIndex"
            :title="`Go to this moment and mark ${row.approach.name}`"
            @click="$emit('show', row.approach)"
          >
            <span class="approaches__name">{{ row.approach.name }}</span>
            <span class="approaches__distance numeric">{{ row.distance }}</span>
            <span class="approaches__meta numeric">{{ row.when }} · {{ row.speed }}</span>
          </button>
        </li>
      </ol>
      <p v-else class="approaches__note">Nothing within {{ thresholdKm }} km in the next 24 hours.</p>

      <p v-if="rows.length > 0" class="approaches__note">
        Select one to go to that moment. The other satellite is ringed in orange.
      </p>
      <button class="approaches__link" type="button" @click="$emit('scan')">Scan again from now</button>
    </template>

    <p class="approaches__note approaches__caution">
      Approximate. Public orbit data is off by a kilometre or more, so this cannot be used to judge
      a real collision risk. Docked and formation-flying objects are left out.
    </p>
  </section>
</template>

<style scoped>
.approaches {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--surface-border);
}

.approaches h3 {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
}

.approaches__note {
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.approaches__caution {
  color: var(--color-text-tertiary);
}

.approaches__button {
  align-self: flex-start;
  padding: 6px var(--space-3);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-fill-active);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.approaches__button:hover {
  background: var(--surface-fill-hover);
}

.approaches__link {
  align-self: flex-start;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-accent);
  font-size: var(--font-size-caption);
  cursor: pointer;
}

.approaches__bar {
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--surface-fill-hover);
  overflow: hidden;
}

.approaches__bar span {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
}

.approaches__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0 calc(-1 * var(--space-2));
  padding: 0;
  list-style: none;
}

.approaches__row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0 var(--space-3);
  width: 100%;
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.approaches__row:hover {
  background: var(--surface-fill-hover);
}

.approaches__row--on {
  background: var(--surface-fill-active);
}

.approaches__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.approaches__row--on .approaches__distance {
  color: var(--color-warning);
}

.approaches__meta {
  grid-column: 1 / -1;
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}
</style>
