/**
 * In-app refresh: a tiny page-level registry. The routed page registers one
 * handler while it is mounted (`useRefreshHandler`); the shell's refresh
 * buttons (`RefreshButton`, in the library toolbar and the PageShell header)
 * and the `r` shortcut call the current one (`useRefresh` / `useRefreshHost`).
 *
 * A refresh is the LIGHT one: the page re-reads what it shows through the
 * normal GET endpoints and keeps its UI state. It never asks the server to
 * rescan the library (that is a separate, deliberate action).
 *
 * - One run at a time: a second request while one is running is ignored.
 * - Errors become an error toast (silent runs stay quiet).
 * - Pages that opt in (`onVisible`) refresh silently when the tab becomes
 *   visible again after it was hidden for at least AUTO_REFRESH_AFTER_MS.
 */

import { computed, onBeforeUnmount, onMounted, readonly, ref, shallowRef, watch } from 'vue'
import { useDocumentVisibility, useEventListener } from '@vueuse/core'
import { useToasts } from './useFeedback'
import { shouldHandleShortcut } from '@/utils/browse'
import { t } from '@/i18n'

export interface RefreshContext {
  /** Automatic refresh (tab visible again): no error toast. */
  silent: boolean
}

export interface RefreshHandler {
  /** Re-read the page's data in place. Rejects when the main data could not be loaded. */
  run: (context: RefreshContext) => Promise<void>
  /**
   * Show the shell refresh button (default true). A page with its own visible
   * refresh control (Diagnostics "Run again") sets false; `r` still works.
   */
  button?: boolean
  /** Refresh silently when the tab becomes visible after a longer absence (default false). */
  onVisible?: boolean
}

/** Bare key of the refresh shortcut. */
export const REFRESH_KEY = 'r'
/** The tab must have been hidden at least this long before an automatic refresh. */
export const AUTO_REFRESH_AFTER_MS = 60_000

const current = shallowRef<{ id: number; handler: RefreshHandler } | null>(null)
const busy = ref(false)
let nextId = 1

/** Make `handler` the current one; the returned function removes it again (only if it is still current). */
export function registerRefresh(handler: RefreshHandler): () => void {
  const id = nextId++
  current.value = { id, handler }
  return () => {
    if (current.value?.id === id) current.value = null
  }
}

/** Register the page's refresh handler for as long as the calling component is mounted. */
export function useRefreshHandler(handler: RefreshHandler): void {
  let unregister: (() => void) | null = null
  onMounted(() => {
    unregister = registerRefresh(handler)
  })
  onBeforeUnmount(() => {
    unregister?.()
    unregister = null
  })
}

/**
 * Run the current page's refresh. Resolves true when it ran and succeeded,
 * false when there is no handler, one is already running, or it failed.
 */
export async function runRefresh(options: { silent?: boolean } = {}): Promise<boolean> {
  const entry = current.value
  if (!entry || busy.value) return false
  const silent = options.silent ?? false
  busy.value = true
  try {
    await entry.handler.run({ silent })
    return true
  } catch (error) {
    if (!silent) useToasts().error(t('refresh.failed', { message: (error as Error)?.message || t('common.error') }))
    return false
  } finally {
    busy.value = false
  }
}

/** Shell view of the registry: whether a refresh exists, whether to show a button, the busy state. */
export function useRefresh() {
  return {
    available: computed(() => current.value !== null),
    showButton: computed(() => current.value !== null && current.value.handler.button !== false),
    busy: readonly(busy),
    run: () => runRefresh(),
  }
}

/** Installed once by the app shell: the `r` shortcut and the visibility auto-refresh. */
export function useRefreshHost(): void {
  useEventListener(document, 'keydown', (event: KeyboardEvent) => {
    if (!current.value) return
    // Modal dialogs and open menus own their keys (even when focus sits on the page behind them).
    const overlay = !!document.querySelector('dialog[open], [role="menu"]')
    if (!shouldHandleShortcut(event, REFRESH_KEY, overlay)) return
    event.preventDefault()
    void runRefresh()
  })

  const visibility = useDocumentVisibility()
  let hiddenAt: number | null = visibility.value === 'hidden' ? Date.now() : null
  watch(visibility, (state) => {
    if (state === 'hidden') {
      hiddenAt ??= Date.now()
      return
    }
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt
    hiddenAt = null
    if (away >= AUTO_REFRESH_AFTER_MS && current.value?.handler.onVisible) void runRefresh({ silent: true })
  })
}
