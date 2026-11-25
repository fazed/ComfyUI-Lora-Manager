/**
 * Page-by-page loader for the paged list endpoints
 * (`{ items, total, page, total_pages }`). Stale responses are dropped and
 * in-flight requests are aborted on reset, so fast filter changes never mix
 * results. `refresh` re-reads the loaded range in place (see below).
 */

import { computed, ref, shallowRef } from 'vue'
import type { PagedResponse } from '@/api/types'

export type PageFetcher<T> = (page: number, signal: AbortSignal) => Promise<PagedResponse<T>>

export interface ListRefreshOptions<T> {
  /** Re-read at most this many pages (the rest is loaded again by scrolling). */
  maxPages?: number
  /** Item identity: an item that moved to the next page while refreshing is kept once. */
  key?: (item: T) => string
}

export function useInfiniteList<T>(fetchPage: PageFetcher<T>) {
  const items = shallowRef<T[]>([])
  const total = ref(0)
  const page = ref(0)
  const totalPages = ref(1)
  const loading = ref(false)
  const refreshing = ref(false)
  const error = ref<string | null>(null)
  const loaded = ref(false)

  let controller: AbortController | null = null
  let generation = 0
  /** A loadMore asked for while refreshing: run it once the refresh is done. */
  let deferredLoadMore = false

  const hasMore = computed(() => !loaded.value || page.value < totalPages.value)

  async function loadMore(): Promise<void> {
    if (refreshing.value) {
      deferredLoadMore = true
      return
    }
    if (loading.value || (loaded.value && page.value >= totalPages.value)) return
    const currentGeneration = generation
    controller = new AbortController()
    loading.value = true
    error.value = null
    try {
      const response = await fetchPage(page.value + 1, controller.signal)
      if (currentGeneration !== generation) return
      items.value = [...items.value, ...(response.items ?? [])]
      total.value = response.total ?? items.value.length
      totalPages.value = Math.max(response.total_pages ?? 1, 0)
      page.value = response.page ?? page.value + 1
      loaded.value = true
    } catch (err) {
      if (currentGeneration !== generation || (err as Error)?.name === 'AbortError') return
      error.value = (err as Error)?.message || 'Request failed'
    } finally {
      if (currentGeneration === generation) loading.value = false
    }
  }

  /** Drop everything and load the first page again. */
  function reset(): Promise<void> {
    generation += 1
    controller?.abort()
    controller = null
    items.value = []
    total.value = 0
    page.value = 0
    totalPages.value = 1
    loaded.value = false
    loading.value = false
    refreshing.value = false
    deferredLoadMore = false
    error.value = null
    return loadMore()
  }

  /**
   * Re-read pages 1..n of the loaded range (n capped by `maxPages`) and swap
   * the result in at once: the old items stay visible meanwhile, so the grid
   * keeps its scroll position. Stops early at the server's last page. A failure
   * keeps the old items and rejects (the caller reports it); a reset during the
   * refresh wins and the refresh result is dropped.
   */
  async function refresh(options: ListRefreshOptions<T> = {}): Promise<void> {
    if (!loaded.value) {
      await reset()
      if (error.value) throw new Error(error.value)
      return
    }
    const pages = Math.max(1, Math.min(page.value, options.maxPages ?? Number.POSITIVE_INFINITY))
    // An unfinished loadMore is aborted and asked again after the refresh.
    if (loading.value) deferredLoadMore = true
    generation += 1
    const currentGeneration = generation
    controller?.abort()
    const request = new AbortController()
    controller = request
    loading.value = false
    refreshing.value = true
    try {
      const collected: T[] = []
      let last: PagedResponse<T> | null = null
      let fetched = 0
      for (let next = 1; next <= pages; next++) {
        const response = await fetchPage(next, request.signal)
        if (currentGeneration !== generation) return
        collected.push(...(response.items ?? []))
        last = response
        fetched = next
        if ((response.total_pages ?? 1) <= next) break
      }
      const key = options.key
      const seen = new Set<string>()
      items.value = key
        ? collected.filter((item) => {
            const id = key(item)
            if (seen.has(id)) return false
            seen.add(id)
            return true
          })
        : collected
      total.value = last?.total ?? items.value.length
      totalPages.value = Math.max(last?.total_pages ?? 1, 0)
      page.value = last?.page ?? fetched
      loaded.value = true
      error.value = null
    } catch (err) {
      if (currentGeneration !== generation || (err as Error)?.name === 'AbortError') return
      throw err
    } finally {
      if (currentGeneration === generation) {
        refreshing.value = false
        controller = null
        if (deferredLoadMore) {
          deferredLoadMore = false
          void loadMore()
        }
      }
    }
  }

  /** Replace one item in place (after an edit) without reloading. */
  function updateItem(predicate: (item: T) => boolean, patch: (item: T) => T): void {
    items.value = items.value.map((item) => (predicate(item) ? patch(item) : item))
  }

  /** Drop items at once (delete/exclude) and keep the total in step. */
  function removeWhere(predicate: (item: T) => boolean): number {
    const before = items.value.length
    items.value = items.value.filter((item) => !predicate(item))
    const removed = before - items.value.length
    total.value = Math.max(0, total.value - removed)
    return removed
  }

  return { items, total, page, loading, refreshing, error, loaded, hasMore, loadMore, reset, refresh, updateItem, removeWhere }
}
