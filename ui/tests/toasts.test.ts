/**
 * Toasts: five kept, auto-dismiss timers that pause while the host is hovered
 * or focused and resume with the time that was left (review A9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useToasts } from '@/composables/useFeedback'
import ToastHost from '@/components/ToastHost.vue'

const toasts = useToasts()

beforeEach(() => {
  vi.useFakeTimers()
  toasts.release()
  toasts.toasts.value.forEach((toast) => toasts.dismiss(toast.id))
})
afterEach(() => vi.useRealTimers())

describe('useToasts', () => {
  it('keeps the five newest toasts', () => {
    for (let i = 1; i <= 7; i++) toasts.push(`toast ${i}`)
    expect(toasts.toasts.value.map((toast) => toast.message)).toEqual(['toast 3', 'toast 4', 'toast 5', 'toast 6', 'toast 7'])
  })

  it('pauses every timer while held and resumes with the remaining time', () => {
    toasts.push('undo me', 'success', 1000)
    vi.advanceTimersByTime(600)
    toasts.hold()
    vi.advanceTimersByTime(5000)
    expect(toasts.toasts.value).toHaveLength(1)
    toasts.release()
    vi.advanceTimersByTime(399)
    expect(toasts.toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(toasts.toasts.value).toHaveLength(0)
  })

  it('starts a toast pushed while held only on release', () => {
    toasts.hold()
    toasts.push('later', 'info', 500)
    vi.advanceTimersByTime(2000)
    expect(toasts.toasts.value).toHaveLength(1)
    toasts.release()
    vi.advanceTimersByTime(500)
    expect(toasts.toasts.value).toHaveLength(0)
  })
})

describe('ToastHost', () => {
  it('holds the timers on hover and on focus, and runs the action once', async () => {
    const run = vi.fn()
    const wrapper = mount(ToastHost, { attachTo: document.body })
    toasts.push('Deleted', 'success', 1000, { label: 'Undo', run })
    await nextTick()
    const host = wrapper.get('[data-toast-host]')
    await host.trigger('pointerenter')
    vi.advanceTimersByTime(3000)
    expect(toasts.toasts.value).toHaveLength(1)
    await host.trigger('pointerleave')
    await host.trigger('focusin')
    vi.advanceTimersByTime(3000)
    expect(toasts.toasts.value).toHaveLength(1)
    const undo = wrapper.findAll('button').find((button) => button.text() === 'Undo')!
    await undo.trigger('click')
    expect(run).toHaveBeenCalledTimes(1)
    expect(toasts.toasts.value).toHaveLength(0)
    wrapper.unmount()
  })
})
