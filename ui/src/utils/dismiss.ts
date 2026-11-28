/**
 * Pure helpers behind outside-click / Escape dismissal of overlays
 * (composables/useDismiss.ts wires them to the DOM).
 *
 * - Layers: open overlays form a stack; Escape and outside clicks only act on
 *   the topmost one, so a lightbox over a drawer closes alone.
 */

/** True when `target` lies outside every given root (missing roots are ignored). */
export function isOutsideAll(target: Node | null, roots: (Node | null | undefined)[]): boolean {
  if (!target) return false
  return !roots.some((root) => !!root && (root === target || root.contains(target)))
}

/**
 * Open Reka UI layers (components/ui/: dialogs, sheets, popovers, menus). They
 * handle their own Escape and outside clicks, so the hand-built layers below
 * them must not react while one is open.
 */
export const REKA_LAYER_SELECTOR =
  '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"], [data-state="open"][role="menu"]'

export function rekaLayerOpen(root: ParentNode = document): boolean {
  return !!root.querySelector(REKA_LAYER_SELECTOR)
}

export type DismissReason = 'escape' | 'outside'

export interface DismissLayer {
  id: number
  close: (reason: DismissReason) => void
}

export interface LayerStack {
  push: (layer: DismissLayer) => void
  remove: (id: number) => void
  top: () => DismissLayer | undefined
  isTop: (id: number) => boolean
  size: () => number
  /** Closes the topmost layer on Escape; returns whether there was one. */
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
      if (!layer) return false
      layer.close('escape')
      return true
    },
  }
}
