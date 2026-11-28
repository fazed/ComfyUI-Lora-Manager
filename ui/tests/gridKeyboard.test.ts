/**
 * Keyboard grid and the one selection model (Phase 6b): movement maths, one
 * tab stop that follows the arrow keys through the virtual list (rows that
 * were not rendered scroll in and take the focus), and the library page's
 * item keys: Space selects in place, Ctrl+click selects without a mode,
 * Escape closes a menu before it clears the selection, S sends with the
 * usage-tip strength, Delete confirms, D and Alt+letter.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref, type PropType } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { setFetch } from '@/api/http'
import type { ModelItem } from '@/api/types'
import VirtualGrid from '@/components/VirtualGrid.vue'
import { gridKeyOf, gridStep } from '@/composables/useGridKeyboard'
import { useConfirm } from '@/composables/useFeedback'
import { clearBrowseView } from '@/utils/browse'

describe('gridStep', () => {
  const shape = { columns: 4, count: 10, pageRows: 2 }
  it('moves by one item sideways and by the column count up and down', () => {
    expect(gridStep(5, 'ArrowRight', shape)).toBe(6)
    expect(gridStep(5, 'ArrowLeft', shape)).toBe(4)
    expect(gridStep(5, 'ArrowDown', shape)).toBe(9)
    expect(gridStep(5, 'ArrowUp', shape)).toBe(1)
  })

  it('stays inside the items (no jump into the short last row or above the first)', () => {
    expect(gridStep(9, 'ArrowRight', shape)).toBe(9)
    expect(gridStep(0, 'ArrowLeft', shape)).toBe(0)
    expect(gridStep(7, 'ArrowDown', shape)).toBe(7)
    expect(gridStep(2, 'ArrowUp', shape)).toBe(2)
  })

  it('jumps with Home / End and a page of rows with PageUp / PageDown', () => {
    expect(gridStep(5, 'Home', shape)).toBe(0)
    expect(gridStep(5, 'End', shape)).toBe(9)
    expect(gridStep(1, 'PageDown', shape)).toBe(9)
    expect(gridStep(9, 'PageUp', shape)).toBe(1)
    expect(gridStep(5, 'Enter', shape)).toBeNull()
    expect(gridStep(0, 'ArrowDown', { ...shape, count: 0 })).toBeNull()
  })
})

describe('VirtualGrid keyboard', () => {
  // jsdom has no layout: give every element a 310px viewport and a writable scroll position.
  const scrollTops = new WeakMap<Element, number>()
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 310 })
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: Element) {
        return scrollTops.get(this) ?? 0
      },
      set(this: Element, value: number) {
        scrollTops.set(this, value)
      },
    })
  })
  afterAll(() => {
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
    delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const ITEMS = Array.from({ length: 200 }, (_, index) => `i${index}`)

  function mountGrid() {
    const Host = defineComponent({
      setup() {
        const active = ref<string | null>(null)
        return () =>
          h(
            VirtualGrid<string>,
            {
              items: ITEMS,
              itemKey: (item: string) => item,
              minItemWidth: 210,
              layout: 'list',
              activeKey: active.value,
              'onUpdate:activeKey': (value: string | null) => (active.value = value),
            },
            {
              default: ({ item, tabbable }: { item: string; tabbable: boolean }) =>
                h('button', { type: 'button', 'data-grid-primary': '', tabindex: tabbable ? 0 : -1 }, item),
            },
          )
      },
    })
    return mount(Host, { attachTo: document.body })
  }

  const body = () => new DOMWrapper(document.body)
  const tabStops = () => body().findAll('button[tabindex="0"]').map((button) => button.text())
  const rendered = () => body().findAll('button').map((button) => button.text())

  async function press(key: string): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    document.activeElement!.dispatchEvent(event)
    await flushPromises()
    return event
  }

  it('is one tab stop that the arrows move, scrolling unrendered rows in and focusing them', async () => {
    const wrapper = mountGrid()
    await flushPromises()
    // Only the visible rows plus overscan are rendered; the first item holds the tab stop.
    expect(rendered()).toHaveLength(7)
    expect(tabStops()).toEqual(['i0'])

    body().findAll('button')[0].element.focus()
    const down = await press('ArrowDown')
    expect(down.defaultPrevented).toBe(true)
    expect(document.activeElement?.textContent).toBe('i1')
    expect(tabStops()).toEqual(['i1'])

    await press('End')
    expect(document.activeElement?.textContent).toBe('i199')
    expect(gridKeyOf(document.activeElement)).toBe('i199')
    expect(rendered()).toContain('i199')
    expect(rendered()).not.toContain('i0')
    expect(tabStops()).toEqual(['i199'])

    await press('Home')
    expect(document.activeElement?.textContent).toBe('i0')
    // Not a movement key: left to the page.
    expect((await press('Enter')).defaultPrevented).toBe(false)
    wrapper.unmount()
  })
})

// --- the library page ---------------------------------------------------------

function item(overrides: Partial<ModelItem> = {}): ModelItem {
  return {
    model_name: 'Model A',
    file_name: 'model-a',
    file_path: 'D:/loras/model-a.safetensors',
    folder: '',
    preview_url: '',
    base_model: 'SDXL 1.0',
    tags: [],
    usage_tips: '{"strength": 0.7}',
    ...overrides,
  }
}

const ITEMS = [item(), item({ model_name: 'Model B', file_name: 'model-b', file_path: 'D:/loras/model-b.safetensors', usage_tips: '{}' })]

/** Renders every item in a keyed cell like VirtualGrid (no windowing). */
const GridStub = defineComponent({
  props: {
    items: { type: Array as PropType<ModelItem[]>, required: true },
    itemKey: { type: Function as PropType<(item: ModelItem) => string>, required: true },
  },
  setup(props, { expose, slots }) {
    expose({
      scrollToTop: () => undefined,
      scrollToIndex: () => undefined,
      scrollTo: () => undefined,
      scrollOffset: () => 0,
      anchor: () => ({ index: 0, offset: 0 }),
      scrollToAnchor: () => undefined,
    })
    return () =>
      h(
        'div',
        props.items.map((entry, index) =>
          h('div', { key: props.itemKey(entry), 'data-grid-key': props.itemKey(entry) }, slots.default?.({ item: entry, index, tabbable: index === 0 })),
        ),
      )
  },
})

