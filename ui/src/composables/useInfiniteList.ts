/**
 * Page-by-page loader for the paged list endpoints
 * (`{ items, total, page, total_pages }`). Stale responses are dropped and
 * in-flight requests are aborted on reset, so fast filter changes never mix
 * results.
 */

import { computed, ref, shallowRef } from 'vue'
import type { PagedResponse } from '@/api/types'

export type PageFetcher<T> = (page: number, signal: AbortSignal) => Promise<PagedResponse<T>>

export function useInfiniteList<T>(fetchPage: PageFetcher<T>) {
  const items = shallowRef<T[]>([])
  const total = ref(0)
  const page = ref(0)
  const totalPages = ref(1)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const loaded = ref(false)

  let controller: AbortController | null = null
  let generation = 0

  const hasMore = computed(() => !loaded.value || page.value < totalPages.value)

  async function loadMore(): Promise<void> {
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
    error.value = null
    return loadMore()
  }

  /** Replace one item in place (after an edit) without reloading. */
  function updateItem(predicate: (item: T) => boolean, patch: (item: T) => T): void {
    items.value = items.value.map((item) => (predicate(item) ? patch(item) : item))
  }

  return { items, total, page, loading, error, loaded, hasMore, loadMore, reset, updateItem }
}
