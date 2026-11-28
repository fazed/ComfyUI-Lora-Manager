/**
 * Model details flyout: the pure helpers (mature-content blur rule, usage-tip
 * chips and edits, tab keyboard navigation, discard-notes decision, the current
 * version, version badges, licence chips) and the mounted flyout (a tab or
 * thumbnail change leaves the header and info column alone, prev / next, the
 * Sheet's focus handling, the ?open= deep link). Every backend call is mocked.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { setFetch } from '@/api/http'
import { createModelApi } from '@/api/endpoints'
import type { ModelItem } from '@/api/types'
import ModelDrawer from '@/components/ModelDrawer.vue'
import { useConfirm } from '@/composables/useFeedback'
import { clearBrowseView } from '@/utils/browse'
import { isBlurred } from '@/utils/mature'
import { usageTipEntries } from '@/utils/workflow'
import { currentVersionId, licenceLabels, nextTab, shortHash, shouldConfirmClose, versionFlags, withUsageTip } from '@/utils/drawer'
import type { NavState } from '@/utils/drawerNav'

describe('isBlurred', () => {
  it('blurs levels >= 4 only while the setting is on', () => {
    expect(isBlurred(4, true)).toBe(true)
    expect(isBlurred(16, true)).toBe(true)
    expect(isBlurred(2, true)).toBe(false)
    expect(isBlurred(8, false)).toBe(false)
  })
  it('treats a missing level as safe', () => {
    expect(isBlurred(undefined, true)).toBe(false)
    expect(isBlurred(null, true)).toBe(false)
  })
})

describe('usageTipEntries', () => {
  it('lists strength and clip strength first, from a JSON string', () => {
    const entries = usageTipEntries('{"clip_strength": 1, "strength": 0.8}')
    expect(entries.map((entry) => entry.text)).toEqual(['strength 0.8', 'clip 1'])
    expect(entries[0].strength).toBe(0.8)
    expect(entries[1].strength).toBeNull()
  })
  it('shows other scalar tips and skips objects, arrays and empty values', () => {
    const entries = usageTipEntries({ sampler: 'euler a', nested: { a: 1 }, list: [1], empty: '', flag: true })
    expect(entries.map((entry) => entry.text)).toEqual(['sampler euler a', 'flag true'])
  })
  it('returns nothing for empty or invalid tips', () => {
    expect(usageTipEntries('{}')).toEqual([])
    expect(usageTipEntries('nope')).toEqual([])
    expect(usageTipEntries(undefined)).toEqual([])
  })
})

describe('nextTab', () => {
  it('moves with the arrow keys and wraps', () => {
    expect(nextTab('ArrowRight', 0, 3)).toBe(1)
    expect(nextTab('ArrowRight', 2, 3)).toBe(0)
    expect(nextTab('ArrowLeft', 0, 3)).toBe(2)
    expect(nextTab('ArrowLeft', 2, 3)).toBe(1)
  })
  it('jumps with Home and End', () => {
    expect(nextTab('Home', 2, 3)).toBe(0)
    expect(nextTab('End', 0, 3)).toBe(2)
  })
  it('ignores other keys and empty lists', () => {
    expect(nextTab('Enter', 1, 3)).toBeNull()
    expect(nextTab('ArrowRight', 0, 0)).toBeNull()
  })
})

describe('shouldConfirmClose', () => {
  it('asks only while there are unsaved notes', () => {
    expect(shouldConfirmClose(true)).toBe(true)
    expect(shouldConfirmClose(false)).toBe(false)
  })
})

describe('currentVersionId', () => {
  it('prefers the item version, then the metadata id', () => {
    expect(currentVersionId({ civitai: { id: 5 } }, { id: 9 })).toBe(5)
    expect(currentVersionId({ civitai: undefined }, { id: 9 })).toBe(9)
    expect(currentVersionId({}, null)).toBeNull()
  })
})

describe('withUsageTip', () => {
  it('sets a tip as a number when numeric and keeps the others', () => {
    expect(JSON.parse(withUsageTip({ strength: 0.8 }, 'clip_skip', '2'))).toEqual({ strength: 0.8, clip_skip: 2 })
    expect(JSON.parse(withUsageTip({}, 'strength_range', '0.6-0.9'))).toEqual({ strength_range: '0.6-0.9' })
  })
  it('removes a tip, both spellings of clip strength for the clip entry', () => {
    expect(JSON.parse(withUsageTip({ strength: 0.8, clipStrength: 1, clip_strength: 1 }, 'clip', null))).toEqual({ strength: 0.8 })
    expect(JSON.parse(withUsageTip({ strength: 0.8, sampler: 'euler' }, 'sampler', null))).toEqual({ strength: 0.8 })
  })
  it('never stores an empty value', () => {
    expect(JSON.parse(withUsageTip({ strength: 1 }, 'strength', '  '))).toEqual({})
  })
})

describe('shortHash', () => {
  it('keeps the first 10 and last 6 characters of a long hash', () => {
    expect(shortHash('0123456789abcdef0123456789abcdef')).toBe('0123456789…abcdef')
    expect(shortHash('abc')).toBe('abc')
  })
})

describe('versionFlags', () => {
  const now = Date.parse('2026-06-10')
  it('marks versions released after the current one as newer', () => {
    expect(versionFlags({ releasedAt: '2026-06-01' }, '2026-01-01', now).newer).toBe(true)
    expect(versionFlags({ releasedAt: '2025-06-01' }, '2026-01-01', now).newer).toBe(false)
    expect(versionFlags({ releasedAt: '2026-06-01' }, undefined, now).newer).toBe(false)
  })
  it('reports paid and an ended early-access window', () => {
    expect(versionFlags({ isPaid: true }, undefined, now).paid).toBe(true)
    expect(versionFlags({ earlyAccessEndsAt: '2026-06-01' }, undefined, now).freeNow).toBe(true)
    expect(versionFlags({ earlyAccessEndsAt: '2026-07-01' }, undefined, now).freeNow).toBe(false)
    expect(versionFlags({ isEarlyAccess: true, earlyAccessEndsAt: '2026-06-01' }, undefined, now).freeNow).toBe(false)
  })
})

describe('licenceLabels', () => {
  it('shows nothing without licence fields', () => {
    expect(licenceLabels(undefined)).toEqual([])
    expect(licenceLabels({})).toEqual([])
  })
  it('reads credit and the commercial-use list', () => {
    expect(licenceLabels({ allowNoCredit: false, allowCommercialUse: ['Image', 'RentCivit'] })).toEqual([
      { key: 'credit', allowed: false },
      { key: 'sellImages', allowed: true },
      { key: 'sellModel', allowed: false },
    ])
    expect(licenceLabels({ allowCommercialUse: 'Sell' }).find((entry) => entry.key === 'sellModel')?.allowed).toBe(true)
  })
})

// --- the mounted flyout -------------------------------------------------------------

const ITEM = {
  model_name: 'Alpha',
  file_name: 'alpha',
  file_path: 'D:/loras/alpha.safetensors',
  folder: '',
  preview_url: '',
  base_model: 'SDXL',
  tags: ['style'],
  sha256: 'a'.repeat(64),
  usage_tips: '{"strength": 0.8}',
  civitai: { modelId: 5, id: 50 },
} as ModelItem

const METADATA = {
  id: 50,
  modelId: 5,
  images: [
    { url: 'https://img.test/1.png', meta: { prompt: 'first prompt' } },
    { url: 'https://img.test/2.png', meta: { prompt: 'second prompt' } },
  ],
  model: { description: '<p>About the model</p>' },
}

function installBackend() {
  const calls: { url: string; method: string }[] = []
  setFetch(async (input, init) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/loras/metadata')) return json({ success: true, metadata: METADATA })
    if (url.includes('example-image-files')) return json({ success: true, files: [] })
    if (url.includes('recipes/for-lora')) return json({ success: true, recipes: [{ id: 'r1', title: 'Recipe one', loras: [{}, {}], base_model: 'SDXL' }] })
    if (url.includes('/updates/versions/5')) return json({ success: true, record: { modelId: 5, hasUpdate: false, versions: [] } })
    if (url.includes('/updates/overview')) return json({ success: false, error: 'Not Found' }, 404)
    if (url.includes('/loras/list')) return json({ items: [ITEM], total: 1, page: 1, total_pages: 1 })
    if (url.includes('unified-folder-tree')) return json({ tree: {} })
    if (url.includes('base-models')) return json({ base_models: [] })
    if (url.includes('top-tags')) return json({ tags: [] })
    if (url.includes('/settings')) return json({ success: true, settings: {} })
    return json({ success: true })
  })
  return calls
}

const NAV: NavState = { index: 1, ordinal: 2, loadedCount: 3, total: 3, hasPrev: true, hasNext: true, needsMore: false }
const routes = [
  { path: '/loras', component: { template: '<div />' } },
  { path: '/recipes', component: { template: '<div />' } },
]

async function mountDrawer(props: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(ModelDrawer, {
    global: { plugins: [router] },
    attachTo: document.body,
    props: { item: ITEM, api: createModelApi('loras'), classicUrl: '/loras', canSend: true, ...props },
  })
  await flushPromises()
  // The flyout is teleported to <body> by the Reka UI Sheet: query the document.
  return { wrapper, router, body: new DOMWrapper(document.body) }
}

const el = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector(selector) as T
/** jsdom keeps no scroll offsets: give the element a writable one. */
function scrollable(node: HTMLElement, top: number): void {
  Object.defineProperty(node, 'scrollTop', { value: top, writable: true, configurable: true })
}

