/**
 * Shared dismissal for overlays (drawer, lightbox, dialogs, popovers):
 *
 * - every open overlay registers a layer; Escape and outside clicks act on the
 *   topmost layer only (a lightbox over the drawer closes alone);
 * - `backdrop` handlers close on a click on the backdrop itself, but only when
 *   the pointerdown started there too (no accidental close after selecting text
 *   or dragging out of the content);
 * - `outside` roots close a popover on a pointerdown anywhere else.
 *
 * Native modal <dialog>s pass `escape: false`: the browser fires `cancel` on the
 * topmost one, and the layer still keeps the overlays below it from reacting.
 * Document listeners are attached only while the layer is open (VueUse
 * useEventListener with a reactive target). Pure logic: utils/dismiss.ts.
 */

import { onBeforeUnmount, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import {
  createBackdropGuard,
  createLayerStack,
  isOutsideAll,
  type DismissReason,
  type PointerLike,
} from '@/utils/dismiss'

export const dismissStack = createLayerStack()

let nextId = 1

export interface DismissOptions {
  /** Whether the overlay is open (reactive getter). */
  active: () => boolean
  close: (reason: DismissReason) => void
  /** Close the topmost layer on Escape (default true; false for native modal dialogs). */
  escape?: boolean
  /** Popovers: a pointerdown outside all of these closes the layer. */
  outside?: () => (Node | null | undefined)[]
  /** 'dialog' when the backdrop handlers sit on a native <dialog> (its ::backdrop). */
  backdrop?: 'element' | 'dialog'
}

export function useDismissLayer(options: DismissOptions) {
  const id = nextId++
  const escape = options.escape ?? true
  const isTopmost = () => dismissStack.isTop(id)
  const guard = createBackdropGuard(
    options.backdrop === 'dialog' ? (event) => (event.currentTarget as Element | null)?.getBoundingClientRect() ?? null : undefined,
  )
  const doc = typeof document === 'undefined' ? null : document

  useEventListener(
    () => (escape && options.active() ? doc : null),
    'keydown',
    (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !isTopmost()) return
      // preventDefault also stops lower layers' listeners in this same dispatch.
      event.preventDefault()
      options.close('escape')
    },
  )

  useEventListener(
    () => (options.outside && options.active() ? doc : null),
    'pointerdown',
    (event: PointerEvent) => {
      if (!options.outside || !isTopmost()) return
      if (isOutsideAll(event.target as Node | null, options.outside())) options.close('outside')
    },
  )

  watch(
    options.active,
    (open) => (open ? dismissStack.push({ id, escape, close: options.close }) : dismissStack.remove(id)),
    { immediate: true },
  )
  onBeforeUnmount(() => dismissStack.remove(id))

  return {
    isTopmost,
    /** Bind as @pointerdown / @click on the backdrop element. */
    backdrop: {
      pointerdown: (event: PointerLike) => guard.pointerdown(event),
      click: (event: PointerLike) => {
        if (guard.click(event) && isTopmost()) options.close('outside')
      },
    },
  }
}
