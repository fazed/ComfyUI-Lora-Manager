/**
 * Filter/sort state for one library page, with active-filter chips and
 * per-library persistence of sort + card size.
 */

import { computed, reactive, ref, watch } from 'vue'
import type { LibraryConfig } from '@/config/libraries'
import { readStorage, writeStorage } from '@/utils/storage'
import { t } from '@/i18n'

export interface FilterChip {
  key: string
  label: string
  remove: () => void
}

export const CARD_SIZE_MIN = 140
export const CARD_SIZE_MAX = 360
export const CARD_SIZE_DEFAULT = 210

export function clampCardSize(value: number): number {
  if (!Number.isFinite(value)) return CARD_SIZE_DEFAULT
  return Math.min(CARD_SIZE_MAX, Math.max(CARD_SIZE_MIN, Math.round(value)))
}

export function useLibraryFilters(config: LibraryConfig) {
  const storageKey = `lm-ui.library.${config.prefix}`
  const stored = (() => {
    try {
      return JSON.parse(readStorage(storageKey) || '{}') as { sort?: string; cardSize?: number }
    } catch {
      return {}
    }
  })()

  const sort = ref(
    stored.sort && config.sortOptions.some((option) => option.value === stored.sort) ? stored.sort : config.defaultSort,
  )
  const cardSize = ref(clampCardSize(stored.cardSize ?? CARD_SIZE_DEFAULT))
  const state = reactive({
    folder: '',
    baseModels: [] as string[],
    tags: [] as string[],
    favoritesOnly: false,
    updatesOnly: false,
  })

  watch([sort, cardSize], () => {
    writeStorage(storageKey, JSON.stringify({ sort: sort.value, cardSize: cardSize.value }))
  })

  function toggle(list: 'baseModels' | 'tags', value: string): void {
    const current = state[list]
    state[list] = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]
  }

  function clear(): void {
    state.folder = ''
    state.baseModels = []
    state.tags = []
    state.favoritesOnly = false
    state.updatesOnly = false
  }

  const chips = computed<FilterChip[]>(() => [
    ...(state.folder ? [{ key: 'folder', label: state.folder, remove: () => (state.folder = '') }] : []),
    ...state.baseModels.map((value) => ({ key: `base:${value}`, label: value, remove: () => toggle('baseModels', value) })),
    ...state.tags.map((value) => ({ key: `tag:${value}`, label: `#${value}`, remove: () => toggle('tags', value) })),
    ...(state.favoritesOnly ? [{ key: 'fav', label: t('library.favoritesOnly'), remove: () => (state.favoritesOnly = false) }] : []),
    ...(state.updatesOnly ? [{ key: 'upd', label: t('library.updatesOnly'), remove: () => (state.updatesOnly = false) }] : []),
  ])

  /** Number of filters inside the filter panel (folder excluded). */
  const panelCount = computed(
    () => state.baseModels.length + state.tags.length + (state.favoritesOnly ? 1 : 0) + (state.updatesOnly ? 1 : 0),
  )

  /** Stable key that changes whenever the result set must be reloaded. */
  const signature = computed(() =>
    JSON.stringify([sort.value, state.folder, state.baseModels, state.tags, state.favoritesOnly, state.updatesOnly]),
  )

  return { sort, cardSize, state, toggle, clear, chips, panelCount, signature }
}
