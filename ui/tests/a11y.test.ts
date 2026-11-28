/**
 * Phase 6f accessibility pass: modal semantics of the overlay primitives,
 * the keyboard route to a toast's Undo, disabled controls without opacity,
 * the global reduced-motion rule, no hard-coded durations or red literals,
 * and the note when the highlight colour was adjusted for contrast.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import ThemeOptions from '@/components/ThemeOptions.vue'
import ToastHost from '@/components/ToastHost.vue'
import { useAppearance } from '@/composables/useAppearance'
import { useToasts } from '@/composables/useFeedback'
import { SHORTCUTS } from '@/config/shortcuts'

const src = resolve(__dirname, '../src')
const read = (path: string) => readFileSync(resolve(src, path), 'utf8')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : /\.(vue|ts|css)$/.test(name) ? [path] : []
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('overlay primitives', () => {
  it.each([
    ['Dialog', Dialog, DialogContent, DialogTitle],
    ['AlertDialog', AlertDialog, AlertDialogContent, AlertDialogTitle],
    ['Sheet', Sheet, SheetContent, SheetTitle],
  ] as const)('%s content is an aria-modal dialog', async (_name, Root, Content, Title) => {
    const wrapper = mount(
      defineComponent({ setup: () => () => h(Root, { open: true }, { default: () => h(Content, null, { default: () => [h(Title, null, { default: () => 'Title' }), h('button', 'OK')] }) }) }),
      { attachTo: document.body },
    )
    await flushPromises()
    const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    wrapper.unmount()
  })
})

describe('toast keyboard route', () => {
  it('Alt+T moves focus to the newest Undo; acting on it returns focus', async () => {
    const toasts = useToasts()
    toasts.toasts.value.forEach((toast) => toasts.dismiss(toast.id))
    const wrapper = mount(ToastHost, { attachTo: document.body })
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    origin.focus()
    let undone = 0
    toasts.push('Moved 3 models', 'success', 30000, { label: 'Undo', run: () => undone++ })
    await nextTick()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '†', code: 'KeyT', altKey: true, bubbles: true, cancelable: true }))
    const undo = document.activeElement as HTMLButtonElement
    expect(undo.textContent?.trim()).toBe('Undo')
    expect(undo.getAttribute('aria-keyshortcuts')).toBe(SHORTCUTS.toasts.aria)

    undo.click()
    await flushPromises()
    expect(undone).toBe(1)
    expect(toasts.toasts.value).toHaveLength(0)
    expect(document.activeElement).toBe(origin)
    wrapper.unmount()
  })
})

describe('disabled controls and motion', () => {
  it('dims disabled buttons and switches with tokens, never with opacity', () => {
    const css = read('styles/app.css')
    const rule = (selector: string) => css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)))
    for (const selector of ['.lm-btn:disabled', '.lm-switch:disabled {']) {
      expect(rule(selector)).not.toMatch(/opacity/)
      expect(rule(selector)).toMatch(/text-muted|bg-field-disabled/)
    }
  })

  it('stops every animation and transition under prefers-reduced-motion (spinners keep turning)', () => {
    const css = read('themes/base.css')
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    for (const token of ['--lm-motion-fast: 0ms', '--lm-motion-normal: 0ms', '--lm-fade-duration: 0ms', '--lm-card-zoom: 1']) expect(block).toContain(token)
    expect(block).toMatch(/\*,\s*::before,\s*::after \{[^}]*animation-duration: 0\.01ms !important;[^}]*transition-duration: 0ms !important;/)
    expect(block).toMatch(/\.animate-spinner \{[^}]*animation-iteration-count: infinite !important;/)
  })

  it('has no hard-coded transition durations and no red literals outside the theme files', () => {
    const offenders = walk(src)
      .filter((file) => !file.includes(`${join('src', 'themes')}`) && !file.endsWith('tokens.css'))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8')
        const hits = [
          ...text.matchAll(/duration-\[?\d|transition[^;\n]*\b\d+(\.\d+)?m?s\b/g),
          ...text.matchAll(/\b(text|bg|border|ring|fill|stroke|outline)-red\b|\bred-\d{2,3}\b|#f{1,2}0{2,4}\b|rgb\(\s*255\s*,\s*0\s*,\s*0/gi),
        ]
        return hits.map((hit) => `${file}: ${hit[0]}`)
      })
    expect(offenders).toEqual([])
  })
})

describe('highlight picker', () => {
  it('says when a custom colour was adjusted for contrast', async () => {
    const appearance = useAppearance()
    const wrapper = mount(ThemeOptions)
    appearance.setHighlight('#ffffff')
    await nextTick()
    const note = wrapper.get('[data-testid="highlight-adjusted"]')
    expect(note.attributes('role')).toBe('status')
    expect(note.text()).toMatch(/Adjusted to #[0-9a-f]{6}/)

    appearance.setHighlight('#1d5fa8')
    await nextTick()
    expect(wrapper.find('[data-testid="highlight-adjusted"]').exists()).toBe(false)
    appearance.setHighlight('mono')
    wrapper.unmount()
  })
})
