/**
 * Quick-view inspector: the panel itself (content from the list item, chips,
 * actions) and the library page's click model around it: while it shows, a
 * single click focuses a card and the panel follows (no request per focus),
 * a double-click opens the drawer; while it is hidden (narrow window, touch,
 * or switched off) a click opens the drawer as before.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { setFetch } from '@/api/http'
import type { ModelItem } from '@/api/types'
import { clearBrowseView } from '@/utils/browse'
import ModelInspector from '@/components/ModelInspector.vue'

function item(overrides: Partial<ModelItem> = {}): ModelItem {
  return {
    model_name: 'Model A',
    file_name: 'model-a',
    file_path: 'D:/loras/model-a.safetensors',
    folder: 'styles',
    preview_url: '',
    base_model: 'SDXL 1.0',
    file_size: 150 * 1024 * 1024,
    usage_count: 4,
    tags: ['style', 'anime'],
    civitai: { trainedWords: ['flat color', ' flat color ', 'lineart'] },
    ...overrides,
  }
}

describe('ModelInspector', () => {
  const props = { item: item(), canSend: true, blurMature: false, revealed: false }

  it('shows an empty state without a focused model', () => {
    const wrapper = mount(ModelInspector, { props: { ...props, item: null } })
    expect(wrapper.text()).toContain('Select a model to see its details.')
  })

  it('shows name, file name, key facts, trigger words and tags of the list item', () => {
    const wrapper = mount(ModelInspector, { props })
    expect(wrapper.get('[data-testid="inspector-name"]').text()).toBe('Model A')
    const text = wrapper.text()
    for (const part of ['model-a', 'SDXL 1.0', 'styles', '150.0 MB', '4 times', 'No update flagged']) expect(text).toContain(part)
    // Trigger words are trimmed and de-duplicated; each chip copies its own word.
    expect(wrapper.findAll('button[aria-label^="Copy trigger word"]').map((chip) => chip.text())).toEqual(['flat color', 'lineart'])
  })

  it('runs the page actions: send, copy syntax, open details, filter by tag, close', async () => {
    const wrapper = mount(ModelInspector, { props })
    await wrapper.get('button[title^="Send to ComfyUI"]').trigger('click', { shiftKey: true })
    // No usage tips: the default strength 1.
    expect(wrapper.emitted('send')?.[0]).toEqual([props.item, true, 1])
    await wrapper.get('button[aria-label="Copy LoRA syntax"]').trigger('click')
    expect(wrapper.emitted('copy')?.[0]).toEqual([props.item, 1])
    await wrapper.findAll('button').find((button) => button.text() === 'Open full details')!.trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual([props.item])
    await wrapper.get('button[aria-label="Filter by tag anime"]').trigger('click')
    expect(wrapper.emitted('filter-tag')?.[0]).toEqual(['anime'])
    await wrapper.get('button[aria-label="Hide quick view"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it("starts the strength stepper at the usage-tip strength, shows it on Send and resets it per model", async () => {
    const tipped = item({ usage_tips: '{"strength": 0.65}' })
    const wrapper = mount(ModelInspector, { props: { ...props, item: tipped } })
    const send = wrapper.get('button[title^="Send to ComfyUI"]')
    expect(send.attributes('aria-label')).toBe('Send to ComfyUI at strength 0.65')
    expect(send.text()).toContain('0.65')
    const input = wrapper.get<HTMLInputElement>('#inspector-strength')
    expect(input.element.value).toBe('0.65')
    await input.setValue('0.4')
    await send.trigger('click')
    await wrapper.get('button[aria-label="Copy LoRA syntax"]').trigger('click')
    expect(wrapper.emitted('send')?.[0]).toEqual([tipped, false, 0.4])
    expect(wrapper.emitted('copy')?.[0]).toEqual([tipped, 0.4])
    // An emptied field falls back to the usage tip; another model starts from its own tip.
    await input.setValue('')
    expect(send.attributes('aria-label')).toBe('Send to ComfyUI at strength 0.65')
    await wrapper.setProps({ item: item({ file_path: 'D:/loras/other.safetensors', usage_tips: '{"strength": 0.9}' }) })
    expect(input.element.value).toBe('0.9')
  })

  it('has no send or copy where sending is impossible', () => {
    const wrapper = mount(ModelInspector, { props: { ...props, canSend: false } })
    expect(wrapper.find('button[aria-label="Copy LoRA syntax"]').exists()).toBe(false)
    expect(wrapper.find('button[title^="Send to ComfyUI"]').exists()).toBe(false)
  })

  it('keeps a mature preview blurred until it is revealed', async () => {
    const mature = item({ preview_nsfw_level: 8 })
    const wrapper = mount(ModelInspector, { props: { ...props, item: mature, blurMature: true } })
    expect(wrapper.find('[data-blurred]').exists()).toBe(true)
    await wrapper.findAll('button').find((button) => button.text() === 'Show')!.trigger('click')
    expect(wrapper.emitted('reveal')?.[0]).toEqual([mature])
    await wrapper.setProps({ revealed: true })
    expect(wrapper.find('[data-blurred]').exists()).toBe(false)
  })
})

// --- the library page ---------------------------------------------------------

/** Renders every item through the page's slot (no windowing in jsdom). */
const GridStub = defineComponent({
  props: { items: { type: Array as PropType<unknown[]>, required: true } },
  setup(props, { expose, slots }) {
    expose({
      scrollToTop: () => undefined,
      scrollToIndex: () => undefined,
      scrollTo: () => undefined,
      scrollOffset: () => 0,
      anchor: () => ({ index: 0, offset: 0 }),
      scrollToAnchor: () => undefined,
    })
    return () => h('div', { class: 'grid-stub' }, props.items.map((entry, index) => slots.default?.({ item: entry, index })))
  },
})

