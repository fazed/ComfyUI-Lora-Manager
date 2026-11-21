import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { setFetch } from '@/api/http'
import { GLOBAL_SCOPES, GLOBAL_TAG_SCOPE, apiSuggestSource, planFor } from '@/api/suggestSource'
import { folderPanelKey, initialFolderPanel, useFolderPanel } from '@/composables/useFolderPanel'
import { useLibraryFilters } from '@/composables/useLibraryFilters'
import { stashItem, takeStashedItem, useSuggestions } from '@/composables/useSearch'
import { LIBRARIES } from '@/config/libraries'
import {
  NAV_TABS,
  activeTab,
  globalSearchTarget,
  isNavActive,
  itemTarget,
  queryParam,
  seeAllTarget,
  tagTarget,
} from '@/config/navigation'
import {
  LruCache,
  buildSuggestOptions,
  createSuggester,
  matchRank,
  moveActive,
  rankItems,
  rankTags,
  sectionOptions,
  splitHighlight,
  type SuggestItem,
  type SuggestResult,
  type SuggestSource,
} from '@/utils/suggest'

const item = (key: string, name: string, secondary?: string): SuggestItem => ({ key, name, secondary, payload: { key } })

describe('splitHighlight', () => {
  it('marks every case-insensitive occurrence as text parts', () => {
    expect(splitHighlight('Anime anIMe', 'anim')).toEqual([
      { text: 'Anim', match: true },
      { text: 'e ', match: false },
      { text: 'anIM', match: true },
      { text: 'e', match: false },
    ])
  })

  it('returns plain text for no query, no match, and markup-like input', () => {
    expect(splitHighlight('Style', '')).toEqual([{ text: 'Style', match: false }])
    expect(splitHighlight('Style', 'xyz')).toEqual([{ text: 'Style', match: false }])
    expect(splitHighlight('<b>x</b>', 'b')).toEqual([
      { text: '<', match: false },
      { text: 'b', match: true },
      { text: '>x</', match: false },
      { text: 'b', match: true },
      { text: '>', match: false },
    ])
    expect(splitHighlight('', 'a')).toEqual([])
  })

  it('does not highlight when lower-casing changes the length', () => {
    expect(splitHighlight('İstanbul', 'stan')).toEqual([{ text: 'İstanbul', match: false }])
  })
})

describe('ranking', () => {
  it('ranks prefix > word start > substring > none', () => {
    expect(matchRank('Anime girl', 'anim')).toBe(0)
    expect(matchRank('90s anime', 'anim')).toBe(1)
    expect(matchRank('[PonyXL] x', 'pony')).toBe(1)
    expect(matchRank('Kanime', 'anim')).toBe(2)
    expect(matchRank('Style', 'anim')).toBe(3)
  })

  it('dedupes items and orders name matches before file-name matches', () => {
    const ranked = rankItems(
      [item('a', 'Other', 'anime_file'), item('b', 'Kanime'), item('c', 'Anime'), item('b', 'Kanime dup'), item('d', 'zzz')],
      'anime',
      10,
    )
    expect(ranked.map((entry) => entry.key)).toEqual(['c', 'b', 'a', 'd'])
    expect(rankItems([item('a', 'x'), item('b', 'y')], 'q', 1)).toHaveLength(1)
  })

  it('ranks tags exact first, then prefix, then by count; skips active ones', () => {
    const tags = [
      { tag: 'art style', count: 7 },
      { tag: 'styles', count: 6 },
      { tag: 'Style', count: 1 },
      { tag: 'style', count: 160 },
      { tag: 'doggystyle', count: 9 },
    ]
    expect(rankTags(tags, 'style', 10).map((entry) => entry.tag)).toEqual(['Style', 'styles', 'art style', 'doggystyle'])
    expect(rankTags(tags, 'style', 10, ['STYLE']).map((entry) => entry.tag)).toEqual(['styles', 'art style', 'doggystyle'])
  })
})

const RESULT: SuggestResult = {
  groups: [
    { scope: 'loras', items: [item('l1', 'Anime A'), item('l2', 'Anime B'), item('l3', 'x anime')], total: 12 },
    { scope: 'checkpoints', items: [], total: 0 },
    { scope: 'embeddings', items: [item('e1', 'anime emb')], total: 1 },
  ],
  tags: [{ tag: 'anime', count: 5 }],
  tagScope: 'loras',
  failed: false,
}

