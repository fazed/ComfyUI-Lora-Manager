import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
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
  sortOptions: [{ value: 'name:asc', label: 'library.sort.nameAsc' as const }],
  foldersId: 'folders-loras',
  foldersOpen: false,
  folderActive: false,
  filterCount: 2,
  chips: [],
  selectionMode: false,
  toolItems: [{ id: 'organize', label: 'Organize...' }],
  search: '',
  sort: 'name:asc',
  cardSize: 210,
}

const stubs = { SearchCombobox: { template: '<input type="search" />' } }

describe('LibraryToolbar', () => {
  it('renders a labelled toolbar with the filter badge and count', () => {
    const wrapper = mount(LibraryToolbar, { props: base, global: { stubs } })
    const bar = wrapper.get('[role="toolbar"]')
    expect(bar.attributes('aria-label')).toBe('LoRAs toolbar')
    expect(wrapper.text()).toContain('85 of 1,041 models')
    expect(wrapper.find('.lm-badge').text()).toBe('2')
    wrapper.unmount()
  })

  it('toggles the selection with a bare s and ignores it while typing', async () => {
    const wrapper = mount(LibraryToolbar, { props: base, attachTo: document.body, global: { stubs } })
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    expect(wrapper.emitted('toggle-select')).toHaveLength(1)
    const input = wrapper.get('input[type="search"]').element as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    expect(wrapper.emitted('toggle-select')).toHaveLength(1)
    wrapper.unmount()
  })

  it('opens the filter panel with f and renders it inline', async () => {
    const wrapper = mount(LibraryToolbar, {
      props: base,
      attachTo: document.body,
      slots: { filters: '<p id="panel-content">panel</p>' },
      global: { stubs },
    })
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#loras-filters #panel-content').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the selection bar instead of the toolbar row', () => {
    const wrapper = mount(LibraryToolbar, {
      props: { ...base, selectionMode: true },
      slots: { selection: '<p id="bar">bar</p>' },
      global: { stubs },
    })
    expect(wrapper.find('#bar').exists()).toBe(true)
    expect(wrapper.find('input[type="search"]').exists()).toBe(false)
  })
})

describe('LibrarySelectionBar', () => {
  it('shows hidden selections and emits its actions', async () => {
    const wrapper = mount(LibrarySelectionBar, { props: { count: 3, hidden: 2, hasItems: true, hint: 'h' }, slots: { default: '<button>Move</button>' } })
    expect(wrapper.text()).toContain('3 selected')
    expect(wrapper.text()).toContain('2 not in view')
    await wrapper.findAll('button').find((b) => b.text() === 'Done')!.trigger('click')
    expect(wrapper.emitted('done')).toHaveLength(1)
  })
})
