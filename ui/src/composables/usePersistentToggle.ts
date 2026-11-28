/** A boolean UI preference (open/closed section) remembered in localStorage. */

import { readStorage } from '@/utils/storage'

export function parseToggle(raw: string | null, fallback: boolean): boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return fallback
}

export function readToggle(key: string, fallback: boolean): boolean {
  return parseToggle(readStorage(key), fallback)
}
