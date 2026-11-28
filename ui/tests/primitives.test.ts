/**
 * Smoke tests of the adapted shadcn-vue primitives (components/ui/): they
 * open, take focus, keep Tab inside a modal, close on Escape and give focus
 * back to the trigger. Content is teleported to document.body.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ModalShell from '@/components/ModalShell.vue'
import { useConfirm } from '@/composables/useFeedback'

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushPromises()
}

const escape = () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

describe('Dialog', () => {
  const Harness = defineComponent({
    setup: () => () =>
      h(Dialog, null, {
        default: () => [
          h(DialogTrigger, { id: 'open' }, { default: () => 'Open' }),
          h(DialogContent, null, {
            default: () => [
              h(DialogTitle, null, { default: () => 'Rename' }),
              h(DialogDescription, null, { default: () => 'Pick a new name' }),
              h('input', { id: 'name' }),
              h('button', { id: 'save', type: 'button' }, 'Save'),
            ],
          }),
        ],
      }),
  })

  it('opens as a labelled modal, keeps focus inside, closes on Escape and returns focus', async () => {
    wrapper = mount(Harness, { attachTo: document.body })
    const trigger = document.getElementById('open') as HTMLButtonElement
    trigger.focus()
    trigger.click()
    await settle()

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.classList).toContain('bg-elevated')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Rename')
    expect(dialog.contains(document.activeElement)).toBe(true)
    // The close button comes from the primitive and carries a translated label.
    expect(dialog.querySelector('[aria-label="Close"]')).not.toBeNull()

    // Tab from the last focusable element wraps to the first (focus trap).
    const focusables = [...dialog.querySelectorAll<HTMLElement>('input, button')]
    focusables.at(-1)!.focus()
    focusables.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    await settle()
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(focusables[0])

    escape()
    await settle()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('Popover', () => {
  const Harness = defineComponent({
    setup: () => () =>
      h(Popover, null, {
        default: () => [
          h(PopoverTrigger, { 'data-testid': 'view' }, { default: () => 'View' }),
          h(PopoverContent, { 'aria-label': 'View options' }, { default: () => [h('button', { id: 'grid', type: 'button' }, 'Grid')] }),
        ],
      }),
  })

  it('opens next to its trigger, takes focus, closes on Escape and returns focus', async () => {
    wrapper = mount(Harness, { attachTo: document.body })
    const trigger = document.querySelector('[data-testid="view"]') as HTMLButtonElement
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    trigger.focus()
    trigger.click()
    await settle()

    const content = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')!
    expect(content).not.toBeNull()
    expect(content.getAttribute('aria-label')).toBe('View options')
    expect(content.classList).toContain('rounded-md')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(content.contains(document.activeElement)).toBe(true)

    escape()
    await settle()
    expect(document.body.querySelector('[data-slot="popover-content"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

// --- Shells built on the primitives (Phase 2): same props, slots and events as the native <dialog> versions.

describe('ModalShell', () => {
  const Host = defineComponent({
    props: { busy: Boolean },
    emits: ['close'],
    setup: (props, { emit }) => () =>
      h(ModalShell, { title: 'Rename', titleId: 'rename-title', busy: props.busy, onClose: () => emit('close') }, { default: () => [h('input', { id: 'name' })] }),
  })

  it('is a modal labelled by its title id; Escape closes unless busy', async () => {
    wrapper = mount(Host, { props: { busy: true }, attachTo: document.body })
    await settle()
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Rename')
    expect(dialog.getAttribute('aria-labelledby')).toBe('rename-title')
    expect(dialog.contains(document.activeElement)).toBe(true)
    escape()
    await settle()
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.setProps({ busy: false })
    escape()
    await settle()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('ConfirmDialog', () => {
  it('starts on Cancel, answers true on confirm and false on Escape', async () => {
    wrapper = mount(ConfirmDialog, { attachTo: document.body })
    const { confirm } = useConfirm()
    const first = confirm({ title: 'Delete?', message: 'Gone for good', confirmLabel: 'Delete', danger: true })
    await settle()
    const dialog = document.body.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(dialog.textContent).toContain('Gone for good')
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel')
    escape()
    await expect(first).resolves.toBe(false)
    await settle()
    const second = confirm({ message: 'Sure?', confirmLabel: 'Yes' })
    await settle()
    document.body.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
    await expect(second).resolves.toBe(true)
  })
})
