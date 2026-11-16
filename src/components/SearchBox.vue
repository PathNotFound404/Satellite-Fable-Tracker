<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface SearchResult {
  /** Catalog index. */
  index: number
  name: string
  noradId: number
}

const props = defineProps<{
  /** Returns the best matches for a query, best first. Called on every keystroke. */
  search: (query: string) => SearchResult[]
  disabled?: boolean
}>()

const emit = defineEmits<{ select: [index: number] }>()

const query = ref('')
const open = ref(false)
const activeIndex = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLUListElement | null>(null)

const results = computed(() => (query.value.trim() === '' ? [] : props.search(query.value)))
const showList = computed(() => open.value && query.value.trim() !== '')

watch(results, () => {
  activeIndex.value = 0
})

function choose(result: SearchResult | undefined): void {
  if (result === undefined) return
  emit('select', result.index)
  query.value = ''
  open.value = false
  input.value?.blur()
}

function move(step: number): void {
  if (results.value.length === 0) return
  open.value = true
  activeIndex.value = (activeIndex.value + step + results.value.length) % results.value.length
  void nextTick(() => {
    list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    choose(results.value[activeIndex.value])
  } else if (event.key === 'Escape') {
    // Escape belongs to the search field while it has something to dismiss, so it
    // doesn't also clear the selected satellite.
    if (query.value !== '' || open.value) event.stopPropagation()
    query.value = ''
    open.value = false
  }
}

// "/" focuses search from anywhere, as on many sites, unless the user is typing.
function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  event.preventDefault()
  input.value?.focus()
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))
</script>

<template>
  <div class="search" :class="{ 'search--open': showList }">
    <div class="search__field glass">
      <svg class="search__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="6.8" cy="6.8" r="4.8" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M10.5 10.5L14.2 14.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
      <input
        ref="input"
        v-model="query"
        type="text"
        inputmode="search"
        enterkeyhint="search"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="Search name or NORAD ID"
        role="combobox"
        aria-label="Search satellites by name or NORAD ID"
        aria-autocomplete="list"
        aria-controls="search-results"
        :aria-expanded="showList"
        :aria-activedescendant="showList && results.length > 0 ? `search-result-${activeIndex}` : undefined"
        :disabled="disabled"
        @focus="open = true"
        @input="open = true"
        @blur="open = false"
        @keydown="onKeydown"
      />
    </div>

    <ul
      v-show="showList"
      id="search-results"
      ref="list"
      class="search__results glass"
      role="listbox"
      aria-label="Matching satellites"
    >
      <li
        v-for="(result, i) in results"
        :id="`search-result-${i}`"
        :key="result.index"
        role="option"
        :aria-selected="i === activeIndex"
        class="search__result"
        @pointerdown.prevent
        @pointermove="activeIndex = i"
        @click="choose(result)"
      >
        <span class="search__name">{{ result.name }}</span>
        <span class="search__id numeric">{{ result.noradId }}</span>
      </li>
      <li v-if="results.length === 0" class="search__empty" role="presentation">No satellites found</li>
    </ul>
  </div>
</template>

<style scoped>
.search {
  position: relative;
  width: 300px;
  max-width: 100%;
}

.search__field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast) var(--ease-out);
}

.search__field:focus-within {
  border-color: var(--color-accent);
  box-shadow: var(--surface-shadow), var(--focus-ring);
}

.search__icon {
  flex: none;
  color: var(--color-text-secondary);
}

.search input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0;
  border: 0;
  background: transparent;
  outline: none;
  box-shadow: none;
  /* 16px stops iOS Safari zooming the page when the field is focused. */
  font-size: 16px;
}

.search input::placeholder {
  color: var(--color-text-secondary);
}

@media (min-width: 601px) {
  .search input {
    font-size: var(--font-size-body);
  }
}

.search__results {
  position: absolute;
  top: calc(100% + var(--space-2));
  left: 0;
  right: 0;
  z-index: 2;
  max-height: min(320px, 50vh);
  margin: 0;
  padding: var(--space-1);
  overflow-y: auto;
  list-style: none;
  border-radius: var(--radius-md);
  /* Stronger than the default glass: results sit over other panels. */
  background: var(--surface-fill-strong);
}

.search__result {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.search__result[aria-selected='true'] {
  background: var(--color-accent);
  color: var(--color-accent-contrast);
}

.search__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search__id {
  flex: none;
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.search__result[aria-selected='true'] .search__id {
  color: inherit;
  opacity: 0.85;
}

.search__empty {
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-secondary);
}
</style>
