/**
 * Keyboard movement in the virtual grid (VirtualGrid.vue): the grid is one tab
 * stop. Only the active item's primary button (`data-grid-primary`) has
 * `tabindex="0"`; the arrows, Home / End and PageUp / PageDown move the active
 * item by the grid's column count, scroll its row into view and focus it
 * again once the window has rendered it. The active item is tracked by key,
 * so it survives row recycling. Item actions (Space, Enter, S, C, F, Delete)
 * are the page's: it reads the item of a key event with `gridKeyOf`.
 */
import { nextTick, type Ref } from 'vue'

/** Marks the button that carries an item (focused by the grid). */
export const GRID_PRIMARY = 'data-grid-primary'

export interface GridShape {
  columns: number
  count: number
  /** Whole rows in the viewport (PageUp / PageDown). */
  pageRows: number
}

/** The index a movement key leads to from `index`, or null when the key is not a movement key. */
export function gridStep(index: number, key: string, shape: GridShape): number | null {
  const { columns, count } = shape
  if (count <= 0) return null
  const page = Math.max(1, shape.pageRows) * columns
  const clamp = (value: number) => Math.min(count - 1, Math.max(0, value))
  switch (key) {
    case 'ArrowRight':
      return clamp(index + 1)
    case 'ArrowLeft':
      return clamp(index - 1)
    case 'ArrowDown':
      // The last row may be short: stay put rather than jump to an item that is not below.
      return index + columns < count ? index + columns : index
    case 'ArrowUp':
      return index - columns >= 0 ? index - columns : index
    case 'Home':
      return 0
    case 'End':
      return count - 1
    case 'PageDown':
      return clamp(index + page)
    case 'PageUp':
      return clamp(index - page)
    default:
      return null
  }
}

/** Key of the grid item an event happened in (`data-grid-key` on its cell), or null outside the items. */
export function gridKeyOf(target: EventTarget | null): string | null {
  const cell = (target as Element | null)?.closest?.('[data-grid-key]')
  return cell instanceof HTMLElement ? (cell.dataset.gridKey ?? null) : null
}

export interface GridKeyboardOptions {
  root: Readonly<Ref<HTMLElement | null>>
  keys: () => string[]
  shape: () => Omit<GridShape, 'count'>
  activeKey: Ref<string | null | undefined>
  scrollToIndex: (index: number) => void
}

export function useGridKeyboard(options: GridKeyboardOptions) {
  function focusKey(key: string): void {
    const cells = options.root.value?.querySelectorAll<HTMLElement>('[data-grid-key]') ?? []
    const cell = [...cells].find((entry) => entry.dataset.gridKey === key)
    cell?.querySelector<HTMLElement>(`[${GRID_PRIMARY}]`)?.focus({ preventScroll: true })
  }

  async function onKeydown(event: KeyboardEvent): Promise<void> {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const target = event.target as Element | null
    if (!target?.hasAttribute?.(GRID_PRIMARY)) return
    const keys = options.keys()
    const index = keys.indexOf(gridKeyOf(target) ?? '')
    if (index < 0) return
    const next = gridStep(index, event.key, { ...options.shape(), count: keys.length })
    if (next === null) return
    event.preventDefault()
    options.activeKey.value = keys[next]
    options.scrollToIndex(next)
    await nextTick()
    focusKey(keys[next])
  }

  /** Focus entering an item (Tab, click) makes it the active one. */
  function onFocusin(event: FocusEvent): void {
    const key = gridKeyOf(event.target)
    if (key !== null && key !== options.activeKey.value) options.activeKey.value = key
  }

  return { onKeydown, onFocusin, focusKey }
}
