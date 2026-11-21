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
 * The pure logic lives in utils/dismiss.ts.
 */

import { onBeforeUnmount, watch } from 'vue'
import {
  createBackdropGuard,
  createLayerStack,
  isOutsideAll,
  type DismissReason,
  type PointerLike,
} from '@/utils/dismiss'

export const dismissStack = createLayerStack()

let nextId = 1
let keyListening = false

function onDocumentKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
  if (dismissStack.escape()) event.preventDefault()
}

function syncKeyListener(): void {
  const wanted = dismissStack.size() > 0
  if (wanted === keyListening || typeof document === 'undefined') return
  keyListening = wanted
  if (wanted) document.addEventListener('keydown', onDocumentKey)
  else document.removeEventListener('keydown', onDocumentKey)
}

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
  const isTopmost = () => dismissStack.isTop(id)
  const guard = createBackdropGuard(
    options.backdrop === 'dialog' ? (event) => (event.currentTarget as Element | null)?.getBoundingClientRect() ?? null : undefined,
  )

  function onDocumentPointer(event: PointerEvent): void {
    if (!options.outside || !isTopmost()) return
    if (isOutsideAll(event.target as Node | null, options.outside())) options.close('outside')
  }

  function register(): void {
    dismissStack.push({ id, escape: options.escape ?? true, close: options.close })
    if (options.outside) document.addEventListener('pointerdown', onDocumentPointer)
    syncKeyListener()
  }

  function unregister(): void {
    dismissStack.remove(id)
    if (options.outside) document.removeEventListener('pointerdown', onDocumentPointer)
    syncKeyListener()
  }

  watch(options.active, (open) => (open ? register() : unregister()), { immediate: true })
  onBeforeUnmount(unregister)

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
