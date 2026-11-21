/** A boolean UI preference (open/closed section) remembered in localStorage. */

import { ref, watch, type Ref } from 'vue'
import { readStorage, writeStorage } from '@/utils/storage'

export function readToggle(key: string, fallback: boolean): boolean {
  const raw = readStorage(key)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return fallback
}

export function usePersistentToggle(key: string, fallback = false): Ref<boolean> {
  const value = ref(readToggle(key, fallback))
  watch(value, (next) => writeStorage(key, next ? 'true' : 'false'))
  return value
}
