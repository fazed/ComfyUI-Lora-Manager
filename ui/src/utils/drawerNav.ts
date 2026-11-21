/**
 * Pure logic of drawer navigation (prev/next between models) and the persisted
 * last tab. ModelDrawer.vue and LibraryPage.vue wire it to the DOM; written
 * test-first (tests/drawerNav.test.ts).
 */

export type NavDirection = 'prev' | 'next'

export interface NavState {
  /** Zero-based position in the displayed list. */
  index: number
  /** One-based position for display. */
  ordinal: number
  loadedCount: number
  /** Total count of the list, or null when unknown (or stale: smaller than what is loaded). */
  total: number | null
  hasPrev: boolean
  /** True at the last loaded item too while more pages can still be loaded. */
  hasNext: boolean
  /** The open model is the last loaded one and another page exists: load it before stepping. */
  needsMore: boolean
}

/**
 * Position of the open model in the currently displayed list (filters and sort
 * already applied). Null when it is not part of the list (deep link, search pick).
 */
export function computeNav(
  keys: readonly string[],
  current: string | null | undefined,
  options: { total?: number | null; hasMore?: boolean } = {},
): NavState | null {
  if (!current) return null
  const index = keys.indexOf(current)
  if (index < 0) return null
  const total = options.total && options.total >= keys.length ? options.total : null
  const atEnd = index === keys.length - 1
  const needsMore = atEnd && !!options.hasMore
  return {
    index,
    ordinal: index + 1,
    loadedCount: keys.length,
    total,
    hasPrev: index > 0,
    hasNext: !atEnd || needsMore,
    needsMore,
  }
}

/** "3 of 120" with a known total, else just the ordinal. `withTotal` supplies the (translated) wording. */
export function positionLabel(
  ordinal: number,
  total: number | null,
  withTotal: (position: string, total: string) => string,
  format: (n: number) => string = (n) => n.toLocaleString(),
): string {
  return total === null ? format(ordinal) : withTotal(format(ordinal), format(total))
}

// --- keyboard ---------------------------------------------------------------

export interface NavKeyEvent {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
  /** A DOM `EventTarget` (a real KeyboardEvent) or a plain stand-in in tests. */
  target: EventTarget | { tagName?: string; isContentEditable?: boolean } | null
}

export interface NavKeyContext {
  /** The drawer is the topmost dismiss layer. */
  topmost: boolean
  /** A modal dialog (lightbox, confirm, example images, ...) is open. */
  dialogOpen: boolean
  /** The drawer's own "More actions" menu is open. */
  menuOpen?: boolean
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Which direction a key press asks for, or null. Alt+ArrowLeft/Right and plain
 * k (previous) / j (next). Nothing happens while typing in a field (Alt+Arrow is
 * word movement with Option on macOS), while a dialog or menu is open, or when
 * another layer is on top of the drawer.
 */
export function shouldHandleNavKey(event: NavKeyEvent, context: NavKeyContext): NavDirection | null {
  if (!context.topmost || context.dialogOpen || context.menuOpen) return null
  if (event.defaultPrevented || event.isComposing) return null
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null
  const tag = target?.tagName?.toUpperCase()
  if ((tag && EDITABLE_TAGS.has(tag)) || target?.isContentEditable) return null
  if (event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (event.altKey) {
    if (event.key === 'ArrowLeft') return 'prev'
    if (event.key === 'ArrowRight') return 'next'
    return null
  }
  const letter = event.key.toLowerCase()
  if (letter === 'k') return 'prev'
  if (letter === 'j') return 'next'
  return null
}

// --- persisted tab ----------------------------------------------------------

export const DRAWER_TABS = ['overview', 'description', 'versions'] as const
export type DrawerTab = (typeof DRAWER_TABS)[number]

/** A stored value (localStorage, any type) as a known tab; anything else is Overview. */
export function parseStoredTab(value: unknown): DrawerTab {
  return (DRAWER_TABS as readonly unknown[]).includes(value) ? (value as DrawerTab) : 'overview'
}

/** Tabs that make sense for a model: Versions needs the Civitai model id. */
export function availableTabs(item: { civitai?: { modelId?: number | null } | null }): DrawerTab[] {
  return item.civitai?.modelId ? [...DRAWER_TABS] : DRAWER_TABS.filter((tab) => tab !== 'versions')
}

/** The tab to show: the remembered one when this model has it, else Overview. The preference itself is never rewritten here. */
export function resolveTab(preferred: DrawerTab, available: readonly DrawerTab[]): DrawerTab {
  return available.includes(preferred) ? preferred : 'overview'
}

// --- stale responses --------------------------------------------------------

export interface GuardedRequest {
  signal: AbortSignal
  /** False once a newer request began or the guard was cancelled. */
  isCurrent: () => boolean
}

/**
 * Keeps only the latest request of a kind: starting a new one aborts the previous
 * fetch, and a response that still arrives checks `isCurrent()` before it is applied.
 */
export function createRequestGuard() {
  let controller: AbortController | null = null
  let sequence = 0
  return {
    begin(): GuardedRequest {
      controller?.abort()
      const own = new AbortController()
      controller = own
      const id = ++sequence
      return { signal: own.signal, isCurrent: () => id === sequence }
    },
    cancel(): void {
      controller?.abort()
      controller = null
      sequence += 1
    },
  }
}

// --- grid -------------------------------------------------------------------

/**
 * New scrollTop that brings a grid row into view with the least movement. A row
 * taller than the viewport aligns its top.
 */
export function scrollTopToReveal(rowTop: number, rowHeight: number, scrollTop: number, viewport: number): number {
  if (rowTop < scrollTop) return Math.max(0, rowTop)
  if (rowTop + rowHeight > scrollTop + viewport) return Math.max(0, Math.min(rowTop, rowTop + rowHeight - viewport))
  return Math.max(0, scrollTop)
}
