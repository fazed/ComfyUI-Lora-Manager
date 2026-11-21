/**
 * Compact list ("Rows") view of the model libraries: the shared grid/list
 * maths, the persisted per-library view mode, the row component and the
 * toolbar's view switch. Written before the implementation.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { ModelItem } from '@/api/types'
import { gridMetrics, parseLength, rowTop, type LayoutTokens } from '@/utils/gridLayout'
import { useLibraryFilters, VIEW_MODES } from '@/composables/useLibraryFilters'
import { LIBRARIES } from '@/config/libraries'
import ModelRow from '@/components/ModelRow.vue'
import LibraryToolbar from '@/components/LibraryToolbar.vue'
import VirtualGrid from '@/components/VirtualGrid.vue'

const tokens: LayoutTokens = { aspect: 2 / 3, cardGap: 14, rowHeight: 56, rowGap: 6 }

describe('gridMetrics', () => {
  it('keeps the card grid maths', () => {
    const grid = gridMetrics('grid', 1200, 210, tokens)
    expect(grid.columns).toBe(5)
    expect(grid.gap).toBe(14)
    expect(grid.itemWidth).toBeCloseTo((1200 - 4 * 14) / 5)
    expect(grid.itemHeight).toBeCloseTo(grid.itemWidth / (2 / 3))
    // Phone widths still allow two columns.
    expect(gridMetrics('grid', 351, 360, tokens).columns).toBe(2)
  })

  it('uses one full-width column with the row tokens in list mode, whatever the card size', () => {
    for (const width of [0, 351, 1200, 2400]) {
      const list = gridMetrics('list', width, 360, tokens)
      expect(list).toEqual({ columns: 1, gap: 6, itemWidth: Math.max(0, width), itemHeight: 56 })
    }
  })

  it('never returns a row shorter than 1px or a negative gap', () => {
    const list = gridMetrics('list', 800, 210, { ...tokens, rowHeight: 0, rowGap: -3 })
    expect(list.itemHeight).toBeGreaterThan(0)
    expect(list.gap).toBe(0)
  })
})

describe('rowTop', () => {
  it('finds the offset of an item row in both layouts (scrollToIndex / drawer prev-next)', () => {
    const grid = gridMetrics('grid', 1200, 210, tokens)
    expect(rowTop(7, grid)).toBeCloseTo(1 * (grid.itemHeight + 14))
    const list = gridMetrics('list', 1200, 210, tokens)
    expect(rowTop(0, list)).toBe(0)
    expect(rowTop(10, list)).toBe(10 * 62)
  })
})

describe('parseLength', () => {
  it('reads px token values and falls back on garbage', () => {
    expect(parseLength('56px', 1)).toBe(56)
    expect(parseLength(' 40 ', 1)).toBe(40)
    expect(parseLength('', 12)).toBe(12)
    expect(parseLength('auto', 12)).toBe(12)
  })
})

describe('useLibraryFilters view mode', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to grid and persists list per library', async () => {
    expect(VIEW_MODES).toEqual(['grid', 'list'])
    const loras = useLibraryFilters(LIBRARIES.loras)
    expect(loras.view.value).toBe('grid')
    loras.view.value = 'list'
    await nextTick()
    expect(JSON.parse(localStorage.getItem('lm-ui.library.loras') ?? '{}').view).toBe('list')
    expect(useLibraryFilters(LIBRARIES.loras).view.value).toBe('list')
    expect(useLibraryFilters(LIBRARIES.checkpoints).view.value).toBe('grid')
  })

  it('ignores an invalid stored view', () => {
    localStorage.setItem('lm-ui.library.loras', JSON.stringify({ view: 'table', sort: 'name:asc' }))
    expect(useLibraryFilters(LIBRARIES.loras).view.value).toBe('grid')
  })
})

function item(overrides: Partial<ModelItem> = {}): ModelItem {
  return {
    model_name: 'Model A',
    file_name: 'model-a',
    file_path: 'D:/loras/styles/model-a.safetensors',
    folder: 'styles',
    preview_url: '/api/lm/previews?path=a.webp',
    base_model: 'SDXL 1.0',
    file_size: 150 * 1024 * 1024,
    modified: 1_700_000_000,
    tags: ['style', 'anime', 'flat', 'extra'],
    ...overrides,
  }
}

const rowProps = { item: item(), selectionMode: false, selected: false, blurMature: false, canSend: true }

describe('ModelRow', () => {
  it('renders name, folder, base model, size, date and tags with a labelled primary button', () => {
    const wrapper = mount(ModelRow, { props: rowProps })
    const primary = wrapper.get('article > button')
    expect(primary.attributes('aria-label')).toBe('Open details for Model A')
    expect(primary.attributes('aria-pressed')).toBeUndefined()
    const text = wrapper.text()
    for (const part of ['Model A', 'styles', 'SDXL 1.0', '150.0 MB', 'style']) expect(text).toContain(part)
    expect(wrapper.find('.lm-badge').text()).toBe('SDXL 1.0')
  })

  it('emits the same events as the card, with always-visible trailing buttons', async () => {
    const wrapper = mount(ModelRow, { props: rowProps })
    await wrapper.get('article > button').trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual([rowProps.item])
    await wrapper.get('button[aria-label="Send to ComfyUI"]').trigger('click', { shiftKey: true })
    expect(wrapper.emitted('send')?.[0]).toEqual([rowProps.item, true])
    await wrapper.get('button[aria-label="Toggle favorite"]').trigger('click')
    expect(wrapper.emitted('toggle-favorite')).toHaveLength(1)
    const more = wrapper.get('button[aria-haspopup="menu"]')
    expect(more.classes().join(' ')).not.toContain('opacity-0')
    await more.trigger('click')
    expect(wrapper.emitted('menu')).toHaveLength(1)
    await wrapper.get('article').trigger('contextmenu', { clientX: 3, clientY: 4 })
    expect(wrapper.emitted('menu')?.[1]?.[1]).toEqual({ x: 3, y: 4 })
    // Ctrl+click toggles the selection like on cards.
    await wrapper.get('article > button').trigger('click', { ctrlKey: true })
    expect(wrapper.emitted('toggle-select')).toHaveLength(1)
  })

  it('hides send where sending is impossible', () => {
    const wrapper = mount(ModelRow, { props: { ...rowProps, canSend: false } })
    expect(wrapper.find('button[aria-label="Send to ComfyUI"]').exists()).toBe(false)
  })

  it('shows the selection state in selection mode', async () => {
    const wrapper = mount(ModelRow, { props: { ...rowProps, selectionMode: true, selected: true } })
    const primary = wrapper.get('article > button')
    expect(primary.attributes('aria-label')).toBe('Select Model A')
    expect(primary.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-selection-indicator]').exists()).toBe(true)
    await primary.trigger('click', { shiftKey: true })
    expect(wrapper.emitted('toggle-select')?.[0]).toEqual([rowProps.item, true])
  })

  it('blurs a mature thumbnail', () => {
    const blurred = mount(ModelRow, { props: { ...rowProps, item: item({ preview_nsfw_level: 8 }), blurMature: true } })
    expect(blurred.find('[data-blurred]').exists()).toBe(true)
    const clear = mount(ModelRow, { props: { ...rowProps, item: item({ preview_nsfw_level: 8 }), blurMature: false } })
    expect(clear.find('[data-blurred]').exists()).toBe(false)
  })
})

const toolbarBase = {
  title: 'LoRAs',
  countText: '1 model',
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
  filterCount: 0,
  chips: [],
  selectionMode: false,
  toolItems: [],
  search: '',
  sort: 'name:asc',
  cardSize: 210,
  viewToggle: true,
  view: 'grid' as const,
}
const stubs = { SearchCombobox: { template: '<input type="search" />' } }

describe('LibraryToolbar view switch', () => {
  it('renders a labelled group of two pressed-state buttons and emits the new view', async () => {
    const wrapper = mount(LibraryToolbar, { props: toolbarBase, global: { stubs } })
    const group = wrapper.get('[role="group"][aria-label="View"]')
    const buttons = group.findAll('button')
    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual(['Grid view', 'List view'])
    expect(buttons.map((button) => button.attributes('aria-pressed'))).toEqual(['true', 'false'])
    // The card-size slider is available in grid mode at every desktop width.
    expect(wrapper.find('input[type="range"]').exists()).toBe(true)
    await buttons[1].trigger('click')
    expect(wrapper.emitted('update:view')?.[0]).toEqual(['list'])
  })

  it('hides only the card-size slider in list mode', () => {
    const wrapper = mount(LibraryToolbar, { props: { ...toolbarBase, view: 'list' as const }, global: { stubs } })
    expect(wrapper.find('input[type="range"]').exists()).toBe(false)
    expect(wrapper.get('[role="group"][aria-label="View"]').findAll('button')[1].attributes('aria-pressed')).toBe('true')
  })

  it('has no view switch where the page does not offer one (recipes)', () => {
    const wrapper = mount(LibraryToolbar, { props: { ...toolbarBase, viewToggle: false }, global: { stubs } })
    expect(wrapper.find('[role="group"][aria-label="View"]').exists()).toBe(false)
  })
})

describe('VirtualGrid list layout', () => {
  it('lays the items out in one column with the row gap', () => {
    const wrapper = mount(VirtualGrid, {
      props: { items: ['a', 'b'], itemKey: (value: unknown) => String(value), minItemWidth: 210, layout: 'list' },
      slots: { default: '<span class="cell">x</span>' },
    })
    const list = wrapper.get('[role="list"]')
    expect(list.attributes('style')).toContain('repeat(1, minmax(0, 1fr))')
    expect(list.classes()).toContain('gap-[var(--lm-row-gap)]')
    expect(list.classes()).not.toContain('will-change-transform')
  })
})
