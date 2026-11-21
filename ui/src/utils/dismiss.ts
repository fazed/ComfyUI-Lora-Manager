/**
 * Pure helpers behind outside-click / Escape dismissal of overlays
 * (composables/useDismiss.ts wires them to the DOM).
 *
 * - Backdrop: a click closes only when BOTH the pointerdown and the click land
 *   on the backdrop itself (target === currentTarget, and for a native
 *   <dialog> outside its box, where the ::backdrop is). Selecting text in a
 *   panel and releasing over the backdrop, or dragging out of the content,
 *   therefore never closes.
 * - Layers: open overlays form a stack; Escape and outside clicks only act on
 *   the topmost one, so a lightbox over a drawer closes alone.
 */

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
}

export interface PointerLike {
  target: EventTarget | null
  currentTarget: EventTarget | null
  clientX: number
  clientY: number
}

export function isOutsideRect(x: number, y: number, rect: RectLike): boolean {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
}

/**
 * True when the event hit the backdrop element itself (not a descendant).
 * With `contentRect` (the box of a native <dialog>, whose ::backdrop events
 * target the dialog element), the point must also lie outside that box, so
 * clicks on the dialog's own padding do not count.
 */
export function isBackdropHit(event: PointerLike, contentRect?: RectLike | null): boolean {
  if (!event.target || event.target !== event.currentTarget) return false
  return contentRect ? isOutsideRect(event.clientX, event.clientY, contentRect) : true
}

export interface BackdropGuard {
  pointerdown: (event: PointerLike) => void
  /** True when this click should close (pointerdown and click both on the backdrop). */
  click: (event: PointerLike) => boolean
}

/** Tracks the pointerdown so a click only closes when it also started on the backdrop. */
export function createBackdropGuard(contentRect?: (event: PointerLike) => RectLike | null): BackdropGuard {
  let armed = false
  return {
    pointerdown(event) {
      armed = isBackdropHit(event, contentRect?.(event))
    },
    click(event) {
      const hit = armed && isBackdropHit(event, contentRect?.(event))
      armed = false
      return hit
    },
  }
}

/** True when `target` lies outside every given root (missing roots are ignored). */
export function isOutsideAll(target: Node | null, roots: (Node | null | undefined)[]): boolean {
  if (!target) return false
  return !roots.some((root) => !!root && (root === target || root.contains(target)))
}

export type DismissReason = 'escape' | 'outside'

export interface DismissLayer {
  id: number
  /** False for native modal <dialog>s: the browser's cancel event handles Escape. */
  escape: boolean
  close: (reason: DismissReason) => void
}

export interface LayerStack {
  push: (layer: DismissLayer) => void
  remove: (id: number) => void
  top: () => DismissLayer | undefined
  isTop: (id: number) => boolean
  size: () => number
  /** Closes the topmost layer on Escape when it handles Escape itself; returns whether it did. */
  escape: () => boolean
}

export function createLayerStack(): LayerStack {
  const layers: DismissLayer[] = []
  const top = () => layers[layers.length - 1]
  return {
    push(layer) {
      const index = layers.findIndex((entry) => entry.id === layer.id)
      if (index >= 0) layers.splice(index, 1)
      layers.push(layer)
    },
    remove(id) {
      const index = layers.findIndex((entry) => entry.id === id)
      if (index >= 0) layers.splice(index, 1)
    },
    top,
    isTop: (id) => top()?.id === id,
    size: () => layers.length,
    escape() {
      const layer = top()
      if (!layer?.escape) return false
      layer.close('escape')
      return true
    },
  }
}
