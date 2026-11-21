import { beforeEach, describe, expect, it } from 'vitest'
import { effectiveMinWidth, gridColumns } from '@/utils/gridLayout'
import {
  clearBrowseView,
  saveBrowseView,
  shouldHandleShortcut,
  takeBrowseView,
  unfilteredTotal,
  type BrowseViewState,
} from '@/utils/browse'
import { hiddenSelectedCount, selectRange } from '@/utils/modelActions'

describe('selectRange', () => {
  const keys = ['a', 'b', 'c', 'd', 'e']
  it('selects between anchor and target in either direction', () => {
    expect(selectRange(keys, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(selectRange(keys, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(selectRange(keys, 'c', 'c')).toEqual(['c'])
  })
  it('falls back to the target without a usable anchor', () => {
    expect(selectRange(keys, null, 'c')).toEqual(['c'])
    expect(selectRange(keys, 'gone', 'c')).toEqual(['c'])
  })
  it('returns nothing for a target that is not listed', () => {
    expect(selectRange(keys, 'a', 'zzz')).toEqual([])
  })
  it('counts selected keys that are not in view', () => {
    expect(hiddenSelectedCount(new Set(['a', 'x', 'y']), keys)).toBe(2)
    expect(hiddenSelectedCount(new Set(), keys)).toBe(0)
  })
})

describe('gridColumns', () => {
  it('matches the desktop auto-fill maths', () => {
    expect(gridColumns(1200, 14, 210)).toBe(5)
    expect(gridColumns(700, 14, 210)).toBe(3)
  })
  it('always allows two columns on phone widths', () => {
    expect(effectiveMinWidth(351, 14, 210)).toBeCloseTo(168.5)
    expect(gridColumns(351, 14, 210)).toBe(2)
    expect(gridColumns(351, 14, 360)).toBe(2)
  })
  it('does not apply the phone rule from 640px up', () => {
    expect(gridColumns(640, 14, 360)).toBe(1)
  })
})

describe('unfilteredTotal', () => {
  it('shows the unfiltered total only while filtered and larger', () => {
    expect(unfilteredTotal(85, 1041, true)).toBe(1041)
    expect(unfilteredTotal(85, 1041, false)).toBeNull()
    expect(unfilteredTotal(85, null, true)).toBeNull()
    expect(unfilteredTotal(85, 85, true)).toBeNull()
  })
})

describe('shouldHandleShortcut', () => {
  const body = { closest: () => null }
  const field = { closest: (selector: string) => (selector.includes('input') ? {} : null) }
  it('handles a bare matching key', () => {
    expect(shouldHandleShortcut({ key: 'f', target: body }, 'f', false)).toBe(true)
    expect(shouldHandleShortcut({ key: 'F', target: body }, 'f', false)).toBe(true)
  })
  it('ignores other keys, modifiers, repeats and composition', () => {
    expect(shouldHandleShortcut({ key: 'x', target: body }, 'f', false)).toBe(false)
    expect(shouldHandleShortcut({ key: 'f', ctrlKey: true, target: body }, 'f', false)).toBe(false)
    expect(shouldHandleShortcut({ key: 'f', shiftKey: true, target: body }, 'f', false)).toBe(false)
    expect(shouldHandleShortcut({ key: 'f', repeat: true, target: body }, 'f', false)).toBe(false)
    expect(shouldHandleShortcut({ key: 'f', isComposing: true, target: body }, 'f', false)).toBe(false)
  })
  it('ignores typing targets, containers that own keys and open overlays', () => {
    expect(shouldHandleShortcut({ key: 'f', target: field }, 'f', false)).toBe(false)
    expect(shouldHandleShortcut({ key: 'f', target: body }, 'f', true)).toBe(false)
    expect(shouldHandleShortcut({ key: 'f', defaultPrevented: true, target: body }, 'f', false)).toBe(false)
  })
})

describe('browse view store', () => {
  const view: BrowseViewState = {
    search: 'x',
    folder: 'a/b',
    baseModels: ['SDXL'],
    tags: ['t'],
    favoritesOnly: true,
    updatesOnly: false,
    missingOnly: false,
    scrollTop: 640,
    loadedCount: 120,
  }
  beforeEach(() => clearBrowseView())
  it('keeps one snapshot per prefix, copied on save', () => {
    saveBrowseView('loras', view)
    view.baseModels.push('Flux')
    expect(takeBrowseView('loras')?.baseModels).toEqual(['SDXL'])
    expect(takeBrowseView('checkpoints')).toBeNull()
  })
  it('clears one prefix or all', () => {
    saveBrowseView('loras', view)
    saveBrowseView('recipes', view)
    clearBrowseView('loras')
    expect(takeBrowseView('loras')).toBeNull()
    expect(takeBrowseView('recipes')).not.toBeNull()
  })
})
