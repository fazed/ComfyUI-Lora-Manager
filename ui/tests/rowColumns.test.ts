/**
 * Column layout of the list ("Rows") view: the container-query thresholds at
 * which the date and tags columns appear, the space they leave for the name,
 * the base-model width token, and full text for every truncated cell.
 * Written before the implementation.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ModelItem } from '@/api/types'
import {
  ROW_COLUMN_HIDE_CLASS,
  ROW_COLUMN_MIN_WIDTH,
  ROW_FIXED_WIDTHS,
  ROW_NAME_MIN_WIDTH,
  rowColumnsAt,
  rowNameWidth,
  rowTooltip,
} from '@/utils/rowColumns'
import ModelRow from '@/components/ModelRow.vue'

const baseCss = readFileSync(resolve(__dirname, '../src/themes/base.css'), 'utf8')
const tokenPx = (name: string) => Number.parseFloat(new RegExp(`${name}:\\s*([\\d.]+)px`).exec(baseCss)?.[1] ?? 'NaN')

describe('row column thresholds', () => {
  it('pins the breakpoints (row width, not viewport)', () => {
    expect(ROW_COLUMN_MIN_WIDTH).toEqual({ date: 820, tags: 1060 })
    expect(ROW_COLUMN_HIDE_CLASS).toEqual({ date: '@max-[820px]:hidden', tags: '@max-[1060px]:hidden' })
  })

  it('shows the date from 820px and the tags from 1060px of row width', () => {
    expect(rowColumnsAt(600)).toEqual(['name', 'baseModel', 'size'])
    expect(rowColumnsAt(819)).toEqual(['name', 'baseModel', 'size'])
    expect(rowColumnsAt(820)).toEqual(['name', 'baseModel', 'size', 'date'])
    expect(rowColumnsAt(1059)).toEqual(['name', 'baseModel', 'size', 'date'])
    expect(rowColumnsAt(1060)).toEqual(['name', 'baseModel', 'size', 'date', 'tags'])
  })

  it('uses the base-model width token from base.css (no magic number in the row)', () => {
    expect(tokenPx('--lm-row-badge-max-width')).toBe(ROW_FIXED_WIDTHS.baseModel)
    expect(tokenPx('--lm-row-thumb')).toBe(ROW_FIXED_WIDTHS.thumb)
  })

  it('leaves the name at least ROW_NAME_MIN_WIDTH when a column appears, in the worst case', () => {
    // Worst case: selection mode (indicator) and the Send button (LoRAs).
    const worst = { selection: true, send: true }
    expect(rowNameWidth(ROW_COLUMN_MIN_WIDTH.date, worst)).toBeGreaterThanOrEqual(ROW_NAME_MIN_WIDTH)
    expect(rowNameWidth(ROW_COLUMN_MIN_WIDTH.tags, worst)).toBeGreaterThanOrEqual(ROW_NAME_MIN_WIDTH)
    // Just below each breakpoint the column is still hidden, so the name never drops below the minimum there either.
    expect(rowNameWidth(ROW_COLUMN_MIN_WIDTH.date - 1, worst)).toBeGreaterThanOrEqual(ROW_NAME_MIN_WIDTH)
    // ...and the thresholds are not wastefully high: one column narrower would already squeeze the name.
    expect(rowNameWidth(ROW_COLUMN_MIN_WIDTH.date - 100, { selection: true, send: true, columns: ['name', 'baseModel', 'size', 'date'] })).toBeLessThan(
      ROW_NAME_MIN_WIDTH,
    )
  })
})

function item(overrides: Partial<ModelItem> = {}): ModelItem {
  return {
    model_name: 'Model A',
    file_name: 'model-a',
    file_path: 'D:/loras/model-a.safetensors',
    folder: 'styles/anime/very/deep/folder',
    preview_url: '',
    base_model: 'SDXL 1.0',
    file_size: 150 * 1024 * 1024,
    modified: 1_700_000_000,
    tags: ['style', 'anime', 'flat'],
    ...overrides,
  }
}

const LONG_BASE = 'Illustrious XL v2.0 Experimental Extended Edition (Community Merge)'

describe('rowTooltip', () => {
  it('lists every cell in full, including columns hidden at the current width', () => {
    const text = rowTooltip(item({ base_model: LONG_BASE }), { folder: 'styles/anime/very/deep/folder', size: '150.0 MB', date: '2023-11-14 22:13', tags: 'style · anime · flat' })
    expect(text.split('\n')).toEqual(['Model A', 'styles/anime/very/deep/folder', LONG_BASE, '150.0 MB · 2023-11-14 22:13', 'style · anime · flat'])
  })

  it('skips empty parts', () => {
    expect(rowTooltip(item({ base_model: '' }), { folder: 'Library root', size: '', date: '', tags: '' })).toBe('Model A\nLibrary root')
  })
})

describe('ModelRow truncation', () => {
  const props = { item: item({ base_model: LONG_BASE }), selectionMode: false, selected: false, blurMature: false, canSend: true }

  it('ellipsises a very long base model inside a token-wide cell and keeps the full name in a title', () => {
    const wrapper = mount(ModelRow, { props })
    const cell = wrapper.get('[data-cell="base-model"]')
    expect(cell.classes()).toContain('w-(--lm-row-badge-max-width)')
    expect(cell.classes()).toContain('min-w-0')
    expect(cell.html()).not.toContain('140px')
    const badge = cell.get('.lm-badge')
    expect(badge.attributes('title')).toBe(LONG_BASE)
    expect(badge.classes()).toEqual(expect.arrayContaining(['max-w-full', 'min-w-0']))
    // Ellipsis needs a block-level text box: the text sits in its own truncating span inside the flex badge.
    const text = badge.get('span.truncate')
    expect(text.text()).toBe(LONG_BASE)
  })

  it('gives every truncating cell its full text as a title', () => {
    const wrapper = mount(ModelRow, { props })
    for (const name of ['name', 'folder', 'base-model', 'size', 'date', 'tags']) {
      const cell = wrapper.get(`[data-cell="${name}"]`)
      const titled = cell.attributes('title') ? cell : cell.get('[title]')
      expect(titled.attributes('title'), name).toBeTruthy()
      expect(titled.attributes('title')).toBe(titled.text())
    }
  })

  it('shows the whole row in a tooltip on the full-row button (the cells do not take the pointer)', () => {
    const wrapper = mount(ModelRow, { props })
    const title = wrapper.get('article > button').attributes('title') ?? ''
    for (const part of ['Model A', 'styles/anime/very/deep/folder', LONG_BASE, '150.0 MB', 'style · anime · flat']) expect(title).toContain(part)
  })

  it('takes the date and tags breakpoints from the shared constants', () => {
    const wrapper = mount(ModelRow, { props })
    expect(wrapper.get('[data-cell="date"]').classes()).toContain(ROW_COLUMN_HIDE_CLASS.date)
    expect(wrapper.get('[data-cell="tags"]').classes()).toContain(ROW_COLUMN_HIDE_CLASS.tags)
  })
})
