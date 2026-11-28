/**
 * Drawer navigation (prev/next between models) and the persisted last tab.
 * Pure helpers, written before the UI: neighbour/position computation, the keyboard
 * shortcut guard, tab validation/fallback, the stale-response guard and the grid
 * scroll-into-view maths.
 */
import { describe, expect, it } from 'vitest'
import {
  availableTabs,
  computeNav,
  createRequestGuard,
  DRAWER_TABS,
  parseStoredTab,
  positionLabel,
  resolveTab,
  scrollTopToReveal,
  shouldHandleDeleteKey,
  shouldHandleNavKey,
  type NavKeyContext,
  type NavKeyEvent,
} from '@/utils/drawerNav'

describe('computeNav', () => {
  const keys = ['a', 'b', 'c', 'd']

  it('finds neighbours in the middle', () => {
    const nav = computeNav(keys, 'b', { total: 4, hasMore: false })!
    expect(nav).toMatchObject({ index: 1, ordinal: 2, loadedCount: 4, total: 4, hasPrev: true, hasNext: true, needsMore: false })
  })

  it('disables Previous at the start and Next at the end (no wrapping)', () => {
    expect(computeNav(keys, 'a', { total: 4, hasMore: false })).toMatchObject({ hasPrev: false, hasNext: true })
    expect(computeNav(keys, 'd', { total: 4, hasMore: false })).toMatchObject({ hasPrev: true, hasNext: false })
  })

  it('keeps Next enabled at the last loaded item while more pages exist', () => {
    const nav = computeNav(keys, 'd', { total: 120, hasMore: true })!
    expect(nav).toMatchObject({ ordinal: 4, total: 120, hasNext: true, needsMore: true })
  })

  it('reports an unknown total as null so only the ordinal shows', () => {
    expect(computeNav(keys, 'c', {})!.total).toBeNull()
    expect(computeNav(keys, 'c', { total: null })!.total).toBeNull()
    // A total smaller than what is loaded is stale: ignore it.
    expect(computeNav(keys, 'c', { total: 2 })!.total).toBeNull()
    expect(computeNav(keys, 'c', { total: 0 })!.total).toBeNull()
  })

  it('returns null when the open model is not in the displayed list', () => {
    expect(computeNav(keys, 'zzz', { total: 4 })).toBeNull()
    expect(computeNav(keys, null, { total: 4 })).toBeNull()
    expect(computeNav([], 'a', {})).toBeNull()
  })

  it('handles a single item', () => {
    expect(computeNav(['a'], 'a', { total: 1 })).toMatchObject({ hasPrev: false, hasNext: false, ordinal: 1 })
  })
})

describe('positionLabel', () => {
  it('shows "n of total" when the total is known, else the ordinal', () => {
    const withTotal = (position: string, total: string) => `${position} of ${total}`
    expect(positionLabel(3, 120, withTotal, String)).toBe('3 of 120')
    expect(positionLabel(3, null, withTotal, String)).toBe('3')
  })
})

function key(init: Partial<NavKeyEvent> & { key: string }): NavKeyEvent {
  return { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: { tagName: 'DIV' }, ...init }
}
const open: NavKeyContext = { topmost: true, dialogOpen: false, menuOpen: false }

describe('shouldHandleDeleteKey', () => {
  it('takes a plain Delete outside text fields only', () => {
    expect(shouldHandleDeleteKey(key({ key: 'Delete' }), open)).toBe(true)
    expect(shouldHandleDeleteKey(key({ key: 'Delete', target: { tagName: 'TEXTAREA' } }), open)).toBe(false)
    expect(shouldHandleDeleteKey(key({ key: 'Delete', shiftKey: true }), open)).toBe(false)
    expect(shouldHandleDeleteKey(key({ key: 'Backspace' }), open)).toBe(false)
  })

  it('stays quiet under a menu, a dialog or another layer', () => {
    expect(shouldHandleDeleteKey(key({ key: 'Delete' }), { ...open, menuOpen: true })).toBe(false)
    expect(shouldHandleDeleteKey(key({ key: 'Delete' }), { ...open, dialogOpen: true })).toBe(false)
    expect(shouldHandleDeleteKey(key({ key: 'Delete' }), { ...open, topmost: false })).toBe(false)
  })
})

