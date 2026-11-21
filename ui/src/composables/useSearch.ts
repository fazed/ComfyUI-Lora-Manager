/**
 * Search plumbing shared by the global top-bar search, the local library
 * search boxes and the pages:
 *
 * - `useSuggestions(scope)`: debounced (150 ms), abortable autocomplete
 *   lookups with a shared LRU cache (one suggester per box, cache shared).
 * - `stashItem` / `takeStashedItem`: a model picked in the global search is
 *   handed to its library page so the drawer opens without refetching; the
 *   route (`?open=<file_path>`) stays the source of truth for reloads.
 */

import { ref, shallowRef, type Ref } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import { apiSuggestSource } from '@/api/suggestSource'
import {
  createSuggester,
  LruCache,
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
  suggestCacheKey,
  type SuggestResult,
  type SuggestSource,
} from '@/utils/suggest'

let stashed: { key: string; item: unknown } | null = null

export function stashItem(key: string, item: unknown): void {
  stashed = { key, item }
}

/** Returns the stashed item when it matches `key` (and forgets it). */
export function takeStashedItem<T>(key: string): T | null {
  if (!stashed || stashed.key !== key) return null
  const { item } = stashed
  stashed = null
  return item as T
}

const sharedCache = new LruCache<string, SuggestResult>(60)

export interface Suggestions {
  result: Ref<SuggestResult | null>
  loading: Ref<boolean>
  /** Schedules a lookup for `text` (debounced); shorter than the minimum clears. */
  request: (text: string) => void
  /** Cancels pending/in-flight lookups and clears the result. */
  reset: () => void
}

export function useSuggestions(scope: () => string, source: SuggestSource = apiSuggestSource): Suggestions {
  const suggester = createSuggester(source, sharedCache)
  const result = shallowRef<SuggestResult | null>(null)
  const loading = ref(false)
  let seq = 0
  let pending: { query: string; ticket: number } | null = null

  // Debounce: the lookup runs SUGGEST_DEBOUNCE_MS after the last keystroke.
  const debounce = useTimeoutFn(
    () => {
      const next = pending
      pending = null
      if (!next) return
      void suggester.suggest(scope(), next.query).then((value) => {
        if (value === null || next.ticket !== seq) return
        result.value = value
        loading.value = false
      })
    },
    SUGGEST_DEBOUNCE_MS,
    { immediate: false },
  )

  function stop(): void {
    debounce.stop()
    pending = null
    suggester.cancel()
    seq++
  }

  function reset(): void {
    stop()
    result.value = null
    loading.value = false
  }

  function request(text: string): void {
    const query = text.trim()
    if (query.length < SUGGEST_MIN_CHARS) return reset()
    stop()
    const cached = sharedCache.get(suggestCacheKey(scope(), query))
    if (cached) {
      result.value = cached
      loading.value = false
      return
    }
    loading.value = true
    pending = { query, ticket: ++seq }
    debounce.start()
  }

  return { result, loading, request, reset }
}
