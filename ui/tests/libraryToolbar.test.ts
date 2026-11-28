import { afterEach, describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { DEFAULT_SEARCH_IN } from '@/api/endpoints'
import LibraryToolbar from '@/components/LibraryToolbar.vue'
import LibrarySelectionBar from '@/components/LibrarySelectionBar.vue'

const base = {
  title: 'LoRAs',
  countText: '85 of 1,041 models',
  searchId: 's',
  searchScope: 'loras',
  searchLabel: 'Search',
  searchPlaceholder: 'Search',
  activeTags: [],
  idPrefix: 'loras',
  sortOptions: [
    { value: 'name:asc', label: 'library.sort.nameAsc' as const },
    { value: 'date:desc', label: 'library.sort.dateDesc' as const },
  ],
  foldersId: 'folders-loras',
  foldersOpen: false,
  filterCount: 2,
  chips: [],
  selectionMode: false,
  toolItems: [{ id: 'organize', label: 'Organize...' }],
  search: '',
  sort: 'name:asc',
  cardSize: 210,
}

const stubs = { SearchCombobox: { template: '<input type="search" />' } }

const body = () => new DOMWrapper(document.body)

describe('LibraryToolbar', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders a labelled toolbar with a screen-reader title and the filter badge', () => {
    const wrapper = mount(LibraryToolbar, { props: base, global: { stubs } })
    const bar = wrapper.get('[role="toolbar"]')
    expect(bar.attributes('aria-label')).toBe('LoRAs toolbar')
    // The visible page name is the breadcrumb root (context slot); the count lives there and in the status bar.
    expect(bar.get('h1').classes()).toContain('sr-only')
    expect(bar.get('h1').text()).toBe('LoRAs')
    expect(wrapper.find('.lm-badge').text()).toBe('2')
    wrapper.unmount()
  })

  it('renders the context row and keeps the base-model row behind the View option', () => {
    const slots = { context: '<nav id="crumbs">crumbs</nav>', quick: '<div id="quick">quick</div>' }
    const off = mount(LibraryToolbar, { props: base, slots, global: { stubs } })
    expect(off.find('#crumbs').exists()).toBe(true)
    expect(off.find('#quick').exists()).toBe(false)
    const on = mount(LibraryToolbar, { props: { ...base, quickRow: true }, slots, global: { stubs } })
    expect(on.find('#quick').exists()).toBe(true)
    off.unmount()
    on.unmount()
  })

  it('sorts from a menu that checks the current entry', async () => {
    const wrapper = mount(LibraryToolbar, { props: base, attachTo: document.body, global: { stubs } })
    const button = wrapper.get('button[aria-label="Sort: Name (A-Z)"]')
    await button.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const items = body().findAll('[role="menuitemcheckbox"]')
    expect(items.map((item) => [item.text(), item.attributes('aria-checked')])).toEqual([
      ['Name (A-Z)', 'true'],
      ['Newest first', 'false'],
    ])
    await items[1].trigger('click')
    expect(wrapper.emitted('update:sort')?.[0]).toEqual(['date:desc'])
    wrapper.unmount()
  })

  it('offers "Search in" only where the page binds the search fields', () => {
    const without = mount(LibraryToolbar, { props: base, global: { stubs } })
    expect(without.find('button[aria-label="Search in"]').exists()).toBe(false)
    const withFields = mount(LibraryToolbar, { props: { ...base, searchIn: { ...DEFAULT_SEARCH_IN } }, global: { stubs } })
    expect(withFields.find('button[aria-label="Search in"]').exists()).toBe(true)
    without.unmount()
    withFields.unmount()
  })

  it('toggles the bulk bar with a bare b (s is "send" on a card) and ignores it while typing', async () => {
    const wrapper = mount(LibraryToolbar, { props: base, attachTo: document.body, global: { stubs } })
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    expect(wrapper.emitted('toggle-select')).toBeUndefined()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))
    expect(wrapper.emitted('toggle-select')).toHaveLength(1)
    const input = wrapper.get('input[type="search"]').element as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))
    expect(wrapper.emitted('toggle-select')).toHaveLength(1)
    expect(wrapper.findAll('button').find((button) => button.text() === 'Select')!.attributes('aria-keyshortcuts')).toBe('B')
    wrapper.unmount()
  })

  it('focuses the library search with Ctrl+F', () => {
    const wrapper = mount(LibraryToolbar, {
      props: base,
      attachTo: document.body,
      global: { stubs: { SearchCombobox: { props: ['id'], template: '<input :id="id" type="search" />' } } },
    })
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('s')
    wrapper.unmount()
  })

  it('shows the active-view strip: count, one removable chip per scope and one Clear all', async () => {
    const removed: string[] = []
    const chips = ['Folder: styles', 'Starts with A', 'No credit required'].map((label) => ({ key: label, label, remove: () => removed.push(label) }))
    const wrapper = mount(LibraryToolbar, { props: { ...base, chips }, global: { stubs } })
    const strip = wrapper.get('[data-testid="active-view"]')
    expect(strip.attributes('aria-label')).toBe('Active view')
    expect(strip.text()).toContain('85 of 1,041 models')
    expect(strip.findAll('.lm-chip').map((chip) => chip.text())).toEqual(['Folder: styles', 'Starts with A', 'No credit required'])
    await strip.get('button[aria-label="Remove filter No credit required"]').trigger('click')
    expect(removed).toEqual(['No credit required'])
    await strip.findAll('button').find((button) => button.text() === 'Clear all')!.trigger('click')
    expect(wrapper.emitted('clear-filters')).toHaveLength(1)
    wrapper.unmount()
  })

  it('keeps the strip and its count on desktop with nothing active, without Clear all', () => {
    const wrapper = mount(LibraryToolbar, { props: base, global: { stubs } })
    const strip = wrapper.get('[data-testid="active-view"]')
    expect(strip.text()).toBe('85 of 1,041 models')
    expect(strip.findAll('button')).toHaveLength(0)
    wrapper.unmount()
  })

  it('opens the Filters flyout with f and clears only its groups from there', async () => {
    const wrapper = mount(LibraryToolbar, {
      props: base,
      attachTo: document.body,
      slots: { filters: '<p id="panel-content">panel</p>' },
      global: { stubs },
    })
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
    await flushPromises()
    const flyout = body().get('[role="dialog"][aria-label="Filters"]')
    expect(flyout.find('#loras-filters #panel-content').exists()).toBe(true)
    await flyout.findAll('button').find((button) => button.text() === 'Clear all')!.trigger('click')
    expect(wrapper.emitted('clear-panel')).toHaveLength(1)
    expect(wrapper.emitted('clear-filters')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps the toolbar in selection mode and shows Select as pressed (the bulk bar floats over the grid)', () => {
    const wrapper = mount(LibraryToolbar, { props: { ...base, selectionMode: true }, global: { stubs } })
    expect(wrapper.find('input[type="search"]').exists()).toBe(true)
    const select = wrapper.findAll('button').find((button) => button.text() === 'Select')!
    expect(select.attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('offers the Quick view toggle only where the page has one', async () => {
    const without = mount(LibraryToolbar, { props: base, global: { stubs } })
    expect(without.find('button[aria-label="Quick view"]').exists()).toBe(false)
    const withToggle = mount(LibraryToolbar, { props: { ...base, quickViewOption: true, quickView: true }, global: { stubs } })
    const toggle = withToggle.get('button[aria-label="Quick view"]')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    await toggle.trigger('click')
    expect(withToggle.emitted('update:quickView')?.[0]).toEqual([false])
    without.unmount()
    withToggle.unmount()
  })
})

describe('LibrarySelectionBar', () => {
  it('floats at the bottom, shows hidden selections and emits its actions', async () => {
    const wrapper = mount(LibrarySelectionBar, { props: { count: 3, hidden: 2, hasItems: true, hint: 'h' }, slots: { default: '<button>Move</button>' } })
    const bar = wrapper.get('[role="toolbar"]')
    expect(bar.attributes('aria-label')).toBe('Selection: 3 selected')
    expect(bar.classes()).toEqual(expect.arrayContaining(['absolute', 'bottom-4']))
    expect(wrapper.text()).toContain('3 selected')
    expect(wrapper.text()).toContain('2 not in view')
    expect(wrapper.text()).toContain('Move')
    for (const [label, event] of [['Select all loaded', 'all'], ['Select none', 'none'], ['Invert', 'invert'], ['Done', 'done']] as const) {
      await wrapper.findAll('button').find((b) => b.text() === label)!.trigger('click')
      expect(wrapper.emitted(event), event).toHaveLength(1)
    }
  })
})
