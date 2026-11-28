/**
 * Phase 6d real states: the empty state per condition (first run, empty
 * folder, zero favourites, no match) with its action, the skeleton while a
 * scan runs on an empty library, broken vs missing previews and the
 * offline / Civitai rate-limit banner.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { setFetch } from '@/api/http'
import type { ModelItem } from '@/api/types'
import ConnectionBanner from '@/components/ConnectionBanner.vue'
import ModelCard from '@/components/ModelCard.vue'
import { useDownloadQueue } from '@/composables/useDownloadQueue'
import { clearBrowseView, emptyStateKind, saveBrowseView, type BrowseViewState } from '@/utils/browse'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const body = () => new DOMWrapper(document.body)

/** VirtualGrid without layout (jsdom has no sizes): the skeleton flag and the items. */
const GridStub = defineComponent({
  props: { skeleton: Boolean, skeletonLabel: { type: String, default: '' }, items: { type: Array, default: () => [] } },
  setup(props, { expose }) {
    expose({ scrollToTop: () => undefined, scrollToIndex: () => undefined, scrollTo: () => undefined, scrollOffset: () => 0 })
    return () => h('div', { 'data-testid': 'grid', 'data-skeleton': props.skeleton ? props.skeletonLabel || 'loading' : undefined })
  },
})

describe('emptyStateKind', () => {
  it('maps the active-view chips to the state', () => {
    expect(emptyStateKind([])).toBe('library')
    expect(emptyStateKind(['folder'])).toBe('folder')
    expect(emptyStateKind(['folder', 'recursive'])).toBe('folder')
    expect(emptyStateKind(['fav'])).toBe('favorites')
    expect(emptyStateKind(['fav', 'folder'])).toBe('noMatch')
    expect(emptyStateKind(['search'])).toBe('noMatch')
    expect(emptyStateKind(['tag:anime'])).toBe('noMatch')
  })
})

describe('LibraryPage empty states', () => {
  let urls: string[] = []
  /** Set by a test to hold the library scan open. */
  let scanGate: Promise<void> | null = null
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    localStorage.clear()
    urls = []
    scanGate = null
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
    setFetch(async (input) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('/init-status')) return json({ status: 'complete' })
      if (/\/loras\/scan/.test(url) && scanGate) await scanGate
      if (/\/loras\/list/.test(url)) return json({ items: [], total: 0, page: 1, total_pages: 0 })
      if (url.includes('unified-folder-tree')) return json({ tree: {} })
      if (url.includes('base-models')) return json({ base_models: [] })
      if (url.includes('top-tags')) return json({ tags: [] })
      if (url.includes('/settings')) return json({ success: true, settings: {} })
      return json({ success: true })
    })
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    setFetch(null)
    clearBrowseView()
    document.body.innerHTML = ''
  })

  async function mountPage(path: string) {
    const LibraryPage = (await import('@/pages/LibraryPage.vue')).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/loras', name: 'loras', component: LibraryPage, props: { prefix: 'loras' } },
        { path: '/settings/:tab?', name: 'settings', component: { template: '<div />' } },
      ],
    })
    await router.push(path)
    const wrapper = mount(RouterView, { global: { plugins: [router], stubs: { ModelDrawer: true, VirtualGrid: GridStub } }, attachTo: document.body })
    await flushPromises()
    return { wrapper, router }
  }

  const empty = () => body().get('[data-empty]')

  it('first run: links to the library folders, scans and opens the download dialog', async () => {
    const { wrapper } = await mountPage('/loras')
    expect(empty().attributes('data-empty')).toBe('library')
    expect(empty().text()).toContain('This library is empty')
    expect(empty().get('a').attributes('href')).toBe('/settings/library')
    const buttons = empty().findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['Scan for models', 'Download…'])

    urls.length = 0
    await buttons[0].trigger('click')
    await flushPromises()
    expect(urls.some((url) => /\/loras\/scan/.test(url))).toBe(true)

    await buttons[1].trigger('click')
    await flushPromises()
    expect(body().find('[role="dialog"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the skeleton instead of the empty state while a scan runs', async () => {
    let finish = () => undefined as void
    scanGate = new Promise((resolve) => (finish = resolve))
    const { wrapper } = await mountPage('/loras')
    await empty().get('button').trigger('click')
    await flushPromises()
    expect(body().find('[data-empty]').exists()).toBe(false)
    expect(body().get('[data-testid="grid"]').attributes('data-skeleton')).toBe('Scanning the library…')
    finish()
    await flushPromises()
    expect(empty().attributes('data-empty')).toBe('library')
    wrapper.unmount()
  })

  it('empty folder (deep link ?folder=): names the folder and shows the whole library', async () => {
    const { wrapper, router } = await mountPage('/loras?folder=style/anime')
    expect(router.currentRoute.value.query.folder).toBeUndefined()
    expect(empty().attributes('data-empty')).toBe('folder')
    expect(empty().text()).toContain('style/anime')
    expect(urls.some((url) => url.includes('folder=style%2Fanime'))).toBe(true)
    await empty().get('button').trigger('click')
    await flushPromises()
    expect(empty().attributes('data-empty')).toBe('library')
    wrapper.unmount()
  })

  it('zero favourites: explains the star and turns the filter off', async () => {
    const view: BrowseViewState = {
      search: '', folder: '', letter: '', baseModels: [], tags: [], tagLogic: 'any', modelTypes: [],
      creditRequired: null, allowSelling: null, favoritesOnly: true, updatesOnly: false, missingOnly: false,
      scrollTop: 0, loadedCount: 0, knownTotal: null,
    }
    saveBrowseView('loras', view)
    const { wrapper } = await mountPage('/loras')
    expect(empty().attributes('data-empty')).toBe('favorites')
    expect(empty().text()).toContain('No favourites yet')
    await empty().get('button').trigger('click')
    await flushPromises()
    expect(empty().attributes('data-empty')).toBe('library')
    wrapper.unmount()
  })

  it('no match: Clear all resets every filter', async () => {
    const { wrapper } = await mountPage('/loras?q=nothing')
    expect(empty().attributes('data-empty')).toBe('noMatch')
    const clear = empty().get('button')
    expect(clear.text()).toBe('Clear all')
    await clear.trigger('click')
    await flushPromises()
    expect(empty().attributes('data-empty')).toBe('library')
    wrapper.unmount()
  })
})

