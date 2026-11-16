import { readonly, ref } from 'vue'

// Module-level: one selection for the whole app. The value is a catalog index (not a
// NORAD ID) because that is what the point cloud, picking and filters share.
const selectedIndex = ref<number | null>(null)

export function useSelection() {
  return {
    selectedIndex: readonly(selectedIndex),
    select(index: number) {
      selectedIndex.value = index
    },
    clear() {
      selectedIndex.value = null
    },
  }
}
