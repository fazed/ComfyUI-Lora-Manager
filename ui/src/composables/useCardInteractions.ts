/**
 * Pointer handling shared by the library cards, list rows and recipe cards:
 * primary click (open, or toggle the selection in selection mode and with
 * Ctrl/Cmd), the "..." menu button, right-click and the touch long press.
 * Right-click always opens the menu, also in selection mode: the page decides
 * which menu (item or selection) it shows.
 *
 * Long press: iOS fires no `contextmenu` on a long press, so a touch/pen
 * long press (VueUse `onLongPress`) opens the same menu at the touch point.
 * `createPressMenuGuard` (pure, unit-tested) keeps that from colliding with
 * the browser: the click that follows a long press is swallowed once, and
 * Android's own `contextmenu` for the same press does not open a second menu
 * (in either order).
 */
import type { Ref } from 'vue'
import { onLongPress, tryOnScopeDispose, useEventListener } from '@vueuse/core'

export type MenuPoint = { x: number; y: number }

/** Hold time before a touch press opens the menu (the platform default is about 500 ms). */
export const LONG_PRESS_DELAY_MS = 500
/** Moving the finger this far cancels the long press: it is a scroll, not a press. */
export const LONG_PRESS_DISTANCE_PX = 10
/** A contextmenu this soon after a long-press menu (or the reverse) belongs to the same press. */
export const CONTEXTMENU_DEDUPE_MS = 700
/** How long after the finger lifts the click of a long press is still expected (and swallowed). */
export const LONG_PRESS_CLICK_SUPPRESS_MS = 500

export interface CardInteractionHandlers<T> {
  item: () => T
  selectionMode: () => boolean
  open: (item: T) => void
  /** shift = Shift+click: select a range from the last toggled card. */
  toggle: (item: T, shift: boolean) => void
  menu: (item: T, point: MenuPoint, opener: HTMLElement | null) => void
  /** The card/row root: enables the touch long-press menu. */
  target?: Readonly<Ref<HTMLElement | null>>
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

export interface PressMenuGuard {
  /** pointerdown: a new press starts. */
  press(pointerType: string): void
  /** pointerup / pointerleave: the press ended. */
  release(): void
  /** pointercancel: the browser took the pointer over (scrolling). */
  cancel(): void
  /** The long-press timer fired: true when the menu should open. */
  longPress(): boolean
  /** A contextmenu event: true when the menu should open. */
  contextMenu(): boolean
  /** A click on the card: false when it is the click of a long press (swallowed once). */
  click(): boolean
  dispose(): void
}

/**
 * Decides whether a long press, a contextmenu event or a click may act. Timing
 * and the distance threshold of the long press itself are VueUse's
 * `onLongPress`; this only de-duplicates. Uses `setTimeout`
 * (fake timers in tests).
 */
export function createPressMenuGuard(): PressMenuGuard {
  let pressing = false
  let touch = false
  let cancelled = false
  let openedThisPress = false
  let recentlyOpened = false
  let swallowClick = false
  let disposed = false
  let resetTimer: ReturnType<typeof setTimeout> | undefined
  let dedupeTimer: ReturnType<typeof setTimeout> | undefined

  function clearReset(): void {
    if (resetTimer !== undefined) clearTimeout(resetTimer)
    resetTimer = undefined
  }

  function markOpened(): void {
    openedThisPress = true
    swallowClick = true
    clearReset()
    recentlyOpened = true
    if (dedupeTimer !== undefined) clearTimeout(dedupeTimer)
    dedupeTimer = setTimeout(() => {
      recentlyOpened = false
      dedupeTimer = undefined
    }, CONTEXTMENU_DEDUPE_MS)
  }

  return {
    press(pointerType) {
      pressing = true
      touch = pointerType !== 'mouse'
      cancelled = false
      openedThisPress = false
    },
    release() {
      pressing = false
      openedThisPress = false
      if (!swallowClick) return
      clearReset()
      // The click follows the release at once; if none comes, stop waiting for it.
      resetTimer = setTimeout(() => {
        swallowClick = false
        resetTimer = undefined
      }, LONG_PRESS_CLICK_SUPPRESS_MS)
    },
    cancel() {
      cancelled = true
      pressing = false
    },
    longPress() {
      if (disposed || !touch || cancelled || openedThisPress || recentlyOpened) return false
      markOpened()
      return true
    },
    contextMenu() {
      if (disposed) return false
      if (openedThisPress || recentlyOpened) return false
      // Android: the browser's long-press contextmenu came before our timer.
      if (pressing && touch && !cancelled) markOpened()
      return true
    },
    click() {
      if (!swallowClick) return true
      swallowClick = false
      clearReset()
      return false
    },
    dispose() {
      disposed = true
      clearReset()
      if (dedupeTimer !== undefined) clearTimeout(dedupeTimer)
    },
  }
}

export function useCardInteractions<T>(handlers: CardInteractionHandlers<T>) {
  const guard = createPressMenuGuard()
  tryOnScopeDispose(() => guard.dispose())

  function activate(event: MouseEvent): void {
    if (!guard.click()) {
      event.preventDefault()
      return
    }
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
    if (!guard.contextMenu()) return
    const host = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    const opener = host?.querySelector<HTMLElement>('button') ?? null
    const fromKeyboard = event.clientX === 0 && event.clientY === 0 && event.button !== 2
    const point = fromKeyboard && host ? menuPointFor(host, false) : { x: event.clientX, y: event.clientY }
    handlers.menu(handlers.item(), point, opener)
  }

  if (handlers.target) {
    const target = handlers.target
    const host = () => target.value
    useEventListener(target, 'pointerdown', (event: PointerEvent) => guard.press(event.pointerType))
    useEventListener(target, ['pointerup', 'pointerleave'], () => guard.release())
    useEventListener(target, 'pointercancel', () => guard.cancel())
    onLongPress(
      target,
      (event) => {
        const root = host()
        // The primary full-size button (first button) carries the card; a long press on an inner
        // action button (send, favorite, "...") is not a card long press.
        const primary = root?.querySelector<HTMLElement>('button') ?? null
        const control = (event.target as Element | null)?.closest?.('button, a, input, select, textarea')
        if (control && control !== primary) return
        if (!guard.longPress()) return
        handlers.menu(handlers.item(), { x: event.clientX, y: event.clientY }, primary)
      },
      { delay: LONG_PRESS_DELAY_MS, distanceThreshold: LONG_PRESS_DISTANCE_PX },
    )
  }

  return { activate, openMenuFromButton, openContextMenu }
}
