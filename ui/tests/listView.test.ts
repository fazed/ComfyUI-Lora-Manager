/**
 * Compact list ("Rows") view of the model libraries: the shared grid/list
 * maths, the persisted per-library view mode, the row component and the
 * View popover's layout choice. Written before the implementation.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import { nextTick } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { ModelItem } from '@/api/types'
import { cardTextHeight, gridMetrics, parseLength, rowTop, type LayoutTokens } from '@/utils/gridLayout'
import { DEFAULT_CARD_SHOW, useLibraryFilters, VIEW_MODES } from '@/composables/useLibraryFilters'
import { LIBRARIES } from '@/config/libraries'
import ModelRow from '@/components/ModelRow.vue'
import ModelCard from '@/components/ModelCard.vue'
import { cardTextLines, DEFAULT_CARD_DISPLAY, type ModelItemViewEmits, type ModelItemViewProps } from '@/components/modelItemView'
import LazyMedia from '@/components/LazyMedia.vue'
import ListHeader from '@/components/ListHeader.vue'
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

  it('adds the text block under the image to the card height, never to list rows', () => {
    const plain = gridMetrics('grid', 1200, 210, tokens)
    const withText = gridMetrics('grid', 1200, 210, tokens, 48)
    expect(withText.columns).toBe(plain.columns)
    expect(withText.itemHeight).toBeCloseTo(plain.itemHeight + 48)
    expect(rowTop(7, withText)).toBeCloseTo(withText.itemHeight + 14)
    expect(gridMetrics('list', 1200, 210, tokens, 48).itemHeight).toBe(56)
    // Square cards: the image is as tall as it is wide.
    const square = gridMetrics('grid', 1200, 210, { ...tokens, aspect: 1 })
    expect(square.itemHeight).toBeCloseTo(square.itemWidth)
  })

  it('derives the card text height from the shown lines', () => {
    expect(cardTextHeight(0)).toBe(0)
    expect(cardTextHeight(1)).toBe(28)
    expect(cardTextHeight(3)).toBe(68)
    expect(cardTextLines(DEFAULT_CARD_DISPLAY)).toBe(3)
    expect(cardTextLines({ ...DEFAULT_CARD_DISPLAY, name: false, meta: false, versionRow: false })).toBe(0)
    expect(cardTextLines({ ...DEFAULT_CARD_DISPLAY, tags: true })).toBe(4)
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

  it('converts rem token values with the root font size (text-size setting)', () => {
    expect(parseLength('3.5rem', 1)).toBe(56)
    expect(parseLength(' 0.875rem ', 1)).toBe(14)
    expect(parseLength('3.5rem', 1, 20)).toBe(70)
    expect(parseLength('56px', 1, 20)).toBe(56)
    expect(parseLength('rem', 9, 20)).toBe(9)
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

  it('persists shape, image fit and "show on cards", validated on read', async () => {
    const loras = useLibraryFilters(LIBRARIES.loras)
    expect([loras.shape.value, loras.fit.value]).toEqual(['portrait', 'cover'])
    expect(loras.show.value).toEqual(DEFAULT_CARD_SHOW)
    loras.shape.value = 'square'
    loras.fit.value = 'contain'
    loras.show.value = { ...loras.show.value, tags: true, meta: false }
    await nextTick()
    const again = useLibraryFilters(LIBRARIES.loras)
    expect([again.shape.value, again.fit.value, again.show.value.tags, again.show.value.meta]).toEqual(['square', 'contain', true, false])
    localStorage.setItem('lm-ui.library.loras', JSON.stringify({ shape: 'original', fit: 'stretch', show: { name: 'yes', tags: true } }))
    const bad = useLibraryFilters(LIBRARIES.loras)
    expect([bad.shape.value, bad.fit.value]).toEqual(['portrait', 'cover'])
    expect(bad.show.value).toEqual({ ...DEFAULT_CARD_SHOW, tags: true })
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

  it('copies the LoRA syntax from its own button and hides send and copy where impossible', async () => {
    const wrapper = mount(ModelRow, { props: rowProps })
    await wrapper.get('button[aria-label="Copy LoRA syntax"]').trigger('click')
    expect(wrapper.emitted('copy')?.[0]).toEqual([rowProps.item])
    expect(wrapper.emitted('open')).toBeUndefined()
    const none = mount(ModelRow, { props: { ...rowProps, canSend: false } })
    expect(none.find('button[aria-label="Send to ComfyUI"]').exists()).toBe(false)
    expect(none.find('button[aria-label="Copy LoRA syntax"]').exists()).toBe(false)
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
    const revealed = mount(ModelRow, { props: { ...rowProps, item: item({ preview_nsfw_level: 8 }), blurMature: true, revealed: true } })
    expect(revealed.find('[data-blurred]').exists()).toBe(false)
  })
})

const cardProps = { ...rowProps, civitaiHost: 'civitai.com', item: item({ civitai: { modelId: 12, id: 34, name: 'v2.0' } }) }

describe('ModelCard', () => {
  it('shows the name, size / usage and version row below the image', () => {
    const wrapper = mount(ModelCard, {
      props: { ...cardProps, item: item({ civitai: { name: 'v2.0' }, quantization: 'FP8', auto_tags: ['HIGH', 'I2V'], version_count: 3, usage_count: 7 }) },
    })
    expect(wrapper.text()).toContain('Model A')
    expect(wrapper.get('[data-testid="card-meta"]').text()).toBe('150.0 MB · 7× used')
    const version = wrapper.get('[data-testid="card-version"]').text()
    for (const part of ['v2.0', 'FP8', 'HIGH', '3 versions']) expect(version).toContain(part)
    expect(version).not.toContain('I2V')
  })

  it('follows "show on cards" and the image fit', () => {
    const display = { ...DEFAULT_CARD_DISPLAY, meta: false, versionRow: false, baseModel: false, fit: 'contain' as const }
    const wrapper = mount(ModelCard, { props: { ...cardProps, display } })
    expect(wrapper.find('[data-testid="card-meta"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="card-version"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('SDXL 1.0')
    expect(wrapper.findComponent(LazyMedia).props('mediaClass')).toContain('object-contain')
  })

  it('offers favorite, View on Civitai, send, copy and more in the hover bar', async () => {
    const wrapper = mount(ModelCard, { props: cardProps })
    const bar = wrapper.get('[data-testid="card-actions"]')
    expect(bar.get('a[aria-label="View on Civitai"]').attributes('href')).toContain('civitai.com/models/12')
    await bar.get('button[aria-label="Copy LoRA syntax"]').trigger('click')
    expect(wrapper.emitted('copy')?.[0]).toEqual([cardProps.item])
    await bar.get('button[aria-label="Send to ComfyUI"]').trigger('click', { shiftKey: true })
    expect(wrapper.emitted('send')?.[0]).toEqual([cardProps.item, true])
    await bar.get('button[aria-label="Toggle favorite"]').trigger('click')
    expect(wrapper.emitted('toggle-favorite')).toHaveLength(1)
    expect(wrapper.emitted('open')).toBeUndefined()
    // No Civitai id: no link.
    expect(mount(ModelCard, { props: rowProps }).find('a[aria-label="View on Civitai"]').exists()).toBe(false)
  })

  it('shows the state icons from the list payload', () => {
    const wrapper = mount(ModelCard, { props: { ...cardProps, item: item({ favorite: true, skip_metadata_refresh: true, exclude: true }) } })
    for (const label of ['Favorite', 'Skipped in metadata refresh', 'Excluded']) {
      expect(wrapper.find(`[role="img"][aria-label="${label}"]`).exists(), label).toBe(true)
    }
  })

  it('reveals a blurred mature preview through the page (Show), and blurs it again', async () => {
    const mature = item({ preview_nsfw_level: 8 })
    const wrapper = mount(ModelCard, { props: { ...cardProps, item: mature, blurMature: true } })
    expect(wrapper.find('[data-blurred]').exists()).toBe(true)
    await wrapper.get('[data-testid="reveal"]').trigger('click')
    expect(wrapper.emitted('reveal')?.[0]).toEqual([mature])
    expect(wrapper.emitted('open')).toBeUndefined()
    await wrapper.setProps({ revealed: true })
    expect(wrapper.find('[data-blurred]').exists()).toBe(false)
    await wrapper.get('button[aria-label="Blur again: Model A"]').trigger('click')
    expect(wrapper.emitted('reveal')).toHaveLength(2)
  })

  it('outlines the focused card in place', async () => {
    const wrapper = mount(ModelCard, { props: cardProps })
    expect(wrapper.html()).not.toContain('ring-selected')
    await wrapper.setProps({ focused: true })
    expect(wrapper.html()).toContain('ring-selected')
    expect(wrapper.get('article > button').attributes('aria-current')).toBe('true')
  })
})

describe('ListHeader', () => {
  it('sorts by name, size and date with aria-sort and reverses on a second click', async () => {
    const wrapper = mount(ListHeader, { props: { sort: 'name:asc', selectionMode: false, canSend: true } })
    const headers = wrapper.findAll('[role="columnheader"]')
    expect(headers.map((header) => header.attributes('aria-sort') ?? null)).toEqual(['ascending', null, 'none', 'none', null])
    await wrapper.get('button[aria-label="Sort by Name"]').trigger('click')
    expect(wrapper.emitted('update:sort')?.[0]).toEqual(['name:desc'])
    await wrapper.get('button[aria-label="Sort by Size"]').trigger('click')
    expect(wrapper.emitted('update:sort')?.[1]).toEqual(['size:desc'])
    await wrapper.setProps({ sort: 'date:desc' })
    expect(wrapper.findAll('[role="columnheader"]')[3].attributes('aria-sort')).toBe('descending')
    await wrapper.get('button[aria-label="Sort by Date"]').trigger('click')
    expect(wrapper.emitted('update:sort')?.[2]).toEqual(['date:asc'])
  })
})

describe('ModelRow / ModelCard contract', () => {
  // Compile-time: checked by `bun run typecheck` / `bun run build` (vue-tsc), a no-op at runtime.
  // Props and emitted events (the `onX` handler props) must be identical, so LibraryPage can bind
  // the same handlers to both views and a drift in either component fails the type check.
  it('exposes exactly the same props and events on both views', () => {
    expectTypeOf<InstanceType<typeof ModelRow>['$props']>().toEqualTypeOf<InstanceType<typeof ModelCard>['$props']>()
    expectTypeOf<InstanceType<typeof ModelRow>['$props']>().toMatchTypeOf<ModelItemViewProps>()
    expectTypeOf<NonNullable<InstanceType<typeof ModelRow>['$props']['onToggle-select']>>().parameters.toEqualTypeOf<
      ModelItemViewEmits['toggle-select']
    >()
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

describe('View options popover (layout and card size)', () => {
  let wrapper: VueWrapper | null = null
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  /** Mounts the toolbar and opens its View popover (teleported to the body). */
  async function openView(props: Record<string, unknown> = {}) {
    wrapper = mount(LibraryToolbar, { props: { ...toolbarBase, ...props }, global: { stubs }, attachTo: document.body })
    await wrapper.findAll('button').find((button) => button.text() === 'View')!.trigger('click')
    await flushPromises()
    return new DOMWrapper(document.body).get('[role="dialog"][aria-label="View"]')
  }

  it('offers the layout as a labelled pair of radios and emits the new view', async () => {
    const popover = await openView()
    const layout = popover.get('fieldset')
    expect(layout.get('legend').text()).toBe('Layout')
    const radios = layout.findAll<HTMLInputElement>('input[type="radio"]')
    expect(layout.findAll('label').map((label) => label.text())).toEqual(['Grid view', 'List view'])
    expect(radios.map((radio) => radio.element.checked)).toEqual([true, false])
    // The card-size slider is available in grid mode.
    expect(popover.find('input[type="range"]').exists()).toBe(true)
    await radios[1].setValue(true)
    expect(wrapper!.emitted('update:view')?.[0]).toEqual(['list'])
  })

  it('hides only the card-size slider in list mode', async () => {
    const popover = await openView({ view: 'list' })
    expect(popover.find('input[type="range"]').exists()).toBe(false)
    expect(popover.findAll<HTMLInputElement>('input[type="radio"]')[1].element.checked).toBe(true)
  })

  it('has no layout choice where the page does not offer one (recipes)', async () => {
    const popover = await openView({ viewToggle: false })
    expect(popover.findAll('legend').map((legend) => legend.text())).toEqual(['Shape', 'Image'])
    expect(popover.find('input[type="range"]').exists()).toBe(true)
  })

  it('sets shape, image fit and "show on cards" in grid view, and resets them', async () => {
    const popover = await openView({ show: { ...DEFAULT_CARD_SHOW } })
    expect(popover.findAll('legend').map((legend) => legend.text())).toEqual(['Layout', 'Shape', 'Image', 'Show on cards'])
    await popover.get('input[value="square"]').setValue(true)
    expect(wrapper!.emitted('update:shape')?.[0]).toEqual(['square'])
    await popover.get('input[value="contain"]').setValue(true)
    expect(wrapper!.emitted('update:fit')?.[0]).toEqual(['contain'])
    const tags = popover.findAll('label').find((label) => label.text() === 'Tags')!
    await tags.get('input').trigger('change')
    expect(wrapper!.emitted('update:show')?.[0]).toEqual([{ ...DEFAULT_CARD_SHOW, tags: true }])
    await popover.findAll('button').find((button) => button.text() === 'Reset view')!.trigger('click')
    expect(wrapper!.emitted('update:shape')?.at(-1)).toEqual(['portrait'])
    expect(wrapper!.emitted('update:fit')?.at(-1)).toEqual(['cover'])
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
