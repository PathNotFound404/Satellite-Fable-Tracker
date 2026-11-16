<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

/** Shown only with ?debug in the URL. Polls plain numbers the render loop maintains. */
const props = defineProps<{
  stats: { fps: number; updateMs: number; invalid: number; unreadable: number }
}>()

const POLL_INTERVAL_MS = 500
const shown = reactive({ fps: '0', updateMs: '0.00', invalid: 0, unreadable: 0 })
let timer: ReturnType<typeof setInterval> | undefined

function poll(): void {
  shown.fps = props.stats.fps.toFixed(0)
  shown.updateMs = props.stats.updateMs.toFixed(2)
  shown.invalid = props.stats.invalid
  shown.unreadable = props.stats.unreadable
}

onMounted(() => {
  poll()
  timer = setInterval(poll, POLL_INTERVAL_MS)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <dl class="debug glass numeric" data-testid="debug-readout">
    <div><dt>Frame rate</dt><dd>{{ shown.fps }} fps</dd></div>
    <div><dt>Propagation</dt><dd>{{ shown.updateMs }} ms/frame</dd></div>
    <div><dt>Hidden (decayed or invalid)</dt><dd>{{ shown.invalid }}</dd></div>
    <div><dt>Unreadable records</dt><dd>{{ shown.unreadable }}</dd></div>
  </dl>
</template>

<style scoped>
.debug {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-caption);
  pointer-events: none;
}

.debug div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-6);
}

.debug dt {
  color: var(--color-text-secondary);
}

.debug dd {
  margin: 0;
}
</style>
