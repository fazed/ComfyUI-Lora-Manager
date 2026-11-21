/**
 * Pointer handling shared by the library cards, list rows and recipe cards:
 * primary click (open, or toggle the selection in selection mode and with
 * Ctrl/Cmd), the "..." menu button and right-click. Right-click always opens
 * the menu, also in selection mode: the page decides which menu (item or
 * selection) it shows.
 */

export type MenuPoint = { x: number; y: number }

export interface CardInteractionHandlers<T> {
  item: () => T
  selectionMode: () => boolean
  open: (item: T) => void
  /** shift = Shift+click: select a range from the last toggled card. */
  toggle: (item: T, shift: boolean) => void
  menu: (item: T, point: MenuPoint, opener: HTMLElement | null) => void
}

/** Where a menu opened from `element` (a button, or a keyboard context-menu key) should appear. */
export function menuPointFor(element: HTMLElement, alignRight = true): MenuPoint {
  const rect = element.getBoundingClientRect()
  return { x: alignRight ? rect.right - 220 : rect.left, y: rect.bottom + 4 }
}

/** What a primary click on a card does. */
export function cardActivation(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>, selectionMode: boolean): 'open' | 'toggle' {
  return selectionMode || event.ctrlKey || event.metaKey ? 'toggle' : 'open'
}

export function useCardInteractions<T>(handlers: CardInteractionHandlers<T>) {
  function activate(event: MouseEvent): void {
    if (cardActivation(event, handlers.selectionMode()) === 'toggle') handlers.toggle(handlers.item(), event.shiftKey)
    else handlers.open(handlers.item())
  }

  function openMenuFromButton(event: MouseEvent): void {
    const button = event.currentTarget as HTMLElement
    handlers.menu(handlers.item(), menuPointFor(button), button)
  }

  /** Right-click, or the keyboard context-menu key / Shift+F10 (no pointer position: anchor at the focused element). */
  function openContextMenu(event: MouseEvent): void {
    event.preventDefault()
    const host = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    const opener = host?.querySelector<HTMLElement>('button') ?? null
    const fromKeyboard = event.clientX === 0 && event.clientY === 0 && event.button !== 2
    const point = fromKeyboard && host ? menuPointFor(host, false) : { x: event.clientX, y: event.clientY }
    handlers.menu(handlers.item(), point, opener)
  }

  return { activate, openMenuFromButton, openContextMenu }
}
