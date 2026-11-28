/**
 * Filter/sort state for one library page, with active-filter chips, filter
 * presets and per-library persistence (`lm-ui.library.<prefix>`: sort, card
 * size, layout, card shape, image fit, "show on cards", search-in fields,
 * "include subfolders", the base-model row;
 * `lm-ui.fpresets.<prefix>`: saved filter presets). Every stored value is
 * validated on read.
 */

import { computed, reactive, ref, watch } from 'vue'
import { DEFAULT_SEARCH_IN, SEARCH_FIELDS, type ModelListQuery, type SearchIn } from '@/api/endpoints'
import type { LibraryConfig } from '@/config/libraries'
import type { BrowseViewState } from '@/utils/browse'
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

/** Card image shape and fit (View popover). "Original" (masonry) is not offered: the virtual grid has uniform rows (D5). */
export const CARD_SHAPES = ['portrait', 'square'] as const
export type CardShape = (typeof CARD_SHAPES)[number]
export const CARD_FITS = ['cover', 'contain'] as const
export type CardFit = (typeof CARD_FITS)[number]

/** What the model cards show besides the image ("Show on cards" in the View popover). */
export const CARD_SHOW_FIELDS = ['name', 'baseModel', 'meta', 'favorite', 'versionRow', 'tags'] as const
export type CardShow = Record<(typeof CARD_SHOW_FIELDS)[number], boolean>
export const DEFAULT_CARD_SHOW: CardShow = { name: true, baseModel: true, meta: true, favorite: true, versionRow: true, tags: false }

const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback

function readCardShow(value: unknown): CardShow {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return Object.fromEntries(
    CARD_SHOW_FIELDS.map((field) => [field, typeof source[field] === 'boolean' ? source[field] : DEFAULT_CARD_SHOW[field]]),
  ) as CardShow
}

export type TagLogic = 'any' | 'all'
/** Licence filters: null = any, true / false = the flag must be set / unset. */
export type Tristate = boolean | null

function readSearchIn(value: unknown): SearchIn {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return Object.fromEntries(
    SEARCH_FIELDS.map((field) => [field, typeof source[field] === 'boolean' ? source[field] : DEFAULT_SEARCH_IN[field]]),
  ) as SearchIn
}

/** The filter fields a preset stores (search, folder and letter are scope, not filters). */
export interface PresetFilters {
  baseModels: string[]
  tags: string[]
  tagLogic: TagLogic
  modelTypes: string[]
  creditRequired: Tristate
  allowSelling: Tristate
  favoritesOnly: boolean
  updatesOnly: boolean
}

export interface FilterPreset {
  name: string
  filters: PresetFilters
}

export function presetsKey(prefix: string): string {
  return `lm-ui.fpresets.${prefix}`
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === 'string')
const isTristate = (value: unknown): value is Tristate => value === null || typeof value === 'boolean'

function readPresetFilters(value: unknown): PresetFilters | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!isStringList(v.baseModels) || !isStringList(v.tags) || !isStringList(v.modelTypes)) return null
  if ((v.tagLogic !== 'any' && v.tagLogic !== 'all') || !isTristate(v.creditRequired) || !isTristate(v.allowSelling)) return null
  if (typeof v.favoritesOnly !== 'boolean' || typeof v.updatesOnly !== 'boolean') return null
  return {
    baseModels: v.baseModels,
    tags: v.tags,
    tagLogic: v.tagLogic,
    modelTypes: v.modelTypes,
    creditRequired: v.creditRequired,
    allowSelling: v.allowSelling,
    favoritesOnly: v.favoritesOnly,
    updatesOnly: v.updatesOnly,
  }
}

/** Stored presets; malformed entries (or a malformed list) are dropped. */
export function readPresets(prefix: string): FilterPreset[] {
  try {
    const value: unknown = JSON.parse(readStorage(presetsKey(prefix)) || '[]')
    if (!Array.isArray(value)) return []
    return value.flatMap((entry: unknown) => {
      const name = entry && typeof entry === 'object' ? (entry as { name?: unknown }).name : undefined
      const filters = entry && typeof entry === 'object' ? readPresetFilters((entry as { filters?: unknown }).filters) : null
      return typeof name === 'string' && name.trim() && filters ? [{ name: name.trim(), filters }] : []
    })
  } catch {
    return []
  }
}

