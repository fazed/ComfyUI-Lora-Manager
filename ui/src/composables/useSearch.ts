/** Global search box state, shared by the top bar and the active page. */

import { ref, watch, type Ref } from 'vue'

const query = ref('')
const debounced = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

watch(query, (value) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    debounced.value = value.trim()
  }, 250)
})

export function useSearch(): { query: Ref<string>; debounced: Ref<string>; clear: () => void } {
  return {
    query,
    debounced,
    clear() {
      if (timer) clearTimeout(timer)
      query.value = ''
      debounced.value = ''
    },
  }
}

/** Debounce helper for any ref. */
export function debounceRef<T>(source: Ref<T>, delayMs: number): Ref<T> {
  const out = ref(source.value) as Ref<T>
  let handle: ReturnType<typeof setTimeout> | null = null
  watch(source, (value) => {
    if (handle) clearTimeout(handle)
    handle = setTimeout(() => {
      out.value = value
    }, delayMs)
  })
  return out
}