describe('buildSuggestOptions (grouped merge)', () => {
  it('keeps group order, drops empty groups, adds See all, tags and the search row last', () => {
    const options = buildSuggestOptions(RESULT, 'anime', { idPrefix: 'g', maxPerGroup: 2, maxTags: 5, seeAll: true })
    expect(options.map((option) => `${option.kind}:${option.group}`)).toEqual([
      'item:loras',
      'item:loras',
      'more:loras',
      'item:embeddings',
      'tag:tags',
      'search:search',
    ])
    expect(options[2]).toMatchObject({ kind: 'more', scope: 'loras', total: 12 })
    expect(options.map((option) => option.id)).toEqual(['g-opt-0', 'g-opt-1', 'g-opt-2', 'g-opt-3', 'g-opt-4', 'g-opt-5'])
    expect(options.at(-1)).toMatchObject({ kind: 'search', query: 'anime' })
    expect(sectionOptions(options).map((section) => [section.group, section.options.length])).toEqual([
      ['loras', 3],
      ['embeddings', 1],
      ['tags', 1],
      ['search', 1],
    ])
  })

  it('local mode has no See all rows; tags carry their scope', () => {
    const options = buildSuggestOptions(RESULT, 'anime', { idPrefix: 'l', maxPerGroup: 6, maxTags: 5 })
    expect(options.some((option) => option.kind === 'more')).toBe(false)
    expect(options.find((option) => option.kind === 'tag')).toMatchObject({ scope: 'loras' })
  })

  it('offers only the plain search without a result, nothing for blank text', () => {
    expect(buildSuggestOptions(null, ' anime ', { idPrefix: 'x', maxPerGroup: 4, maxTags: 5 })).toEqual([
      { kind: 'search', id: 'x-opt-0', group: 'search', query: 'anime' },
    ])
    expect(buildSuggestOptions(null, '  ', { idPrefix: 'x', maxPerGroup: 4, maxTags: 5 })).toEqual([])
  })

  it('moves the active option with wrap-around', () => {
    expect(moveActive(-1, 3, 1)).toBe(0)
    expect(moveActive(-1, 3, -1)).toBe(2)
    expect(moveActive(2, 3, 1)).toBe(0)
    expect(moveActive(0, 3, -1)).toBe(2)
    expect(moveActive(0, 0, 1)).toBe(-1)
  })
})

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1) // a is now most recent
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
  })
})

/** A source whose calls stay pending until resolved by hand. */
function manualSource() {
  const calls: { group: string; query: string; signal: AbortSignal; resolve: (value: { items: SuggestItem[]; total: number }) => void }[] = []
  const tagCalls: { scope: string; query: string }[] = []
  const source: SuggestSource = {
    plan: (scope) => (scope === 'all' ? { groups: ['loras', 'checkpoints'], tagScope: 'loras', limit: 6 } : { groups: [scope], tagScope: scope, limit: 8 }),
    items: (group, query, _limit, signal) =>
      new Promise((resolve) => {
        calls.push({ group, query, signal, resolve })
      }),
    tags: (scope, query) => {
      tagCalls.push({ scope, query })
      return Promise.resolve([{ tag: `${query}-tag`, count: 1 }])
    },
  }
  return { source, calls, tagCalls }
}