describe('previews', () => {
  const props = {
    item: { model_name: 'Model A', file_name: 'model-a', file_path: 'D:/loras/model-a.safetensors', folder: '', preview_url: '/previews/a.png', base_model: 'SDXL 1.0', tags: [] } as ModelItem,
    selectionMode: false,
    selected: false,
    blurMature: false,
  }

  it('tells a preview that failed to load from a model without one', async () => {
    const broken = mount(ModelCard, { props })
    await flushPromises()
    await broken.get('img').trigger('error')
    expect(broken.get('[data-preview]').attributes('data-preview')).toBe('broken')
    expect(broken.text()).toContain('Preview could not be loaded')

    const none = mount(ModelCard, { props: { ...props, item: { ...props.item, preview_url: '' } } })
    await flushPromises()
    expect(none.get('[data-preview]').attributes('data-preview')).toBe('none')
    expect(none.text()).toContain('No preview')
  })
})

describe('ConnectionBanner', () => {
  let worker: Record<string, unknown> = {}
  let polls = 0

  beforeEach(() => {
    polls = 0
    setFetch(async () => {
      polls++
      return json({ success: true, queue: [], stats: {}, worker })
    })
  })

  afterEach(() => {
    setFetch(null)
    window.dispatchEvent(new Event('online'))
  })

  it('stays hidden while online and not rate limited', async () => {
    worker = { rate_limited: false }
    const wrapper = mount(ConnectionBanner)
    await flushPromises()
    expect(wrapper.find('[data-testid="connection-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the Civitai cooldown from the download queue, and Retry re-reads it', async () => {
    worker = { rate_limited: true, retry_after: 42 }
    const wrapper = mount(ConnectionBanner)
    await useDownloadQueue().refresh()
    await flushPromises()
    const banner = wrapper.get('[data-testid="connection-banner"]')
    expect(banner.attributes('role')).toBe('status')
    expect(banner.text()).toContain('about 42 s')

    worker = { rate_limited: false }
    const before = polls
    await banner.get('button').trigger('click')
    await flushPromises()
    expect(polls).toBeGreaterThan(before)
    expect(wrapper.find('[data-testid="connection-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the offline message while the browser is offline', async () => {
    worker = {}
    const wrapper = mount(ConnectionBanner)
    await flushPromises()
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(wrapper.get('[data-testid="connection-banner"]').text()).toContain('You are offline')
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    wrapper.unmount()
  })
})
