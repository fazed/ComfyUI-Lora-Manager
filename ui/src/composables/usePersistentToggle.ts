/** A boolean UI preference (open/closed section) remembered in localStorage. */

import type { Ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { readStorage } from '@/utils/storage'

export function parseToggle(raw: string | null, fallback: boolean): boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return fallback
}

export function readToggle(key: string, fallback: boolean): boolean {
  return parseToggle(readStorage(key), fallback)
}

/**
 * VueUse storage ref: writes 'true'/'false' on change only (no default written),
 * unknown values fall back, blocked storage is ignored (the value lives in memory).
 */
export function usePersistentToggle(key: string, fallback = false): Ref<boolean> {
  return useLocalStorage<boolean>(key, fallback, {
    writeDefaults: false,
    serializer: { read: (raw) => parseToggle(raw, fallback), write: (value) => (value ? 'true' : 'false') },
    onError: () => undefined,
  })
}
