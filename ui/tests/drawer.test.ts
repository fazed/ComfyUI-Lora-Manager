/**
 * Model drawer helpers (flyout UX pass): mature-content blur rule, usage-tip
 * chips, tab keyboard navigation, discard-notes decision and the current
 * version. Written before the implementation.
 */
import { describe, expect, it } from 'vitest'
import { isBlurred } from '@/utils/mature'
import { usageTipEntries } from '@/utils/workflow'
import { currentVersionId, nextTab, shouldConfirmClose } from '@/utils/drawer'

describe('isBlurred', () => {
  it('blurs levels >= 4 only while the setting is on', () => {
    expect(isBlurred(4, true)).toBe(true)
    expect(isBlurred(16, true)).toBe(true)
    expect(isBlurred(2, true)).toBe(false)
    expect(isBlurred(8, false)).toBe(false)
  })
  it('treats a missing level as safe', () => {
    expect(isBlurred(undefined, true)).toBe(false)
    expect(isBlurred(null, true)).toBe(false)
  })
})

describe('usageTipEntries', () => {
  it('lists strength and clip strength first, from a JSON string', () => {
    const entries = usageTipEntries('{"clip_strength": 1, "strength": 0.8}')
    expect(entries.map((entry) => entry.text)).toEqual(['strength 0.8', 'clip 1'])
    expect(entries[0].strength).toBe(0.8)
    expect(entries[1].strength).toBeNull()
  })
  it('shows other scalar tips and skips objects, arrays and empty values', () => {
    const entries = usageTipEntries({ sampler: 'euler a', nested: { a: 1 }, list: [1], empty: '', flag: true })
    expect(entries.map((entry) => entry.text)).toEqual(['sampler euler a', 'flag true'])
  })
  it('returns nothing for empty or invalid tips', () => {
    expect(usageTipEntries('{}')).toEqual([])
    expect(usageTipEntries('nope')).toEqual([])
    expect(usageTipEntries(undefined)).toEqual([])
  })
})

describe('nextTab', () => {
  it('moves with the arrow keys and wraps', () => {
    expect(nextTab('ArrowRight', 0, 3)).toBe(1)
    expect(nextTab('ArrowRight', 2, 3)).toBe(0)
    expect(nextTab('ArrowLeft', 0, 3)).toBe(2)
    expect(nextTab('ArrowLeft', 2, 3)).toBe(1)
  })
  it('jumps with Home and End', () => {
    expect(nextTab('Home', 2, 3)).toBe(0)
    expect(nextTab('End', 0, 3)).toBe(2)
  })
  it('ignores other keys and empty lists', () => {
    expect(nextTab('Enter', 1, 3)).toBeNull()
    expect(nextTab('ArrowRight', 0, 0)).toBeNull()
  })
})

describe('shouldConfirmClose', () => {
  it('asks only while there are unsaved notes', () => {
    expect(shouldConfirmClose(true)).toBe(true)
    expect(shouldConfirmClose(false)).toBe(false)
  })
})

describe('currentVersionId', () => {
  it('prefers the item version, then the metadata id', () => {
    expect(currentVersionId({ civitai: { id: 5 } }, { id: 9 })).toBe(5)
    expect(currentVersionId({ civitai: undefined }, { id: 9 })).toBe(9)
    expect(currentVersionId({}, null)).toBeNull()
  })
})
