<script setup lang="ts">
import { computed } from 'vue'
import { formatSimTime, SPEEDS, type Speed, type TimeNotice } from '../composables/timeLimits'

const props = defineProps<{
  /** Simulation time, Unix milliseconds. */
  timeMs: number
  /** True when simulation time is the present, running at 1x. */
  live: boolean
  paused: boolean
  speed: Speed
  reversed: boolean
  notice: TimeNotice
}>()

defineEmits<{
  'toggle-pause': []
  'toggle-reverse': []
  'set-speed': [speed: Speed]
  'go-live': []
}>()

const time = computed(() => formatSimTime(props.timeMs))

const noticeText = computed(() => {
  if (props.notice === 'limit') return 'This is as far as the current data goes.'
  if (props.notice === 'rough') return 'Positions this far from the data date are rough.'
  return ''
})
</script>

<template>
  <section class="time glass" aria-label="Time controls">
    <div class="time__row">
      <div class="time__clock">
        <span class="time__value numeric" aria-live="off">{{ time }}</span>
        <span v-if="live" class="time__live"><span class="time__dot" aria-hidden="true"></span>Live</span>
        <button v-else class="time__now" type="button" @click="$emit('go-live')">Back to now</button>
      </div>

      <div class="time__buttons">
        <button
          class="time__icon"
          :class="{ 'time__icon--on': reversed }"
          type="button"
          :aria-pressed="reversed"
          aria-label="Run time backwards"
          title="Run time backwards"
          @click="$emit('toggle-reverse')"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M7.5 3.2v9.6L1.5 8zM14.5 3.2v9.6L8.5 8z" fill="currentColor" />
          </svg>
        </button>

        <button
          class="time__icon"
          type="button"
          :aria-label="paused ? 'Play' : 'Pause'"
          :title="paused ? 'Play (Space)' : 'Pause (Space)'"
          @click="$emit('toggle-pause')"
        >
          <svg v-if="paused" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 2.5v11l9.5-5.5z" fill="currentColor" />
          </svg>
          <svg v-else viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor" />
          </svg>
        </button>

        <fieldset class="time__speeds">
          <legend class="visually-hidden">Speed</legend>
          <label
            v-for="option in SPEEDS"
            :key="option"
            class="time__speed numeric"
            :class="{ 'time__speed--active': option === speed }"
          >
            <input
              class="visually-hidden"
              type="radio"
              name="time-speed"
              :value="option"
              :checked="option === speed"
              @change="$emit('set-speed', option)"
            />
            {{ option }}x
          </label>
        </fieldset>
      </div>
    </div>

    <p v-if="noticeText" class="time__notice" role="status">{{ noticeText }}</p>
  </section>
</template>

<style scoped>
.time {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-width: 100%;
  padding: 6px var(--space-3);
  border-radius: var(--radius-lg);
}

.time__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-2) var(--space-4);
}

.time__clock,
.time__buttons {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.time__value {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}

.time__live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px var(--space-2);
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.time__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success);
}

.time__now {
  padding: 3px var(--space-3);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  color: var(--color-accent-contrast);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
}

.time__icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--surface-fill-hover);
  color: var(--color-text);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.time__icon:hover {
  background: var(--surface-fill-active);
}

.time__icon--on {
  background: var(--color-accent);
  color: var(--color-accent-contrast);
}

.time__icon--on:hover {
  background: var(--color-accent);
}

.time__speeds {
  display: flex;
  gap: 2px;
  margin: 0;
  padding: 2px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-fill-hover);
}

.time__speed {
  padding: 4px var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  cursor: pointer;
  user-select: none;
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.time__speed:hover {
  color: var(--color-text);
}

.time__speed--active {
  background: var(--surface-fill-active);
  color: var(--color-text);
}

.time__speed:focus-within {
  box-shadow: var(--focus-ring);
}

.time__notice {
  margin: 0;
  padding-bottom: 2px;
  font-size: var(--font-size-caption);
  color: var(--color-warning);
  text-align: center;
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
