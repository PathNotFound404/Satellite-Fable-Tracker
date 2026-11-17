import { readonly, ref, shallowRef } from 'vue'
import type { Observer } from '../orbital/passes'

/**
 * Where the user is, for pass prediction.
 *
 * Privacy: the location is held in memory only. It is never sent anywhere and never
 * written to storage, so it is gone when the page closes. The device is only asked
 * when the user presses the button, never on load.
 */
export type LocationStatus = 'idle' | 'locating' | 'denied' | 'unavailable'

// Module-level: one location for the whole app, kept while the selection changes.
const location = shallowRef<Observer | null>(null)
const status = ref<LocationStatus>('idle')

const GEOLOCATION_TIMEOUT_MS = 15_000

function requestDeviceLocation(): void {
  if (!('geolocation' in navigator)) {
    status.value = 'unavailable'
    return
  }
  status.value = 'locating'
  navigator.geolocation.getCurrentPosition(
    (position) => {
      location.value = {
        latitudeDeg: position.coords.latitude,
        longitudeDeg: position.coords.longitude,
      }
      status.value = 'idle'
    },
    (error) => {
      status.value = error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'
    },
    // City-level accuracy is plenty: 10 km moves a pass by about a second.
    { enableHighAccuracy: false, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 10 * 60 * 1000 },
  )
}

export function useObserverLocation() {
  return {
    location: readonly(location),
    status: readonly(status),
    requestDeviceLocation,
    setLocation(observer: Observer) {
      location.value = observer
      status.value = 'idle'
    },
    clearLocation() {
      location.value = null
      status.value = 'idle'
    },
  }
}
