/**
 * Long-press fallback for the item menu on touch screens (iOS has no
 * `contextmenu` on long press). The pure guard decides whether a long press,
 * a contextmenu event or a click may act; the component tests drive the real
 * wiring (VueUse onLongPress + pointer listeners) on a mounted ModelRow with
 * fake timers. Written before the implementation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { ModelItem } from '@/api/types'
import {
  CONTEXTMENU_DEDUPE_MS,
  LONG_PRESS_CLICK_SUPPRESS_MS,
  LONG_PRESS_DELAY_MS,
  LONG_PRESS_DISTANCE_PX,
  cardActivation,
  createPressMenuGuard,
} from '@/composables/useCardInteractions'
import ModelRow from '@/components/ModelRow.vue'
import ModelCard from '@/components/ModelCard.vue'
import RecipeCard from '@/components/RecipeCard.vue'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('press menu guard', () => {
  it('uses the documented timings', () => {
    expect(LONG_PRESS_DELAY_MS).toBe(500)
    expect(LONG_PRESS_DISTANCE_PX).toBe(10)
    expect(CONTEXTMENU_DEDUPE_MS).toBe(700)
    expect(LONG_PRESS_CLICK_SUPPRESS_MS).toBeGreaterThan(0)
    expect(LONG_PRESS_CLICK_SUPPRESS_MS).toBeLessThanOrEqual(CONTEXTMENU_DEDUPE_MS)
  })

  it('opens the menu once per touch long press', () => {
    const guard = createPressMenuGuard()
    guard.press('touch')
    expect(guard.longPress()).toBe(true)
    expect(guard.longPress()).toBe(false)
  })

  it('swallows exactly one click after a long press', () => {
    const guard = createPressMenuGuard()
    guard.press('touch')
    expect(guard.longPress()).toBe(true)
    guard.release()
    expect(guard.click()).toBe(false)
    expect(guard.click()).toBe(true)
  })

  it('stops swallowing shortly after the release when no click came', () => {
    const guard = createPressMenuGuard()
    guard.press('touch')
    guard.longPress()
    vi.advanceTimersByTime(3000) // holding the finger down does not expire the suppression
    guard.release()
    vi.advanceTimersByTime(LONG_PRESS_CLICK_SUPPRESS_MS + 1)
    expect(guard.click()).toBe(true)
  })

  it('lets a short tap activate', () => {
    const guard = createPressMenuGuard()
    guard.press('touch')
    guard.release()
    expect(guard.click()).toBe(true)
  })

  it('ignores a long press after the browser cancelled the pointer (scrolling)', () => {
    const guard = createPressMenuGuard()
    guard.press('touch')
    guard.cancel()
    expect(guard.longPress()).toBe(false)
    guard.release()
    expect(guard.click()).toBe(true)
  })

  it('ignores mouse long presses (right-click is the mouse menu)', () => {
    const guard = createPressMenuGuard()
    guard.press('mouse')
    expect(guard.longPress()).toBe(false)
    expect(guard.contextMenu()).toBe(true)
    expect(guard.contextMenu()).toBe(true)
    guard.release()
    expect(guard.click()).toBe(true)
  })

  it('does not open twice when Android fires contextmenu after the long press', () => {
    const guard = createPressMenuGuard()
    guard.press('touch')
    expect(guard.longPress()).toBe(true)
    vi.advanceTimersByTime(100)
    expect(guard.contextMenu()).toBe(false)
  })

  it('does not open twice when contextmenu comes first (long press after it is ignored)', () => {
    const guard = createPressMenuGuard()
    guard.press('touch')
    expect(guard.contextMenu()).toBe(true)
    expect(guard.longPress()).toBe(false)
    guard.release()
    expect(guard.click()).toBe(false)
  })

  it('allows the next menu after the dedupe window', () => {
    const guard = createPressMenuGuard()
    guard.press('touch')
    guard.longPress()
    guard.release()
    vi.advanceTimersByTime(CONTEXTMENU_DEDUPE_MS + 1)
    expect(guard.contextMenu()).toBe(true)
    guard.press('touch')
    expect(guard.longPress()).toBe(true)
  })

  it('does nothing after dispose', () => {
    const guard = createPressMenuGuard()
    guard.press('touch')
    guard.dispose()
    expect(guard.longPress()).toBe(false)
  })
})

describe('card activation (quick view)', () => {
  const click = (detail: number, extra: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) => ({ ctrlKey: false, metaKey: false, detail, ...extra })

  it('opens on any click while the quick view is hidden (as before)', () => {
    for (const detail of [0, 1, 2]) expect(cardActivation(click(detail), false)).toBe('open')
  })

  it('focuses on a single click and opens on a double-click or Enter while the quick view shows', () => {
    expect(cardActivation(click(1), false, true)).toBe('focus')
    expect(cardActivation(click(2), false, true)).toBe('open')
    expect(cardActivation(click(0), false, true)).toBe('open')
  })

  it('toggles the selection while one exists or with Ctrl/Cmd or Shift (no mode switch), quick view or not', () => {
    expect(cardActivation(click(1), true, true)).toBe('toggle')
    expect(cardActivation(click(1, { ctrlKey: true }), false, true)).toBe('toggle')
    expect(cardActivation(click(2, { metaKey: true }), false, false)).toBe('toggle')
    expect(cardActivation(click(1, { shiftKey: true }), false, false)).toBe('toggle')
  })
})

function item(overrides: Partial<ModelItem> = {}): ModelItem {
  return { model_name: 'Model A', file_name: 'model-a', file_path: 'D:/loras/model-a.safetensors', folder: '', preview_url: '', base_model: 'SDXL 1.0', tags: [], ...overrides }
}

const modelProps = { item: item(), selectionMode: false, selected: false, blurMature: false, canSend: true }

function pointer(type: string, init: { x?: number; y?: number; pointerType?: string } = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x ?? 40, clientY: init.y ?? 60, button: 0 })
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'touch' })
  return event
}

type Mounted = ReturnType<typeof mount>

/** Touch down on `target`, hold `ms`, lift, and let the browser's click follow. */
async function touchPress(wrapper: Mounted, ms: number, target = wrapper.get('article > button').element) {
  target.dispatchEvent(pointer('pointerdown'))
  vi.advanceTimersByTime(ms)
  target.dispatchEvent(pointer('pointerup'))
  target.dispatchEvent(pointer('pointerleave'))
  ;(target as HTMLElement).click()
  await wrapper.vm.$nextTick()
}