const ITEMS = [item(), item({ model_name: 'Model B', file_name: 'model-b', file_path: 'D:/loras/model-b.safetensors' })]

function installBackend(): string[] {
  const urls: string[] = []
  setFetch(async (input) => {
    const url = String(input)
    urls.push(url)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/init-status')) return json({ status: 'complete' })
    if (/\/loras\/list/.test(url)) return json({ items: ITEMS, total: 2, page: 1, total_pages: 1 })
    if (url.includes('unified-folder-tree')) return json({ tree: {} })
    if (url.includes('base-models')) return json({ base_models: [] })
    if (url.includes('top-tags')) return json({ tags: [] })
    if (url.includes('/settings')) return json({ success: true, settings: {} })
    return json({ success: true })
  })
  return urls
}

/** jsdom has no matchMedia: answer the quick view's query with `wide`, everything else with false. */
function mockMedia(wide: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: wide && query.includes('1280px'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

async function mountPage() {
  const LibraryPage = (await import('@/pages/LibraryPage.vue')).default
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/loras', name: 'loras', component: LibraryPage, props: { prefix: 'loras' } }],
  })
  await router.push('/loras')
  const wrapper = mount(RouterView, {
    global: { plugins: [router], stubs: { VirtualGrid: GridStub, ModelDrawer: { template: '<div data-testid="drawer" />' } } },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, router }
}

/** A real mouse click: `detail` is the click count (1 single, 2 the second click of a double-click). */
async function click(name: string, detail: number): Promise<void> {
  const card = new DOMWrapper(document.body).get(`button[aria-label="Open details for ${name}"]`)
  card.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }))
  await flushPromises()
}

describe('LibraryPage quick view', () => {
  const originalMatchMedia = window.matchMedia
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    window.matchMedia = originalMatchMedia
    setFetch(null)
    clearBrowseView()
    document.body.innerHTML = ''
  })

  it('follows a single click without a request and opens the drawer on a double-click', async () => {
    mockMedia(true)
    const urls = installBackend()
    const { wrapper, router } = await mountPage()
    const body = new DOMWrapper(document.body)
    expect(body.get('[data-testid="inspector"]').text()).toContain('Select a model to see its details.')

    urls.length = 0
    await click('Model A', 1)
    expect(body.get('[data-testid="inspector-name"]').text()).toBe('Model A')
    await click('Model B', 1)
    expect(body.get('[data-testid="inspector-name"]').text()).toBe('Model B')
    // The focused card is outlined in place; nothing was fetched for the focus changes.
    expect(body.get('button[aria-label="Open details for Model B"]').attributes('aria-current')).toBe('true')
    expect(body.get('button[aria-label="Open details for Model A"]').attributes('aria-current')).toBeUndefined()
    expect(urls).toEqual([])
    expect(body.find('[data-testid="drawer"]').exists()).toBe(false)

    await click('Model B', 2)
    expect(body.find('[data-testid="drawer"]').exists()).toBe(true)
    expect(router.currentRoute.value.query.open).toBe('D:/loras/model-b.safetensors')
    wrapper.unmount()
  })

  it('keeps click-to-open while the quick view is hidden (narrow window or touch)', async () => {
    mockMedia(false)
    installBackend()
    const { wrapper } = await mountPage()
    const body = new DOMWrapper(document.body)
    expect(body.find('[data-testid="inspector"]').exists()).toBe(false)
    await click('Model A', 1)
    expect(body.find('[data-testid="drawer"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('keeps click-to-open when the user switched the quick view off', async () => {
    mockMedia(true)
    localStorage.setItem('lm-ui.inspector', 'false')
    installBackend()
    const { wrapper } = await mountPage()
    const body = new DOMWrapper(document.body)
    expect(body.find('[data-testid="inspector"]').exists()).toBe(false)
    await click('Model A', 1)
    expect(body.find('[data-testid="drawer"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
