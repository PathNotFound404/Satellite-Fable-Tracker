<script setup lang="ts">
import type { FilterId, FilterOption } from '../composables/useFilters'

defineProps<{
  options: FilterOption[]
  modelValue: FilterId
}>()

defineEmits<{ 'update:modelValue': [value: FilterId] }>()

const countFormat = new Intl.NumberFormat()
</script>

<template>
  <!-- Native radios give arrow-key navigation and screen reader semantics for free. -->
  <fieldset class="filter glass">
    <legend class="visually-hidden">Show satellites</legend>
    <label
      v-for="option in options"
      :key="option.id"
      class="filter__option"
      :class="{ 'filter__option--active': option.id === modelValue }"
    >
      <input
        class="visually-hidden"
        type="radio"
        name="group-filter"
        :value="option.id"
        :checked="option.id === modelValue"
        @change="$emit('update:modelValue', option.id)"
      />
      <span class="filter__label">{{ option.label }}</span>
      <span class="filter__count numeric">{{ countFormat.format(option.count) }}</span>
    </label>
  </fieldset>
</template>

<style scoped>
.filter {
  display: flex;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  margin: 0;
  padding: 3px;
  border-radius: var(--radius-pill);
  overflow-x: auto;
  scrollbar-width: none;
}

.filter::-webkit-scrollbar {
  display: none;
}

.filter__option {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px var(--space-3);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.filter__option:hover {
  color: var(--color-text);
}

.filter__option--active {
  background: var(--surface-fill-active);
  color: var(--color-text);
}

.filter__option:focus-within {
  box-shadow: var(--focus-ring);
}

.filter__label {
  font-weight: var(--font-weight-medium);
}

.filter__count {
  color: var(--color-text-secondary);
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
