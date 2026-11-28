/**
 * App shell: the icon rail (entries, names, active state, no pages the UI
 * does not have) and the global search dialog it opens (rail button, `/`,
 * Ctrl/Cmd+K). Overlay content is teleported to document.body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppRail from '@/components/AppRail.vue'
import { setFetch } from '@/api/http'
import { routes } from '@/router'
import { SHORTCUTS } from '@/config/shortcuts'
import { useToasts } from '@/composables/useFeedback'
import { t } from '@/i18n'

let wrapper: VueWrapper | null = null

beforeEach(() => {
  // Queue poll and update counts: empty answers, nothing else is fetched.
  setFetch(vi.fn(async () => new Response(JSON.stringify({ success: true, queue: [], groups: [], totals: {} }), { status: 200 })))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  setFetch(null)
  document.body.innerHTML = ''
})

async function mountRail(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  wrapper = mount(AppRail, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { rail: wrapper.get('nav[aria-label="Main navigation"]'), router }
}

describe('icon rail', () => {
  it('names every entry and marks only the current page', async () => {
    const { rail } = await mountRail('/checkpoints')
    const entries = rail.findAll('a, button')
    expect(entries.length).toBeGreaterThan(10)
    for (const entry of entries) expect(entry.attributes('aria-label')?.trim()).toBeTruthy()
    const current = rail.findAll('[aria-current="page"]')
    expect(current.map((entry) => entry.attributes('aria-label'))).toEqual(['Checkpoints'])
  })

  it('lists the libraries, Updates, Downloads, Statistics, Search, Appearance, Settings, Diagnostics, Help, Notifications, Support and the classic UI', async () => {
    const { rail } = await mountRail('/loras')
    const hrefs = rail.findAll('a').map((link) => link.attributes('href'))
    expect(hrefs).toEqual(['/loras', '/loras', '/checkpoints', '/embeddings', '/recipes', '/updates', '/downloads', '/stats', '/settings', '/doctor', '/loras'])
    const labels = rail.findAll('button').map((button) => button.attributes('aria-label'))
    expect(labels).toEqual(['Search all libraries', 'Appearance', 'Help', 'Notifications', 'Support LoRA Manager'])
    // Decision D3: no rail entries for pages the modern UI does not have.
    expect(rail.text()).not.toMatch(/Workflows|Wildcards|Other/)
  })

  it('marks Settings and Diagnostics on their pages (sub-paths included)', async () => {
    const { rail, router } = await mountRail('/settings/library')
    expect(rail.get('[aria-current="page"]').attributes('aria-label')).toBe('Settings')
    await router.push('/doctor')
    await flushPromises()
    expect(rail.get('[aria-current="page"]').attributes('aria-label')).toBe('Diagnostics')
  })

  it('opens the appearance options next to the rail', async () => {
    const { rail } = await mountRail('/loras')
    await rail.get('button[aria-label="Appearance"]').trigger('click')
    await flushPromises()
    const popover = new DOMWrapper(document.body).get('[role="dialog"][aria-label="Appearance"]')
    expect(popover.text()).toContain('Theme')
    expect(popover.text()).toContain('Text size')
  })
})

describe('rail dialogs', () => {
  const body = () => new DOMWrapper(document.body)

  it('Help lists every shortcut of config/shortcuts.ts and links the wiki in a new tab', async () => {
    const { rail } = await mountRail('/loras')
    await rail.get('button[aria-label="Help"]').trigger('click')
    await flushPromises()
    const dialog = body().get('[role="dialog"]')
    expect(dialog.attributes('aria-labelledby')).toBe('help-dialog-title')
    for (const entry of Object.values(SHORTCUTS)) expect(dialog.text()).toContain(t(entry.label))
    const docsTab = dialog.findAll('[role="tab"]').find((tab) => tab.text() === 'Documentation')!
    // Reka tabs activate on mousedown (left button).
    await docsTab.trigger('mousedown', { button: 0 })
    await flushPromises()
    const links = body().findAll('[role="dialog"] a[href^="https://github.com/willmiao/ComfyUI-Lora-Manager/wiki"]')
    expect(links.length).toBeGreaterThan(5)
    for (const link of links) {
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toBe('noopener noreferrer')
    }
  })

  it('opens Help with ? outside text fields', async () => {
    await mountRail('/loras')
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }))
    await flushPromises()
    expect(body().get('[role="dialog"]').attributes('aria-labelledby')).toBe('help-dialog-title')
    expect(body().get('[role="dialog"]').text()).toContain(t('shortcuts.send'))
  })

  it('Notifications lists the session messages and Support opens external links safely', async () => {
    useToasts().push('Moved 3 models', 'success')
    const { rail } = await mountRail('/loras')
    await rail.get('button[aria-label="Notifications"]').trigger('click')
    await flushPromises()
    const tab = body().findAll('[role="dialog"] [role="tab"]').find((entry) => entry.text() === 'Messages')!
    await tab.trigger('mousedown', { button: 0 })
    await flushPromises()
    expect(body().get('[role="dialog"]').text()).toContain('Moved 3 models')
    await body().get('[role="dialog"] button[aria-label="Close"]').trigger('click')
    await flushPromises()
    await rail.get('button[aria-label="Support LoRA Manager"]').trigger('click')
    await flushPromises()
    const links = body().findAll('[role="dialog"] a')
    expect(links.length).toBe(6)
    for (const link of links) expect(link.attributes('rel')).toBe('noopener noreferrer')
  })
})

describe('global search dialog', () => {
  const body = () => new DOMWrapper(document.body)
  const searchDialog = () => body().find('[role="dialog"] #global-search')

  it('opens from the rail button, `/` and Ctrl+K, but not while typing', async () => {
    const { rail } = await mountRail('/loras')
    await rail.get('button[aria-label="Search all libraries"]').trigger('click')
    await flushPromises()
    expect(searchDialog().exists()).toBe(true)
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(searchDialog().exists()).toBe(false)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(searchDialog().exists()).toBe(false)

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(searchDialog().exists()).toBe(true)
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    await flushPromises()
    expect(searchDialog().exists()).toBe(true)
  })
})
