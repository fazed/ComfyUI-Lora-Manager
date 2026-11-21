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

export interface ShortcutEventLike {
  key: string
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
 * Whether a bare single-letter shortcut (`f`, `s`) may act: no modifier, not
 * typing in a field, not inside a dialog or menu, and no overlay open.
 */
export function shouldHandleShortcut(event: ShortcutEventLike, key: string, overlayOpen: boolean): boolean {
  if (overlayOpen || event.defaultPrevented || event.isComposing || event.repeat) return false
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
  if (event.key.toLowerCase() !== key) return false
  const target = event.target as { closest?: (selector: string) => unknown } | null | undefined
  return !target?.closest?.(BLOCKING_TARGETS)
}

/** What a browse page remembers while another tab is shown. */
export interface BrowseViewState {
  search: string
  folder: string
  baseModels: string[]
  tags: string[]
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
  views.set(prefix, { ...view, baseModels: [...view.baseModels], tags: [...view.tags] })
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
