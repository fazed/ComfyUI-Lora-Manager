/**
 * The library's old per-file update flag (filter "Updates available" and the
 * card / row / drawer "Update" pills) is labelled as such and points to the
 * Updates page, which shows only likely updates. The filter's behaviour is
 * unchanged (it still sends `update_available_only`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { setFetch } from '@/api/http'
import type { ModelItem } from '@/api/types'
import { clearBrowseView } from '@/utils/browse'
import ModelCard from '@/components/ModelCard.vue'
import ModelRow from '@/components/ModelRow.vue'

const HINT = 'Per-file update flag from LoRA Manager. The Updates page shows only likely updates.'

function item(overrides: Partial<ModelItem> = {}): ModelItem {
  return {
    model_name: 'Model A',
    file_name: 'model-a',
    file_path: 'D:/loras/model-a.safetensors',
    folder: '',
    preview_url: '',
    base_model: 'SDXL 1.0',
    tags: [],
    update_available: true,
    ...overrides,
  } as ModelItem
}

const props = { selectionMode: false, selected: false, blurMature: false, canSend: true }

describe('Update pills on cards and rows', () => {
  it.each([
    ['ModelCard', ModelCard],
    ['ModelRow', ModelRow],
  ] as const)('%s: the pill explains the per-file flag and a click still opens the item', async (_name, component) => {
    const wrapper = mount(component as never, { props: { ...props, item: item() } as never, attachTo: document.body })
    await nextTick()
    const pill = wrapper.get('[data-testid="update-flag"]')
    expect(pill.text()).toContain('Update')
    expect(pill.attributes('title')).toBe(HINT)
    await pill.trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
    wrapper.unmount()
  })

  it.each([
    ['ModelCard', ModelCard],
    ['ModelRow', ModelRow],
  ] as const)('%s: no pill without the flag', (_name, component) => {
    const wrapper = mount(component as never, { props: { ...props, item: item({ update_available: false }) } as never })
    expect(wrapper.find('[data-testid="update-flag"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('the drawer pill carries the same tooltip next to its accessible name', () => {
    const source = readFileSync(resolve(__dirname, '../src/components/ModelDrawer.vue'), 'utf8')
    const pill = source.slice(source.indexOf('v-if="item.update_available"'), source.indexOf("@click=\"tab = 'versions'\""))
    expect(pill).toContain(':aria-label="t(\'detail.showUpdates\')"')
    expect(pill).toContain(':title="t(\'library.updatesFlagHint\')"')
  })
})

// --- the library filter ---------------------------------------------------------

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

function installBackend() {
  const urls: string[] = []
  setFetch(async (input) => {
    const url = String(input)
    urls.push(url)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/init-status')) return json({ status: 'complete' })
    if (/\/loras\/list/.test(url)) return json({ items: [item()], total: 1, page: 1, total_pages: 1 })
    if (url.includes('unified-folder-tree')) return json({ tree: {} })
    if (url.includes('base-models')) return json({ base_models: [] })
    if (url.includes('top-tags')) return json({ tags: [] })
    if (url.includes('/settings')) return json({ success: true, settings: {} })
    return json({ success: true })
  })
  return urls
}

describe('library filter "Updates available"', () => {
  afterEach(() => {
    setFetch(null)
    clearBrowseView()
    document.body.innerHTML = ''
  })

  it('explains the flag, describes the checkbox and links to /updates; the filter still works', async () => {
    const urls = installBackend()
    const LibraryPage = (await import('@/pages/LibraryPage.vue')).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/loras', name: 'loras', component: LibraryPage, props: { prefix: 'loras' } },
        { path: '/updates', name: 'updates', component: { render: () => null } },
      ],
    })
    await router.push('/loras')
    const wrapper = mount(RouterView, { global: { plugins: [router], stubs: { VirtualGrid: GridStub } }, attachTo: document.body })
    await flushPromises()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
    await flushPromises()

    // `f` opens the Filters flyout (a popover teleported to the body).
    const flyout = new DOMWrapper(document.body).get('[role="dialog"][aria-label="Filters"]')
    const filter = flyout.get('[data-testid="updates-flag-filter"]')
    const checkbox = filter.get('input[type="checkbox"]')
    const hintId = checkbox.attributes('aria-describedby')!
    const hint = filter.get(`#${hintId}`)
    expect(hint.text()).toContain(HINT)
    expect(filter.get('label').text()).toBe('Updates available')
    expect(filter.get('label').attributes('title')).toBe(HINT)
    const link = hint.get('a')
    expect(link.text()).toBe('Open Updates')
    expect(link.attributes('href')).toBe('/updates')

    // Behaviour unchanged: checking it asks the list for update_available_only.
    urls.length = 0
    await checkbox.setValue(true)
    await flushPromises()
    expect(urls.some((url) => url.includes('/loras/list') && url.includes('update_available_only=true'))).toBe(true)

    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/updates')
    wrapper.unmount()
  })
})
