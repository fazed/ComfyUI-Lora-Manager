import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createLayerStack, isOutsideAll } from '@/utils/dismiss'
import { dismissStack, useDismissLayer } from '@/composables/useDismiss'

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
    stack.push({ id: 1, close: drawer })
    stack.push({ id: 2, close: lightbox })
    expect(stack.isTop(2)).toBe(true)
    expect(stack.escape()).toBe(true)
    expect(lightbox).toHaveBeenCalledWith('escape')
    expect(drawer).not.toHaveBeenCalled()
    stack.remove(2)
    expect(stack.isTop(1)).toBe(true)
  })

  it('re-pushing a layer moves it to the top without duplicates', () => {
    const stack = createLayerStack()
    stack.push({ id: 1, close: vi.fn() })
    stack.push({ id: 2, close: vi.fn() })
    stack.push({ id: 1, close: vi.fn() })
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
    const wrapper = mount(
      defineComponent({
        setup() {
          useDismissLayer({
            active: () => open.value,
            close,
            outside: withOutside ? () => [root] : undefined,
          })
          return () => h('div')
        },
      }),
    )
    wrappers.push(wrapper)
    return { root }
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

  it('stands back while a Reka layer (components/ui/) is open above it', async () => {
    const drawerClose = vi.fn()
    layer(ref(true), drawerClose, true)
    await nextTick()
    // A Reka dialog / popover / menu marks its content with data-state="open" and handles Escape itself.
    const reka = document.createElement('div')
    reka.setAttribute('role', 'dialog')
    reka.setAttribute('data-state', 'open')
    document.body.appendChild(reka)
    escape()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(drawerClose).not.toHaveBeenCalled()
    for (const role of ['alertdialog', 'menu']) {
      reka.setAttribute('role', role)
      escape()
      expect(drawerClose).not.toHaveBeenCalled()
    }
    reka.setAttribute('data-state', 'closed')
    escape()
    expect(drawerClose).toHaveBeenCalledWith('escape')
  })

  it('unregisters on unmount', () => {
    const before = dismissStack.size()
    layer(ref(true), vi.fn())
    expect(dismissStack.size()).toBe(before + 1)
    wrappers.pop()!.unmount()
    expect(dismissStack.size()).toBe(before)
  })
})
