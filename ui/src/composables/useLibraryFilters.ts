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

/** Browse layout of a model library: card grid or compact rows. */
export const VIEW_MODES = ['grid', 'list'] as const
export type ViewMode = (typeof VIEW_MODES)[number]

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && (VIEW_MODES as readonly string[]).includes(value)
}

/** Model libraries pass their LibraryConfig; the recipes page passes its own prefix and sorts. */
export function useLibraryFilters(config: Pick<LibraryConfig, 'sortOptions' | 'defaultSort'> & { prefix: string }) {
  const storageKey = `lm-ui.library.${config.prefix}`
  const stored = (() => {
    try {
      const value: unknown = JSON.parse(readStorage(storageKey) || '{}')
      return (value && typeof value === 'object' ? value : {}) as { sort?: unknown; cardSize?: unknown; view?: unknown }
    } catch {
      return {}
    }
  })()

  const sort = ref(
    typeof stored.sort === 'string' && config.sortOptions.some((option) => option.value === stored.sort)
      ? stored.sort
      : config.defaultSort,
  )
  const cardSize = ref(clampCardSize(typeof stored.cardSize === 'number' ? stored.cardSize : CARD_SIZE_DEFAULT))
  const view = ref<ViewMode>(isViewMode(stored.view) ? stored.view : 'grid')
  const state = reactive({
    /** Local (library-scoped) text search, sent as the list endpoint's `search`. */
    search: '',
    folder: '',
    baseModels: [] as string[],
    tags: [] as string[],
    favoritesOnly: false,
    updatesOnly: false,
  })

  watch([sort, cardSize, view], () => {
    writeStorage(storageKey, JSON.stringify({ sort: sort.value, cardSize: cardSize.value, view: view.value }))
  })

  function toggle(list: 'baseModels' | 'tags', value: string): void {
    const current = state[list]
    state[list] = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]
  }

  /** Adds a value if missing (drawer tag click); never removes. */
  function include(list: 'baseModels' | 'tags', value: string): void {
    if (!state[list].includes(value)) state[list] = [...state[list], value]
  }

  function clearList(list: 'baseModels' | 'tags'): void {
    state[list] = []
  }

  function clear(): void {
    state.search = ''
    state.folder = ''
    state.baseModels = []
    state.tags = []
    state.favoritesOnly = false
    state.updatesOnly = false
  }

  const chips = computed<FilterChip[]>(() => [
    ...(state.search
      ? [{ key: 'search', label: t('library.searchChip', { query: state.search }), remove: () => (state.search = '') }]
      : []),
    // Always shown, so a folder filter stays visible while the folder panel is hidden.
    ...(state.folder
      ? [{ key: 'folder', label: t('library.folderChip', { name: state.folder }), remove: () => (state.folder = '') }]
      : []),
    ...state.baseModels.map((value) => ({ key: `base:${value}`, label: value, remove: () => toggle('baseModels', value) })),
    ...state.tags.map((value) => ({ key: `tag:${value}`, label: `#${value}`, remove: () => toggle('tags', value) })),
    ...(state.favoritesOnly ? [{ key: 'fav', label: t('library.favoritesOnly'), remove: () => (state.favoritesOnly = false) }] : []),
    ...(state.updatesOnly ? [{ key: 'upd', label: t('library.updatesOnly'), remove: () => (state.updatesOnly = false) }] : []),
  ])

  /** Number of filters inside the filter panel (search and folder excluded). */
  const panelCount = computed(
    () => state.baseModels.length + state.tags.length + (state.favoritesOnly ? 1 : 0) + (state.updatesOnly ? 1 : 0),
  )

  /** Stable key that changes whenever the result set must be reloaded. */
  const signature = computed(() =>
    JSON.stringify([sort.value, state.search, state.folder, state.baseModels, state.tags, state.favoritesOnly, state.updatesOnly]),
  )

  return { sort, cardSize, view, state, toggle, include, clearList, clear, chips, panelCount, signature }
}
