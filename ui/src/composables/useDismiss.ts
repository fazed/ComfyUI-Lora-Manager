/**
 * Shared dismissal for overlays (drawer, lightbox, dialogs, popovers):
 *
 * - every open overlay registers a layer; Escape and outside clicks act on the
 *   topmost layer only;
 * - `outside` roots close a popover on a pointerdown anywhere else.
 *
 * Surfaces on the Reka UI primitives (components/ui/) are not on this stack:
 * while one is open, Escape and outside clicks are theirs (rekaLayerOpen).
 * Document listeners are attached only while the layer is open (VueUse
 * useEventListener with a reactive target). Pure logic: utils/dismiss.ts.
 */

import { onBeforeUnmount, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { createLayerStack, isOutsideAll, rekaLayerOpen, type DismissReason } from '@/utils/dismiss'

export const dismissStack = createLayerStack()

let nextId = 1

export interface DismissOptions {
  /** Whether the overlay is open (reactive getter). */
  active: () => boolean
  close: (reason: DismissReason) => void
  /** Popovers: a pointerdown outside all of these closes the layer. */
  outside?: () => (Node | null | undefined)[]
}

export function useDismissLayer(options: DismissOptions): void {
  const id = nextId++
  const isTopmost = () => dismissStack.isTop(id)
  const doc = typeof document === 'undefined' ? null : document

  useEventListener(
    () => (options.active() ? doc : null),
    'keydown',
    (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !isTopmost() || rekaLayerOpen()) return
      // preventDefault also stops lower layers' listeners in this same dispatch.
      event.preventDefault()
      options.close('escape')
    },
  )

  useEventListener(
    () => (options.outside && options.active() ? doc : null),
    'pointerdown',
    (event: PointerEvent) => {
      if (!options.outside || !isTopmost() || rekaLayerOpen()) return
      if (isOutsideAll(event.target as Node | null, options.outside())) options.close('outside')
    },
  )

  watch(
    options.active,
    (open) => (open ? dismissStack.push({ id, close: options.close }) : dismissStack.remove(id)),
    { immediate: true },
  )
  onBeforeUnmount(() => dismissStack.remove(id))
}