interface Backend {
  urls: string[]
  sent: unknown[]
}

function installBackend(): Backend {
  const backend: Backend = { urls: [], sent: [] }
  setFetch(async (input, init) => {
    const url = String(input)
    backend.urls.push(url)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/init-status')) return json({ status: 'complete' })
    if (/\/loras\/list/.test(url)) return json({ items: ITEMS, total: 2, page: 1, total_pages: 1 })
    if (url.includes('unified-folder-tree')) return json({ tree: {} })
    if (url.includes('base-models')) return json({ base_models: [] })
    if (url.includes('top-tags')) return json({ tags: [] })
    if (url.includes('/settings')) return json({ success: true, settings: {} })
    if (url.includes('/get-registry')) return json({ success: true, data: { nodes: { '7': { id: 7, title: 'Lora Loader', type: 1 } } } })
    if (url.includes('/update-lora-code')) {
      backend.sent.push(JSON.parse(String(init?.body)))
      return json({ success: true, results: [] })
    }
    return json({ success: true })
  })
  return backend
}

async function mountPage() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
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
  return wrapper
}

const body = () => new DOMWrapper(document.body)
const primary = (path: string) => body().get(`[data-grid-key="${path}"] button[data-grid-primary]`)
const A = 'D:/loras/model-a.safetensors'
const B = 'D:/loras/model-b.safetensors'

async function key(target: Element, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  await flushPromises()
  return event
}