describe('shouldHandleNavKey', () => {
  it('maps plain and Alt arrows and plain j/k', () => {
    expect(shouldHandleNavKey(key({ key: 'ArrowLeft' }), open)).toBe('prev')
    expect(shouldHandleNavKey(key({ key: 'ArrowRight' }), open)).toBe('next')
    expect(shouldHandleNavKey(key({ key: 'ArrowLeft', altKey: true }), open)).toBe('prev')
    expect(shouldHandleNavKey(key({ key: 'ArrowRight', altKey: true }), open)).toBe('next')
    expect(shouldHandleNavKey(key({ key: 'k' }), open)).toBe('prev')
    expect(shouldHandleNavKey(key({ key: 'j' }), open)).toBe('next')
  })

  it('ignores unrelated keys and an arrow the tab list already handled', () => {
    expect(shouldHandleNavKey(key({ key: 'a' }), open)).toBeNull()
    expect(shouldHandleNavKey(key({ key: 'ArrowRight', defaultPrevented: true }), open)).toBeNull()
  })

  it('requires exactly the right modifiers', () => {
    expect(shouldHandleNavKey(key({ key: 'j', ctrlKey: true }), open)).toBeNull()
    expect(shouldHandleNavKey(key({ key: 'j', metaKey: true }), open)).toBeNull()
    expect(shouldHandleNavKey(key({ key: 'j', altKey: true }), open)).toBeNull()
    expect(shouldHandleNavKey(key({ key: 'J', shiftKey: true }), open)).toBeNull()
    expect(shouldHandleNavKey(key({ key: 'ArrowRight', altKey: true, ctrlKey: true }), open)).toBeNull()
    expect(shouldHandleNavKey(key({ key: 'ArrowRight', altKey: true, shiftKey: true }), open)).toBeNull()
  })

  it('does nothing while typing in a field', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(shouldHandleNavKey(key({ key: 'j', target: { tagName } }), open)).toBeNull()
      expect(shouldHandleNavKey(key({ key: 'ArrowRight', altKey: true, target: { tagName } }), open)).toBeNull()
      expect(shouldHandleNavKey(key({ key: 'ArrowRight', target: { tagName } }), open)).toBeNull()
    }
    expect(shouldHandleNavKey(key({ key: 'j', target: { tagName: 'DIV', isContentEditable: true } }), open)).toBeNull()
  })

  it('works from a button (the nav buttons keep focus)', () => {
    expect(shouldHandleNavKey(key({ key: 'j', target: { tagName: 'BUTTON' } }), open)).toBe('next')
  })

  it('does nothing unless the drawer is the topmost layer with no dialog or menu open', () => {
    expect(shouldHandleNavKey(key({ key: 'j' }), { ...open, topmost: false })).toBeNull()
    expect(shouldHandleNavKey(key({ key: 'j' }), { ...open, dialogOpen: true })).toBeNull()
    expect(shouldHandleNavKey(key({ key: 'j' }), { ...open, menuOpen: true })).toBeNull()
  })

  it('ignores composing and already handled events', () => {
    expect(shouldHandleNavKey(key({ key: 'j', isComposing: true }), open)).toBeNull()
    expect(shouldHandleNavKey(key({ key: 'j', defaultPrevented: true }), open)).toBeNull()
  })

  it('accepts an uppercase key from Caps Lock when Shift is not held', () => {
    expect(shouldHandleNavKey(key({ key: 'J' }), open)).toBe('next')
  })
})