describe('details flyout', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    setFetch(null)
    document.body.innerHTML = ''
  })

  it('is a modal Sheet labelled by the model name, with Examples first', async () => {
    installBackend()
    const { wrapper, body } = await mountDrawer()
    const dialog = body.get('[role="dialog"][aria-modal="true"]')
    expect(dialog.attributes('aria-labelledby')).toBe('drawer-title')
    expect(el('#drawer-title').textContent).toContain('Alpha')
    expect(body.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(['Examples', 'Description', 'Versions', 'Recipes'])
    expect(body.get('#tab-examples').attributes('aria-selected')).toBe('true')
    wrapper.unmount()
  })

  it('a tab or thumbnail change swaps only the right pane: header and info column keep their nodes and scroll', async () => {
    installBackend()
    const { wrapper, body } = await mountDrawer()
    const header = el('[data-testid="drawer-header"]')
    const info = el('[data-testid="drawer-info"]')
    const title = el('#drawer-title')
    const pane = el('[data-testid="drawer-pane"]')
    scrollable(info, 120)
    scrollable(pane, 80)
    expect(body.text()).toContain('first prompt')

    // Thumbnail: the large image and its generation data change, nothing else.
    const thumbs = body.findAll('[data-testid="drawer-thumb"]')
    expect(thumbs).toHaveLength(2)
    await thumbs[1].trigger('click')
    expect(thumbs[1].attributes('aria-pressed')).toBe('true')
    expect(body.get('#panel-examples').text()).toContain('second prompt')
    expect(info.scrollTop).toBe(120)
    expect(pane.scrollTop).toBe(80)

    // Tab: the right pane starts at the top; the info column stays where it was.
    await body.get('#tab-description').trigger('click')
    await flushPromises()
    expect(body.get('#tab-description').attributes('aria-selected')).toBe('true')
    expect(body.get('#panel-description').text()).toContain('About the model')
    expect(pane.scrollTop).toBe(0)
    expect(info.scrollTop).toBe(120)

    for (const [selector, node] of [
      ['[data-testid="drawer-header"]', header],
      ['[data-testid="drawer-info"]', info],
      ['#drawer-title', title],
      ['[data-testid="drawer-pane"]', pane],
    ] as const) {
      expect(el(selector), selector).toBe(node)
      expect(node.isConnected, selector).toBe(true)
    }
    wrapper.unmount()
  })

  it('loads the Recipes tab lazily and opens a recipe on the Recipes page', async () => {
    const calls = installBackend()
    const { wrapper, body, router } = await mountDrawer()
    expect(calls.some((call) => call.url.includes('recipes/for-lora'))).toBe(false)
    await body.get('#tab-recipes').trigger('click')
    await flushPromises()
    const forLora = calls.find((call) => call.url.includes('recipes/for-lora'))!
    expect(new URL(forLora.url, 'http://x').searchParams.get('hash')).toBe('a'.repeat(64))
    const recipe = body.get('[data-testid="drawer-recipe"]')
    expect(recipe.text()).toContain('Recipe one')
    expect(recipe.text()).toContain('2 LoRAs')
    await recipe.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/recipes?open=r1')
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    wrapper.unmount()
  })

  it('steps with the arrow keys and the prev / next buttons; the tab list keeps its own arrows', async () => {
    installBackend()
    const { wrapper, body } = await mountDrawer({ nav: NAV })
    expect(body.text()).toContain('2 of 3')
    const close = body.get('button[aria-label="Close"]')
    await close.trigger('keydown', { key: 'ArrowRight' })
    await close.trigger('keydown', { key: 'ArrowLeft' })
    await close.trigger('keydown', { key: 'j' })
    await flushPromises()
    expect(wrapper.emitted('navigate')).toEqual([['next'], ['prev'], ['next']])

    // On the tab list ArrowRight moves to the next tab instead.
    await body.get('#tab-examples').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(body.get('#tab-description').attributes('aria-selected')).toBe('true')
    expect(wrapper.emitted('navigate')).toHaveLength(3)

    // Typing in a field never steps.
    await body.get('#drawer-notes').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('navigate')).toHaveLength(3)

    await body.get('button[aria-label="Previous model"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('navigate')!.at(-1)).toEqual(['prev'])
    wrapper.unmount()
  })

  it('asks before stepping or closing with unsaved notes', async () => {
    installBackend()
    const { wrapper, body } = await mountDrawer({ nav: NAV })
    await body.get('#drawer-notes').setValue('draft')
    await body.get('button[aria-label="Next model"]').trigger('click')
    await flushPromises()
    const { confirmState } = useConfirm()
    expect(confirmState.value?.title).toBe('Discard unsaved notes?')
    confirmState.value!.resolve(false)
    await flushPromises()
    expect(wrapper.emitted('navigate')).toBeUndefined()

    await body.get('button[aria-label="Close"]').trigger('click')
    await flushPromises()
    confirmState.value!.resolve(true)
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('moves focus to Close on open, closes on Escape and returns focus to the opener', async () => {
    installBackend()
    const opener = document.createElement('button')
    opener.textContent = 'Open'
    document.body.appendChild(opener)
    opener.focus()
    const { wrapper } = await mountDrawer()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')

    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.unmount()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement).toBe(opener)
  })

  it('keeps Tab inside the flyout (focus trap of the Sheet)', async () => {
    installBackend()
    const { wrapper } = await mountDrawer()
    const dialog = el('[role="dialog"][aria-labelledby="drawer-title"]')
    // Shift+Tab on the first control wraps to the last one instead of leaving the dialog.
    const first = dialog.querySelector<HTMLElement>('button[aria-label="Edit model name"]')!
    first.focus()
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await flushPromises()
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(first)
    wrapper.unmount()
  })

  it('Escape in an inline edit cancels the edit and keeps the flyout open', async () => {
    installBackend()
    const { wrapper, body } = await mountDrawer()
    await body.get('button[aria-label="Edit model name"]').trigger('click')
    await flushPromises()
    const input = el<HTMLInputElement>('#drawer-edit-name')
    expect(input.value).toBe('Alpha')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.querySelector('#drawer-edit-name')).toBeNull()
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('saves an edited name through save-metadata', async () => {
    const calls = installBackend()
    const { wrapper, body } = await mountDrawer()
    await body.get('button[aria-label="Edit model name"]').trigger('click')
    await flushPromises()
    await body.get('#drawer-edit-name').setValue('Alpha 2')
    await body.get('#drawer-edit-name').element.closest('form')!.dispatchEvent(new Event('submit'))
    await flushPromises()
    const posts = calls.filter((call) => call.method === 'POST').map((call) => new URL(call.url, 'http://x').pathname)
    expect(posts).toEqual(['/api/lm/loras/save-metadata'])
    expect(wrapper.emitted('updated')?.[0]?.[0]).toMatchObject({ model_name: 'Alpha 2' })
    wrapper.unmount()
  })
})

// --- ?open= deep link -------------------------------------------------------------

const GridStub = defineComponent({
  setup(_, { expose }) {
    expose({
      scrollToTop: () => undefined,
      scrollToIndex: () => undefined,
      scrollTo: () => undefined,
      scrollOffset: () => 0,
      anchor: () => ({ index: 0, offset: 0 }),
      scrollToAnchor: () => undefined,
    })
    return () => h('div', { class: 'grid-stub' })
  },
})

describe('?open= deep link', () => {
  afterEach(() => {
    setFetch(null)
    clearBrowseView()
    document.body.innerHTML = ''
  })

  it('opens the flyout for the linked model and clears the parameter when it closes', async () => {
    installBackend()
    const LibraryPage = (await import('@/pages/LibraryPage.vue')).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/loras', component: LibraryPage, props: { prefix: 'loras' } }],
    })
    await router.push(`/loras?open=${encodeURIComponent(ITEM.file_path)}`)
    const wrapper = mount(RouterView, { global: { plugins: [router], stubs: { VirtualGrid: GridStub } }, attachTo: document.body })
    await flushPromises()
    const body = new DOMWrapper(document.body)
    expect(body.get('[role="dialog"][aria-labelledby="drawer-title"]').text()).toContain('Alpha')
    await body.get('[data-testid="drawer-header"] button[aria-label="Close"]').trigger('click')
    await flushPromises()
    expect(document.querySelector('[aria-labelledby="drawer-title"]')).toBeNull()
    expect(router.currentRoute.value.query.open).toBeUndefined()
    wrapper.unmount()
  })
})
