/**
 * Pure helpers of the browse pages (library and recipes): result counts,
 * keyboard shortcut guard and the per-library view state that survives tab
 * switches.
 */

/**
 * The unfiltered total to show next to the filtered count ("85 of 1,041"),
 * or null when it adds nothing (not filtered, unknown or not larger).
 */
export function unfilteredTotal(count: number, known: number | null, filtered: boolean): number | null {
  return filtered && known !== null && known > count ? known : null
}

/** Which empty state a library shows for zero results, from the keys of its active-view chips. */
export type EmptyStateKind = 'library' | 'folder' | 'favorites' | 'noMatch'

export function emptyStateKind(chipKeys: string[]): EmptyStateKind {
  if (!chipKeys.length) return 'library'
  if (chipKeys.every((key) => key === 'folder' || key === 'recursive')) return 'folder'
  if (chipKeys.length === 1 && chipKeys[0] === 'fav') return 'favorites'
  return 'noMatch'
}

export interface ShortcutEventLike {
  key: string
  /** Physical key (`KeyA`): Alt+letter on macOS types a symbol in `key`. */
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
  repeat?: boolean
  /** A DOM `EventTarget` (a real KeyboardEvent) or a plain stand-in in tests. */
  target?: EventTarget | { closest?: (selector: string) => unknown } | null
}

/** Typing targets and containers that own their keys (dialogs, menus, listboxes). */
const BLOCKING_TARGETS =
  'input, textarea, select, [contenteditable="true"], dialog[open], [role="dialog"], [role="menu"], [role="listbox"], [role="combobox"]'

/**
 * Whether a bare single-key shortcut (`f`, `b`, `?`) may act: no modifier (Shift
 * only where it is part of the character, as in `?`), not typing in a field,
 * not inside a dialog or menu, and no overlay open.
 */
export function shouldHandleShortcut(event: ShortcutEventLike, key: string, overlayOpen: boolean): boolean {
  if (overlayOpen || event.defaultPrevented || event.isComposing || event.repeat) return false
  if (event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && /^[a-z]$/.test(key))) return false
  if (event.key.toLowerCase() !== key) return false
  const target = event.target as { closest?: (selector: string) => unknown } | null | undefined
  return !target?.closest?.(BLOCKING_TARGETS)
}

/** Alt+A to Alt+Z (alphabet bar): the upper-case letter, or null when the event is not one or may not act. */
export function altLetter(event: ShortcutEventLike, overlayOpen: boolean): string | null {
  if (overlayOpen || event.defaultPrevented || event.isComposing || event.repeat) return null
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  const letter = /^Key([A-Z])$/.exec(event.code ?? '')?.[1]
  const target = event.target as { closest?: (selector: string) => unknown } | null | undefined
  return letter && !target?.closest?.(BLOCKING_TARGETS) ? letter : null
}

/** What a browse page remembers while another tab is shown. */
export interface BrowseViewState {
  search: string
  folder: string
  /** Alphabet bar letter ('' = all). */
  letter: string
  baseModels: string[]
  tags: string[]
  tagLogic: 'any' | 'all'
  modelTypes: string[]
  /** Licence filters: null = any. */
  creditRequired: boolean | null
  allowSelling: boolean | null
  favoritesOnly: boolean
  updatesOnly: boolean
  /** Recipes: the "missing LoRAs only" toggle. */
  missingOnly: boolean
  scrollTop: number
  /** Items that were loaded, so the scroll position can be restored. */
  loadedCount: number
  /** Count seen while nothing was filtered, for the "N of total" cue. */
  knownTotal: number | null
}

const views = new Map<string, BrowseViewState>()

export function saveBrowseView(prefix: string, view: BrowseViewState): void {
  views.set(prefix, { ...view, baseModels: [...view.baseModels], tags: [...view.tags], modelTypes: [...view.modelTypes] })
}

export function takeBrowseView(prefix: string): BrowseViewState | null {
  return views.get(prefix) ?? null
}

export function clearBrowseView(prefix?: string): void {
  if (prefix) views.delete(prefix)
  else views.clear()
}

/** Largest number of items re-loaded to restore a scroll position. */
export const RESTORE_MAX_ITEMS = 600
