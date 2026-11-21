import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import {
  createBackdropGuard,
  createLayerStack,
  isBackdropHit,
  isOutsideAll,
  isOutsideRect,
  type PointerLike,
} from '@/utils/dismiss'
import { dismissStack, useDismissLayer } from '@/composables/useDismiss'

const backdropEl = {} as EventTarget
const childEl = {} as EventTarget
const box = { left: 100, top: 100, right: 300, bottom: 300 }

function ev(target: EventTarget, x = 0, y = 0, currentTarget: EventTarget = backdropEl): PointerLike {
  return { target, currentTarget, clientX: x, clientY: y }
}

describe('backdrop hit', () => {
  it('counts only the backdrop element itself', () => {
    expect(isBackdropHit(ev(backdropEl))).toBe(true)
    expect(isBackdropHit(ev(childEl))).toBe(false)
  })

  it('with a dialog box, requires the point to be outside it', () => {
    expect(isOutsideRect(50, 200, box)).toBe(true)
    expect(isOutsideRect(200, 200, box)).toBe(false)
    expect(isBackdropHit(ev(backdropEl, 50, 50), box)).toBe(true)
    // The dialog's own padding: target is the dialog, but inside its box.
    expect(isBackdropHit(ev(backdropEl, 110, 110), box)).toBe(false)
  })
})

describe('createBackdropGuard', () => {
  it('closes when pointerdown and click both land on the backdrop', () => {
    const guard = createBackdropGuard()
    guard.pointerdown(ev(backdropEl))
    expect(guard.click(ev(backdropEl))).toBe(true)
  })

  it('ignores a drag or text selection that started inside the content', () => {
    const guard = createBackdropGuard()
    guard.pointerdown(ev(childEl))
    // The browser may retarget the click to the common ancestor (the backdrop).
    expect(guard.click(ev(backdropEl))).toBe(false)
  })

  it('ignores a click on the content and needs a fresh pointerdown each time', () => {
    const guard = createBackdropGuard()
    guard.pointerdown(ev(backdropEl))
    expect(guard.click(ev(childEl))).toBe(false)
    expect(guard.click(ev(backdropEl))).toBe(false)
  })

  it('uses the content rect for native dialogs', () => {
    const guard = createBackdropGuard(() => box)
    guard.pointerdown(ev(backdropEl, 150, 150))
    expect(guard.click(ev(backdropEl, 150, 150))).toBe(false)
    guard.pointerdown(ev(backdropEl, 10, 10))
    expect(guard.click(ev(backdropEl, 10, 10))).toBe(true)
  })
})

describe('isOutsideAll', () => {
  it('checks every root and ignores missing ones', () => {
    const root = document.createElement('div')
    const inner = document.createElement('span')
    root.appendChild(inner)
    const other = document.createElement('p')
    expect(isOutsideAll(inner, [root, null])).toBe(false)
    expect(isOutsideAll(root, [root])).toBe(false)
    expect(isOutsideAll(other, [root, undefined])).toBe(true)
    expect(isOutsideAll(null, [root])).toBe(false)
  })
})

describe('createLayerStack', () => {
  it('escape closes only the topmost layer', () => {
    const stack = createLayerStack()
    const drawer = vi.fn()
    const lightbox = vi.fn()
    stack.push({ id: 1, escape: true, close: drawer })
    stack.push({ id: 2, escape: true, close: lightbox })
    expect(stack.isTop(2)).toBe(true)
    expect(stack.escape()).toBe(true)
    expect(lightbox).toHaveBeenCalledWith('escape')
    expect(drawer).not.toHaveBeenCalled()
    stack.remove(2)
    expect(stack.isTop(1)).toBe(true)
  })

  it('leaves Escape to a native dialog on top (escape: false)', () => {
    const stack = createLayerStack()
    const drawer = vi.fn()
    stack.push({ id: 1, escape: true, close: drawer })
    stack.push({ id: 2, escape: false, close: vi.fn() })
    expect(stack.escape()).toBe(false)
    expect(drawer).not.toHaveBeenCalled()
  })

  it('re-pushing a layer moves it to the top without duplicates', () => {
    const stack = createLayerStack()
    stack.push({ id: 1, escape: true, close: vi.fn() })
    stack.push({ id: 2, escape: true, close: vi.fn() })
    stack.push({ id: 1, escape: true, close: vi.fn() })
    expect(stack.size()).toBe(2)
    expect(stack.isTop(1)).toBe(true)
  })
})

describe('useDismissLayer', () => {
  const wrappers: VueWrapper[] = []
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    document.body.innerHTML = ''
  })

  function layer(open: { value: boolean }, close: (reason: string) => void, withOutside = false) {
    const root = document.createElement('div')
    document.body.appendChild(root)
    let api: ReturnType<typeof useDismissLayer> | undefined
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useDismissLayer({
            active: () => open.value,
            close,
            outside: withOutside ? () => [root] : undefined,
          })
          return () => h('div')
        },
      }),
    )
    wrappers.push(wrapper)
    return { root, api: api! }
  }

  function escape(): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  }

  it('Escape closes only the topmost open layer', async () => {
    const drawerClose = vi.fn()
    const lightboxClose = vi.fn()
    const lightboxOpen = ref(false)
    layer(ref(true), drawerClose)
    layer(lightboxOpen, lightboxClose)
    lightboxOpen.value = true
    await nextTick()
    escape()
    expect(lightboxClose).toHaveBeenCalledWith('escape')
    expect(drawerClose).not.toHaveBeenCalled()
    lightboxOpen.value = false
    await nextTick()
    escape()
    expect(drawerClose).toHaveBeenCalledTimes(1)
  })

  it('outside pointerdown closes a popover only when it is topmost', async () => {
    const popoverClose = vi.fn()
    const { root } = layer(ref(true), popoverClose, true)
    const dialogOpen = ref(true)
    layer(dialogOpen, vi.fn())
    await nextTick()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(popoverClose).not.toHaveBeenCalled()
    dialogOpen.value = false
    await nextTick()
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(popoverClose).not.toHaveBeenCalled()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(popoverClose).toHaveBeenCalledWith('outside')
  })

  it('backdrop handlers close the topmost layer only', async () => {
    const lowerClose = vi.fn()
    const upperClose = vi.fn()
    const lower = layer(ref(true), lowerClose)
    layer(ref(true), upperClose)
    await nextTick()
    const target = document.createElement('div')
    lower.api.backdrop.pointerdown(ev(target, 0, 0, target))
    lower.api.backdrop.click(ev(target, 0, 0, target))
    expect(lowerClose).not.toHaveBeenCalled()
  })

  it('unregisters on unmount', () => {
    const before = dismissStack.size()
    layer(ref(true), vi.fn())
    expect(dismissStack.size()).toBe(before + 1)
    wrappers.pop()!.unmount()
    expect(dismissStack.size()).toBe(before)
  })
})