describe('LibraryPage keyboard grid and selection', () => {
  const originalMatchMedia = window.matchMedia
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    window.matchMedia = originalMatchMedia
    setFetch(null)
    clearBrowseView()
    document.body.innerHTML = ''
  })

  it('has one tab stop per grid: inner buttons of other items leave the tab order', async () => {
    installBackend()
    const wrapper = await mountPage()
    expect(primary(A).attributes('tabindex')).toBe('0')
    expect(primary(B).attributes('tabindex')).toBe('-1')
    const inner = body().findAll(`[data-grid-key="${B}"] button:not([data-grid-primary])`)
    expect(inner.length).toBeGreaterThan(0)
    expect(inner.every((button) => button.attributes('tabindex') === '-1')).toBe(true)
    wrapper.unmount()
  })

  it('selects in place with Space and Ctrl+click, without a mode switch; Escape clears', async () => {
    const backend = installBackend()
    const wrapper = await mountPage()
    const cardA = primary(A).element
    backend.urls.length = 0

    const space = await key(cardA, { key: ' ' })
    expect(space.defaultPrevented).toBe(true)
    // Same element, updated attributes: the grid was patched, not rebuilt or re-fetched.
    expect(primary(A).element).toBe(cardA)
    expect(cardA.getAttribute('aria-pressed')).toBe('true')
    expect(body().get('[data-testid="selection-bar"]').text()).toContain('1 selected')
    expect(backend.urls.filter((url) => url.includes('/list'))).toEqual([])

    await key(document.body, { key: 'Escape' })
    expect(body().find('[data-testid="selection-bar"]').exists()).toBe(false)
    expect(cardA.getAttribute('aria-pressed')).toBeNull()

    primary(B).element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ctrlKey: true }))
    await flushPromises()
    expect(body().get('[data-testid="selection-bar"]').text()).toContain('1 selected')
    expect(primary(B).attributes('aria-pressed')).toBe('true')
    expect(body().find('[data-testid="drawer"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Escape closes an open menu before it clears the selection', async () => {
    installBackend()
    const wrapper = await mountPage()
    await key(primary(A).element, { key: ' ' })
    body().get(`[data-grid-key="${A}"] article`).element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }))
    await flushPromises()
    expect(body().find('[role="menu"]').exists()).toBe(true)

    await key(document.activeElement ?? document.body, { key: 'Escape' })
    expect(body().find('[role="menu"]').exists()).toBe(false)
    expect(body().find('[data-testid="selection-bar"]').exists()).toBe(true)

    await key(document.body, { key: 'Escape' })
    expect(body().find('[data-testid="selection-bar"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Ctrl+A selects every loaded card without a mode switch; the selection menu marks them as favorite', async () => {
    const backend = installBackend()
    const wrapper = await mountPage()
    const all = await key(document.body, { key: 'a', ctrlKey: true })
    expect(all.defaultPrevented).toBe(true)
    expect(body().get('[data-testid="selection-bar"]').text()).toContain('2 selected')

    body().get(`[data-grid-key="${A}"] article`).element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }))
    await flushPromises()
    const entry = body().findAll('[role="menuitem"]').find((item) => item.text().includes('Mark as favorite'))!
    backend.urls.length = 0
    await entry.trigger('click')
    await flushPromises()
    expect(backend.urls.filter((url) => url.includes('save-metadata'))).toHaveLength(2)
    wrapper.unmount()
  })

  it('a right-click on the grid background opens the page menu (Download, Select all, Tools)', async () => {
    installBackend()
    const wrapper = await mountPage()
    const background = body().get(`[data-grid-key="${A}"]`).element.parentElement!
    background.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }))
    await flushPromises()
    const labels = body().findAll('[role="menuitem"]').map((item) => item.text())
    expect(labels[0]).toContain('Download')
    expect(labels.some((label) => label.includes('Rebuild cache'))).toBe(true)
    // A card keeps its own menu.
    await key(document.activeElement ?? document.body, { key: 'Escape' })
    body().get(`[data-grid-key="${A}"] article`).element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }))
    await flushPromises()
    expect(body().findAll('[role="menuitem"]').some((item) => item.text().includes('Rebuild cache'))).toBe(false)
    wrapper.unmount()
  })

  it('Enter opens the details; S sends with the usage-tip strength; F on a card favourites instead of opening Filters', async () => {
    const backend = installBackend()
    const wrapper = await mountPage()
    await key(primary(A).element, { key: 's' })
    await flushPromises()
    expect(backend.sent).toEqual([{ lora_code: '<lora:model-a:0.7>', mode: 'append', node_ids: [{ node_id: 7, graph_id: null }] }])
    await key(primary(B).element, { key: 'S', shiftKey: true })
    expect(backend.sent.at(-1)).toMatchObject({ lora_code: '<lora:model-b:1>', mode: 'replace' })

    backend.urls.length = 0
    const f = await key(primary(A).element, { key: 'f' })
    expect(f.defaultPrevented).toBe(true)
    expect(backend.urls.some((url) => url.includes('save-metadata'))).toBe(true)
    expect(body().find('[role="dialog"][aria-label="Filters"]').exists()).toBe(false)

    await key(primary(B).element, { key: 'Enter' })
    expect(body().find('[data-testid="drawer"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('Delete on a focused card asks first (the confirm dialog lives in App.vue)', async () => {
    const backend = installBackend()
    const wrapper = await mountPage()
    const { confirmState } = useConfirm()
    const event = await key(primary(A).element, { key: 'Delete' })
    expect(event.defaultPrevented).toBe(true)
    expect(confirmState.value).toMatchObject({ title: 'Delete "Model A"?', danger: true })
    confirmState.value?.resolve(false)
    await flushPromises()
    expect(backend.urls.some((url) => url.includes('delete'))).toBe(false)
    wrapper.unmount()
  })

  it('D opens the download dialog and Alt+letter picks the alphabet letter', async () => {
    installBackend()
    const wrapper = await mountPage()
    await key(document.body, { key: '∫', code: 'KeyB', altKey: true })
    expect(body().get('[data-testid="active-view"]').text()).toContain('Starts with B')
    await key(document.body, { key: 'd' })
    expect(body().get('[role="dialog"]').text()).toContain('Download from Civitai')
    wrapper.unmount()
  })
})
