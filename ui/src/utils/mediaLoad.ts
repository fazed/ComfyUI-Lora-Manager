/**
 * Load state of one media element (components/LazyMedia.vue):
 *
 *   loading --load--> loaded (fades in)
 *   loading --error--> error (fallback, retry goes back to loading)
 *   (mount) --cached--> loaded instantly (already complete: no fade, no flash)
 *   any --src change--> loading (recycled card / next lightbox image)
 *
 * `token` increases on every (re)start so late events of a previous src are ignored.
 */

export type MediaStatus = 'empty' | 'loading' | 'loaded' | 'error'

export interface MediaState {
  status: MediaStatus
  /** True when the media was already complete when shown: skip the fade. */
  instant: boolean
  token: number
}

export type MediaEvent =
  | { type: 'start'; src: string }
  | { type: 'cached'; token: number }
  | { type: 'load'; token: number }
  | { type: 'error'; token: number }
  | { type: 'retry'; src: string }

export const initialMediaState: MediaState = { status: 'empty', instant: false, token: 0 }

export function mediaReducer(state: MediaState, event: MediaEvent): MediaState {
  switch (event.type) {
    case 'start':
    case 'retry':
      return { status: event.src ? 'loading' : 'empty', instant: false, token: state.token + 1 }
    case 'cached':
      if (event.token !== state.token || state.status !== 'loading') return state
      return { ...state, status: 'loaded', instant: true }
    case 'load':
      if (event.token !== state.token || state.status !== 'loading') return state
      return { ...state, status: 'loaded' }
    case 'error':
      if (event.token !== state.token || state.status === 'empty') return state
      return { ...state, status: 'error', instant: false }
  }
}

/**
 * A load that completes this soon after the element was shown came from the
 * memory/disk cache (lazy images are never `complete` synchronously, e.g. a
 * card scrolled back into the virtual grid): show it without a fade too.
 */
export const CACHE_HIT_MS = 120

export function loadEventType(elapsedMs: number): 'cached' | 'load' {
  return elapsedMs < CACHE_HIT_MS ? 'cached' : 'load'
}

/** Already decoded/painted (served from cache): show without a fade. */
export function isMediaComplete(element: HTMLImageElement | HTMLVideoElement | null): boolean {
  if (!element) return false
  if (element instanceof HTMLImageElement) return element.complete && element.naturalWidth > 0
  // HAVE_CURRENT_DATA: the first frame can be painted.
  return element.readyState >= 2
}