describe('createSuggester', () => {
  it('runs one request per group in parallel and merges them in plan order', async () => {
    const { source, calls, tagCalls } = manualSource()
    const suggester = createSuggester(source)
    const pending = suggester.suggest('all', ' Anim ')
    await Promise.resolve()
    expect(calls.map((call) => [call.group, call.query])).toEqual([
      ['loras', 'Anim'],
      ['checkpoints', 'Anim'],
    ])
    expect(tagCalls).toEqual([{ scope: 'loras', query: 'Anim' }])
    calls[1].resolve({ items: [item('c', 'Anim ckpt')], total: 1 })
    calls[0].resolve({ items: [item('l', 'Anim lora')], total: 9 })
    const result = await pending
    expect(result?.groups.map((group) => [group.scope, group.total])).toEqual([
      ['loras', 9],
      ['checkpoints', 1],
    ])
    expect(result?.tagScope).toBe('loras')
  })

  it('aborts the previous lookup and resolves it with null', async () => {
    const { source, calls } = manualSource()
    const suggester = createSuggester(source)
    const first = suggester.suggest('loras', 'an')
    await Promise.resolve()
    const second = suggester.suggest('loras', 'ani')
    await Promise.resolve()
    expect(calls[0].signal.aborted).toBe(true)
    expect(calls[1].signal.aborted).toBe(false)
    calls[0].resolve({ items: [], total: 0 })
    calls[1].resolve({ items: [item('x', 'anime')], total: 1 })
    expect(await first).toBeNull()
    expect((await second)?.groups[0].items[0].key).toBe('x')
  })

  it('caches per scope + normalised query, but not partial failures', async () => {
    let fail = true
    const items = vi.fn(async () => {
      if (fail) throw new Error('boom')
      return { items: [item('a', 'Anime')], total: 1 }
    })
    const source: SuggestSource = {
      plan: (scope) => ({ groups: [scope], tagScope: scope, limit: 8 }),
      items,
      tags: async () => [],
    }
    const suggester = createSuggester(source)
    const failed = await suggester.suggest('loras', 'anime')
    expect(failed).toMatchObject({ failed: false, groups: [{ scope: 'loras', items: [], total: 0 }] })
    expect(suggester.cache.size).toBe(0)
    fail = false
    await suggester.suggest('loras', 'Anime')
    await suggester.suggest('loras', ' anime ')
    expect(items).toHaveBeenCalledTimes(2)
    await suggester.suggest('checkpoints', 'anime')
    expect(items).toHaveBeenCalledTimes(3)
  })

  it('reports failed only when every request failed', async () => {
    const source: SuggestSource = {
      plan: () => ({ groups: ['loras'], tagScope: 'loras', limit: 8 }),
      items: async () => {
        throw new Error('down')
      },
      tags: async () => {
        throw new Error('down')
      },
    }
    expect(await createSuggester(source).suggest('loras', 'an')).toMatchObject({ failed: true, groups: [{ items: [] }], tags: [] })
  })
})

describe('useSuggestions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces, ignores short input and keeps only the latest answer', async () => {
    const items = vi.fn(async (_group: string, query: string) => ({ items: [item(query, query)], total: 1 }))
    const source: SuggestSource = { plan: (scope) => ({ groups: [scope], tagScope: null, limit: 8 }), items, tags: async () => [] }
    const suggestions = useSuggestions(() => 'embeddings', source)
    suggestions.request('a')
    expect(suggestions.loading.value).toBe(false)
    suggestions.request('ab')
    suggestions.request('abc')
    expect(suggestions.loading.value).toBe(true)
    await vi.advanceTimersByTimeAsync(149)
    expect(items).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10)
    expect(items).toHaveBeenCalledTimes(1)
    expect(suggestions.result.value?.groups[0].items[0].key).toBe('abc')
    expect(suggestions.loading.value).toBe(false)
    suggestions.reset()
    expect(suggestions.result.value).toBeNull()
  })
})