/** Model libraries pass their LibraryConfig; the recipes page passes its own prefix and sorts. */
export function useLibraryFilters(config: Pick<LibraryConfig, 'sortOptions' | 'defaultSort'> & { prefix: string }) {
  const storageKey = `lm-ui.library.${config.prefix}`
  const stored = (() => {
    try {
      const value: unknown = JSON.parse(readStorage(storageKey) || '{}')
      return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
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
  /** The base-model chip row under the toolbar (decision D2: off by default, the Filters flyout has the group). */
  const quickRow = ref(stored.quickRow === true)
  const shape = ref<CardShape>(oneOf(CARD_SHAPES, stored.shape, 'portrait'))
  const fit = ref<CardFit>(oneOf(CARD_FITS, stored.fit, 'cover'))
  const show = ref<CardShow>(readCardShow(stored.show))
  const state = reactive({
    /** Local (library-scoped) text search, sent as the list endpoint's `search`. */
    search: '',
    searchIn: readSearchIn(stored.searchIn),
    folder: '',
    /** A selected folder includes its subfolders. */
    recursive: typeof stored.recursive === 'boolean' ? stored.recursive : true,
    baseModels: [] as string[],
    tags: [] as string[],
    tagLogic: 'any' as TagLogic,
    modelTypes: [] as string[],
    creditRequired: null as Tristate,
    allowSelling: null as Tristate,
    favoritesOnly: false,
    updatesOnly: false,
    /** Alphabet bar: first letter of the model name ('' = all). */
    letter: '',
  })

  watch([sort, cardSize, view, quickRow, shape, fit, () => ({ ...show.value }), () => ({ ...state.searchIn }), () => state.recursive], () => {
    writeStorage(
      storageKey,
      JSON.stringify({
        sort: sort.value,
        cardSize: cardSize.value,
        view: view.value,
        quickRow: quickRow.value,
        shape: shape.value,
        fit: fit.value,
        show: show.value,
        searchIn: state.searchIn,
        recursive: state.recursive,
      }),
    )
  })

  type ListField = 'baseModels' | 'tags' | 'modelTypes'

  function toggle(list: ListField, value: string): void {
    const current = state[list]
    state[list] = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]
  }

  /** Adds a value if missing (drawer tag click); never removes. */
  function include(list: ListField, value: string): void {
    if (!state[list].includes(value)) state[list] = [...state[list], value]
  }

  function clearList(list: ListField): void {
    state[list] = []
  }

  function presetFilters(): PresetFilters {
    return {
      baseModels: [...state.baseModels],
      tags: [...state.tags],
      tagLogic: state.tagLogic,
      modelTypes: [...state.modelTypes],
      creditRequired: state.creditRequired,
      allowSelling: state.allowSelling,
      favoritesOnly: state.favoritesOnly,
      updatesOnly: state.updatesOnly,
    }
  }

  function applyFilters(filters: PresetFilters): void {
    Object.assign(state, { ...filters, baseModels: [...filters.baseModels], tags: [...filters.tags], modelTypes: [...filters.modelTypes] })
  }

  /** Every scope and filter back to "show everything" (the search-in fields are a preference and stay). */
  function clear(): void {
    state.search = ''
    state.folder = ''
    state.recursive = true
    state.letter = ''
    clearPanel()
  }

  /** The Filters flyout's own "Clear all": its groups only, scope (search, folder, letter) stays. */
  function clearPanel(): void {
    applyFilters({
      baseModels: [],
      tags: [],
      tagLogic: 'any',
      modelTypes: [],
      creditRequired: null,
      allowSelling: null,
      favoritesOnly: false,
      updatesOnly: false,
    })
  }

  /** The browse state of a previous visit (tab switch). */
  function restore(view: BrowseViewState): void {
    state.search = view.search
    state.folder = view.folder
    state.letter = view.letter
    applyFilters(view)
  }

  /** The filter part of BrowseViewState, for saveBrowseView. */
  function browseFilters() {
    return { search: state.search, folder: state.folder, letter: state.letter, ...presetFilters() }
  }

  /** The model list query of the current state (model libraries; `letter` only where the endpoint takes `first_letter`). */
  function modelQuery(withLetter: boolean): Omit<ModelListQuery, 'page' | 'pageSize'> {
    return {
      sortBy: sort.value,
      search: state.search,
      searchIn: state.searchIn,
      folder: state.folder,
      recursive: state.recursive,
      baseModels: state.baseModels,
      tags: state.tags,
      tagLogic: state.tagLogic,
      modelTypes: state.modelTypes,
      creditRequired: state.creditRequired,
      allowSelling: state.allowSelling,
      favoritesOnly: state.favoritesOnly,
      updateAvailableOnly: state.updatesOnly,
      firstLetter: withLetter ? state.letter : '',
    }
  }

  const licenceChip = (key: 'creditRequired' | 'allowSelling', yes: string, no: string) =>
    state[key] === null ? [] : [{ key, label: state[key] ? yes : no, remove: () => (state[key] = null) }]

  const chips = computed<FilterChip[]>(() => [
    ...(state.search
      ? [{ key: 'search', label: t('library.searchChip', { query: state.search }), remove: () => (state.search = '') }]
      : []),
    // Always shown, so a folder filter stays visible while the folder panel is hidden.
    ...(state.folder
      ? [{ key: 'folder', label: t('library.folderChip', { name: state.folder }), remove: () => (state.folder = '') }]
      : []),
    ...(state.folder && !state.recursive
      ? [{ key: 'recursive', label: t('filters.chip.noSubfolders'), remove: () => (state.recursive = true) }]
      : []),
    ...(state.letter ? [{ key: 'letter', label: t('filters.chip.letter', { letter: state.letter }), remove: () => (state.letter = '') }] : []),
    ...state.baseModels.map((value) => ({ key: `base:${value}`, label: value, remove: () => toggle('baseModels', value) })),
    ...state.tags.map((value) => ({ key: `tag:${value}`, label: `#${value}`, remove: () => toggle('tags', value) })),
    ...(state.tagLogic === 'all' && state.tags.length > 1
      ? [{ key: 'taglogic', label: t('filters.chip.allTags'), remove: () => (state.tagLogic = 'any') }]
      : []),
    ...state.modelTypes.map((value) => ({ key: `type:${value}`, label: value, remove: () => toggle('modelTypes', value) })),
    ...licenceChip('creditRequired', t('filters.chip.creditRequired'), t('filters.chip.noCredit')),
    ...licenceChip('allowSelling', t('filters.chip.sellingAllowed'), t('filters.chip.noSelling')),
    ...(state.favoritesOnly ? [{ key: 'fav', label: t('library.favoritesOnly'), remove: () => (state.favoritesOnly = false) }] : []),
    ...(state.updatesOnly ? [{ key: 'upd', label: t('library.updatesOnly'), remove: () => (state.updatesOnly = false) }] : []),
  ])

  /** Number of filters inside the Filters flyout (search, folder and letter excluded). */
  const panelCount = computed(
    () =>
      state.baseModels.length +
      state.tags.length +
      state.modelTypes.length +
      (state.creditRequired === null ? 0 : 1) +
      (state.allowSelling === null ? 0 : 1) +
      (state.favoritesOnly ? 1 : 0) +
      (state.updatesOnly ? 1 : 0),
  )

  /** Stable key that changes whenever the result set must be reloaded. */
  const signature = computed(() =>
    JSON.stringify([
      sort.value,
      state.search,
      // The search fields and "include subfolders" only matter while there is a search / a folder.
      state.search ? state.searchIn : null,
      state.folder,
      state.folder ? state.recursive : null,
      state.letter,
      presetFilters(),
    ]),
  )

  // --- Filter presets (`lm-ui.fpresets.<prefix>`) ---
  const presets = ref<FilterPreset[]>(readPresets(config.prefix))

  function writePresets(next: FilterPreset[]): void {
    presets.value = next
    writeStorage(presetsKey(config.prefix), JSON.stringify(next))
  }

  /** Saves the current filters under `name` (replacing a preset of the same name). */
  function savePreset(name: string): void {
    const clean = name.trim()
    if (!clean) return
    writePresets([...presets.value.filter((preset) => preset.name !== clean), { name: clean, filters: presetFilters() }])
  }

  /** Removes the preset and returns it (for Undo). */
  function deletePreset(name: string): FilterPreset | undefined {
    const removed = presets.value.find((preset) => preset.name === name)
    writePresets(presets.value.filter((preset) => preset.name !== name))
    return removed
  }

  /** Puts a deleted preset back (Undo), replacing one saved under the same name meanwhile. */
  function restorePreset(preset: FilterPreset): void {
    writePresets([...presets.value.filter((entry) => entry.name !== preset.name), preset])
  }

  return {
    sort,
    cardSize,
    view,
    quickRow,
    shape,
    fit,
    show,
    state,
    toggle,
    include,
    clearList,
    clear,
    clearPanel,
    restore,
    browseFilters,
    modelQuery,
    chips,
    panelCount,
    signature,
    presets,
    savePreset,
    applyPreset: (preset: FilterPreset) => applyFilters(preset.filters),
    deletePreset,
    restorePreset,
  }
}
