/** Cached backend settings (GET /api/lm/settings), shared app-wide. */

import { ref } from 'vue'
import { settingsApi } from '@/api/endpoints'
import type { SettingsMap } from '@/api/types'

const settings = ref<SettingsMap | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
let pending: Promise<SettingsMap | null> | null = null

async function load(force = false): Promise<SettingsMap | null> {
  if (settings.value && !force) return settings.value
  if (pending && !force) return pending
  loading.value = true
  error.value = null
  pending = settingsApi
    .get()
    .then((value) => {
      settings.value = value
      return value
    })
    .catch((err: Error) => {
      error.value = err.message
      return null
    })
    .finally(() => {
      loading.value = false
      pending = null
    })
  return pending
}

export function useAppSettings() {
  return {
    settings,
    error,
    loading,
    load,
    /** Merge saved values into the cache without a reload. */
    patch(changes: SettingsMap) {
      settings.value = { ...(settings.value ?? {}), ...changes }
    },
  }
}