describe('tab persistence', () => {
  it('knows the four tabs of the flyout', () => {
    expect([...DRAWER_TABS]).toEqual(['examples', 'description', 'versions', 'recipes'])
  })

  it('validates the stored value and falls back to Examples', () => {
    expect(parseStoredTab('description')).toBe('description')
    expect(parseStoredTab('versions')).toBe('versions')
    expect(parseStoredTab('recipes')).toBe('recipes')
    expect(parseStoredTab('examples')).toBe('examples')
    expect(parseStoredTab('')).toBe('examples')
    expect(parseStoredTab(null)).toBe('examples')
    expect(parseStoredTab(undefined)).toBe('examples')
    expect(parseStoredTab(3)).toBe('examples')
    expect(parseStoredTab('"versions"')).toBe('examples')
  })

  it('maps a stored Overview (the former first tab) to Examples', () => {
    expect(parseStoredTab('overview')).toBe('examples')
  })

  it('offers Versions only with a Civitai model id and Recipes only for LoRAs', () => {
    expect(availableTabs({ civitai: { modelId: 5 } }, true)).toEqual(['examples', 'description', 'versions', 'recipes'])
    expect(availableTabs({ civitai: { modelId: 5 } })).toEqual(['examples', 'description', 'versions'])
    expect(availableTabs({ civitai: null }, true)).toEqual(['examples', 'description', 'recipes'])
    expect(availableTabs({})).toEqual(['examples', 'description'])
  })

  it('uses the preference when available, else Examples, without touching the preference', () => {
    expect(resolveTab('versions', ['examples', 'description', 'versions'])).toBe('versions')
    expect(resolveTab('versions', ['examples', 'description'])).toBe('examples')
    expect(resolveTab('recipes', ['examples', 'description', 'versions'])).toBe('examples')
    expect(resolveTab('description', ['examples', 'description'])).toBe('description')
  })
})

describe('createRequestGuard', () => {
  it('only the latest request is current and earlier ones are aborted', () => {
    const guard = createRequestGuard()
    const first = guard.begin()
    expect(first.isCurrent()).toBe(true)
    const second = guard.begin()
    expect(first.isCurrent()).toBe(false)
    expect(first.signal.aborted).toBe(true)
    expect(second.isCurrent()).toBe(true)
    expect(second.signal.aborted).toBe(false)
  })

  it('cancel invalidates the pending request', () => {
    const guard = createRequestGuard()
    const req = guard.begin()
    guard.cancel()
    expect(req.isCurrent()).toBe(false)
    expect(req.signal.aborted).toBe(true)
  })

  it('drops a stale response that resolves after a newer one', async () => {
    const guard = createRequestGuard()
    const applied: string[] = []
    const run = async (name: string, delay: number) => {
      const req = guard.begin()
      await new Promise((resolve) => setTimeout(resolve, delay))
      if (req.isCurrent()) applied.push(name)
    }
    await Promise.all([run('slow', 20), run('fast', 1)])
    expect(applied).toEqual(['fast'])
  })
})

describe('scrollTopToReveal', () => {
  // rows are 100px tall, viewport 300px
  it('keeps the position when the row is fully visible', () => {
    expect(scrollTopToReveal(100, 100, 0, 300)).toBe(0)
    expect(scrollTopToReveal(300, 100, 200, 300)).toBe(200)
  })
  it('scrolls up to a row above the viewport', () => {
    expect(scrollTopToReveal(100, 100, 400, 300)).toBe(100)
  })
  it('scrolls down to a row below the viewport', () => {
    expect(scrollTopToReveal(500, 100, 0, 300)).toBe(300)
  })
  it('never returns a negative offset', () => {
    expect(scrollTopToReveal(0, 100, 50, 300)).toBe(0)
  })
  it('reveals the top of a row taller than the viewport', () => {
    expect(scrollTopToReveal(500, 400, 0, 300)).toBe(500)
  })
})