describe.each([
  ['ModelRow', ModelRow],
  ['ModelCard', ModelCard],
] as const)('%s with the quick view', (_name, component) => {
  it('emits focus on a single click and open on the double-click', async () => {
    const wrapper = mount(component as never, { props: { ...modelProps, quickView: true } as never })
    const primary = wrapper.get('article > button').element
    primary.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(wrapper.emitted('focus')).toEqual([[modelProps.item]])
    expect(wrapper.emitted('open')).toBeUndefined()
    primary.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
    expect(wrapper.emitted('open')).toEqual([[modelProps.item]])
    wrapper.unmount()
  })
})

describe.each([
  ['ModelRow', ModelRow, modelProps],
  ['ModelCard', ModelCard, modelProps],
  ['RecipeCard', RecipeCard, { item: { id: 'r1', title: 'Recipe', loras: [] }, selectionMode: false, selected: false, blurMature: false }],
] as const)('%s long press', (_name, component, props) => {
  // VueUse attaches its element listeners in a post-flush watcher: wait one tick after mounting.
  async function mountIt(extra: Record<string, unknown> = {}) {
    const wrapper = mount(component as never, { props: { ...props, ...extra } as never, attachTo: document.body })
    await nextTick()
    return wrapper
  }

  it('opens the menu once at the touch point and swallows the click that follows', async () => {
    const wrapper = await mountIt()
    await touchPress(wrapper, LONG_PRESS_DELAY_MS + 50)
    const menus = wrapper.emitted('menu') ?? []
    expect(menus).toHaveLength(1)
    expect(menus[0]?.[1]).toEqual({ x: 40, y: 60 })
    expect(wrapper.emitted('open')).toBeUndefined()
    // The next tap works again.
    await touchPress(wrapper, 80)
    expect(wrapper.emitted('open')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not toggle the selection after a long press in selection mode', async () => {
    const wrapper = await mountIt({ selectionMode: true })
    await touchPress(wrapper, LONG_PRESS_DELAY_MS + 50)
    expect(wrapper.emitted('menu')).toHaveLength(1)
    expect(wrapper.emitted('toggle-select')).toBeUndefined()
    wrapper.unmount()
  })

  it('treats a short tap as a normal activation', async () => {
    const wrapper = await mountIt()
    await touchPress(wrapper, 120)
    expect(wrapper.emitted('open')).toHaveLength(1)
    expect(wrapper.emitted('menu')).toBeUndefined()
    wrapper.unmount()
  })

  it('cancels when the finger moves beyond the threshold (scrolling)', async () => {
    const wrapper = await mountIt()
    const target = wrapper.get('article > button').element
    target.dispatchEvent(pointer('pointerdown'))
    target.dispatchEvent(pointer('pointermove', { y: 60 + LONG_PRESS_DISTANCE_PX + 20 }))
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS + 100)
    expect(wrapper.emitted('menu')).toBeUndefined()
    wrapper.unmount()
  })

  it('cancels when the browser takes the pointer over (pointercancel)', async () => {
    const wrapper = await mountIt()
    const target = wrapper.get('article > button').element
    target.dispatchEvent(pointer('pointerdown'))
    target.dispatchEvent(pointer('pointercancel'))
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS + 100)
    expect(wrapper.emitted('menu')).toBeUndefined()
    wrapper.unmount()
  })

  it('opens only one menu when Android also fires contextmenu', async () => {
    const wrapper = await mountIt()
    const target = wrapper.get('article > button').element
    target.dispatchEvent(pointer('pointerdown'))
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS + 10)
    const contextmenu = pointer('contextmenu')
    target.dispatchEvent(contextmenu)
    expect(contextmenu.defaultPrevented).toBe(true)
    expect(wrapper.emitted('menu')).toHaveLength(1)
    wrapper.unmount()
  })

  it('ignores mouse long presses; right-click still opens the menu', async () => {
    const wrapper = await mountIt()
    const target = wrapper.get('article > button').element
    target.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS + 100)
    expect(wrapper.emitted('menu')).toBeUndefined()
    target.dispatchEvent(pointer('pointerup', { pointerType: 'mouse' }))
    ;(target as HTMLElement).click()
    expect(wrapper.emitted('open')).toHaveLength(1)
    await wrapper.get('article').trigger('contextmenu', { clientX: 5, clientY: 6, button: 2 })
    expect(wrapper.emitted('menu')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not open the item menu from a long press on an inner action button', async () => {
    const wrapper = await mountIt()
    const more = wrapper.get('button[aria-haspopup="menu"]').element
    more.dispatchEvent(pointer('pointerdown'))
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS + 100)
    expect(wrapper.emitted('menu')).toBeUndefined()
    wrapper.unmount()
  })
})