describe('search scopes and data sources', () => {
  afterEach(() => setFetch(null))

  it('plans global and local lookups', () => {
    expect(planFor('all')).toEqual({ groups: [...GLOBAL_SCOPES], tagScope: GLOBAL_TAG_SCOPE, limit: 6 })
    expect(GLOBAL_SCOPES).toEqual(['loras', 'checkpoints', 'embeddings', 'recipes'])
    expect(planFor('checkpoints')).toEqual({ groups: ['checkpoints'], tagScope: 'checkpoints', limit: 8 })
    expect(planFor('recipes')).toEqual({ groups: ['recipes'], tagScope: 'recipes', limit: 8 })
    expect(planFor('downloads')).toEqual({ groups: [], tagScope: null, limit: 0 })
  })

  it('uses the list and search-tags endpoints of the scope', async () => {
    const urls: string[] = []
    setFetch(async (input) => {
      urls.push(input)
      const body = input.includes('search-tags')
        ? { success: true, tags: [{ tag: 'anime', count: 3 }] }
        : {
            items: [{ file_path: 'G:/m/a.safetensors', file_name: 'a', model_name: 'Anime', base_model: 'Anima', preview_url: '/p' }],
            total: 7,
          }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const signal = new AbortController().signal
    const page = await apiSuggestSource.items('loras', 'anim', 6, signal)
    expect(page).toMatchObject({ total: 7, items: [{ key: 'G:/m/a.safetensors', name: 'Anime', badge: 'Anima', secondary: 'a' }] })
    await apiSuggestSource.items('recipes', 'anim', 6, signal)
    await apiSuggestSource.tags('embeddings', 'anim', 8, signal)
    await apiSuggestSource.tags('recipes', 'anim', 8, signal)
    expect(urls[0]).toContain('/api/lm/loras/list?')
    expect(urls[0]).toContain('search=anim')
    expect(urls[0]).toContain('page_size=6')
    expect(urls[1]).toContain('/api/lm/recipes?')
    expect(urls[2]).toContain('/api/lm/embeddings/search-tags?q=anim&limit=8')
    expect(urls[3]).toContain('/api/lm/recipes/search-tags?q=anim&limit=8')
  })

  it('builds route targets for hits, See all, tags and the results page', () => {
    expect(itemTarget('loras', 'G:/a.safetensors', 'A')).toEqual({ path: '/loras', query: { open: 'G:/a.safetensors' } })
    expect(itemTarget('recipes', 'r1', 'My recipe')).toEqual({ path: '/recipes', query: { q: 'My recipe' } })
    expect(seeAllTarget('checkpoints', ' anim ')).toEqual({ path: '/checkpoints', query: { q: 'anim' } })
    expect(tagTarget('loras', 'style')).toEqual({ path: '/loras', query: { tag: 'style' } })
    expect(tagTarget('recipes', 'style')).toEqual({ path: '/recipes', query: { q: 'style' } })
    expect(globalSearchTarget(' anim ')).toEqual({ path: '/search', query: { q: 'anim' } })
    expect(queryParam(['a', 'b'])).toBe('a')
    expect(queryParam(undefined)).toBe('')
  })

  it('hands a picked item to the page once, by key', () => {
    stashItem('k', { id: 1 })
    expect(takeStashedItem('other')).toBeNull()
    expect(takeStashedItem('k')).toEqual({ id: 1 })
    expect(takeStashedItem('k')).toBeNull()
  })
})

describe('navigation active state', () => {
  it('matches the tab path and its sub-paths only', () => {
    expect(isNavActive('/loras', '/loras')).toBe(true)
    expect(isNavActive('/loras', '/loras/')).toBe(true)
    expect(isNavActive('/loras', '/loras/x?y=1')).toBe(true)
    expect(isNavActive('/loras', '/lorasx')).toBe(false)
    expect(isNavActive('/loras', '/checkpoints')).toBe(false)
    expect(activeTab('/embeddings?open=x')?.to).toBe('/embeddings')
    expect(activeTab('/downloads')).toBeNull()
    expect(activeTab('/search')).toBeNull()
    expect(NAV_TABS.map((tab) => tab.to)).toEqual(['/loras', '/checkpoints', '/embeddings', '/recipes'])
  })
})

describe('local search in the library filters', () => {
  it('shows a Search chip, is part of the signature and cleared by clear()', async () => {
    const filters = useLibraryFilters(LIBRARIES.checkpoints)
    const before = filters.signature.value
    filters.state.search = 'anime'
    await nextTick()
    expect(filters.chips.value[0]).toMatchObject({ key: 'search', label: 'Search: anime' })
    expect(filters.signature.value).not.toBe(before)
    expect(filters.panelCount.value).toBe(0)
    filters.chips.value[0].remove()
    expect(filters.state.search).toBe('')
    filters.state.search = 'x'
    filters.clear()
    expect(filters.state.search).toBe('')
  })
})

describe('folder panel toggle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('is hidden by default and remembered per library on wide screens', () => {
    expect(initialFolderPanel('loras', 1400)).toBe(false)
    const panel = useFolderPanel('loras', () => 1400)
    expect(panel.open.value).toBe(false)
    panel.toggle()
    expect(panel.open.value).toBe(true)
    expect(window.localStorage.getItem(folderPanelKey('loras'))).toBe('true')
    expect(useFolderPanel('loras', () => 1400).open.value).toBe(true)
    expect(useFolderPanel('checkpoints', () => 1400).open.value).toBe(false)
  })

  it('always starts closed and does not persist in overlay mode', () => {
    window.localStorage.setItem(folderPanelKey('loras'), 'true')
    const panel = useFolderPanel('loras', () => 800)
    expect(panel.open.value).toBe(false)
    expect(panel.isOverlay()).toBe(true)
    panel.set(true)
    panel.set(false)
    expect(window.localStorage.getItem(folderPanelKey('loras'))).toBe('true')
  })

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const panel = useFolderPanel('embeddings', () => 1400)
    expect(panel.open.value).toBe(false)
    expect(() => panel.toggle()).not.toThrow()
    expect(panel.open.value).toBe(true)
  })
})
