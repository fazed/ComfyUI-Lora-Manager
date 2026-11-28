/**
 * Phase 6e command palette: pure ranking of the local groups (utils/palette.ts)
 * and the dialog (GlobalSearchDialog in the rail): grouped results from the
 * search API and the local sources, keyboard navigation with
 * aria-activedescendant, running entries and focus return.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppRail from '@/components/AppRail.vue'
import { setFetch } from '@/api/http'
import { routes } from '@/router'
import { folderEntries, paletteScore, rankPalette, type PaletteEntry } from '@/utils/palette'

const entry = (id: string, group: PaletteEntry['group'], label: string, keywords = ''): PaletteEntry => ({ id, group, label, keywords, icon: 'search' })

describe('rankPalette', () => {
  const entries = [
    entry('s1', 'settings', 'Backups', 'backup restore export'),
    entry('p1', 'pages', 'LoRAs'),
    entry('p2', 'pages', 'Settings'),
    entry('a1', 'actions', 'Refresh this page'),
    entry('f1', 'folders', 'anime'),
    entry('s2', 'settings', 'Library folders', 'roots extra paths'),
  ]

  it('lists only pages and actions, in their own order, before anything is typed', () => {
    expect(rankPalette(entries, '  ').map((section) => [section.group, section.entries.map((e) => e.id)])).toEqual([
      ['pages', ['p1', 'p2']],
      ['actions', ['a1']],
    ])
  })

  it('groups matches as folders, pages, actions, settings and ranks label matches before keyword matches', () => {
    expect(rankPalette(entries, 'set').map((section) => section.group)).toEqual(['pages'])
    const sections = rankPalette([...entries, entry('s3', 'settings', 'Proxy', 'settings network')], 'settings')
    expect(sections.map((section) => [section.group, section.entries.map((e) => e.id)])).toEqual([
      ['pages', ['p2']],
      ['settings', ['s3']],
    ])
    expect(rankPalette(entries, 'restore')[0].entries.map((e) => e.id)).toEqual(['s1'])
    expect(rankPalette(entries, 'xyz')).toEqual([])
  })

  it('scores prefix, word and substring matches on the label, then the hint and keywords', () => {
    const item = { ...entry('x', 'pages', 'Example images'), hint: 'Settings › Downloads' }
    expect(paletteScore(item, 'exa')).toBe(0)
    expect(paletteScore(item, 'ima')).toBe(1)
    expect(paletteScore(item, 'mag')).toBe(2)
    expect(paletteScore(item, 'downl')).toBe(3)
    expect(paletteScore(item, 'zzz')).toBeNull()
  })

  it('caps every group', () => {
    const many = Array.from({ length: 9 }, (_, n) => entry(`f${n}`, 'folders', `style ${n}`))
    expect(rankPalette(many, 'style', 4)[0].entries).toHaveLength(4)
  })

  it('flattens a folder tree into entries that carry the library and path', () => {
    expect(folderEntries('loras', 'LoRAs', 'layers', { style: { anime: {} } }).map((e) => [e.id, e.label, e.hint])).toEqual([
      ['folder:loras:style', 'style', 'LoRAs › style'],
      ['folder:loras:style/anime', 'anime', 'LoRAs › style/anime'],
    ])
  })
})

describe('command palette dialog', () => {
  let wrapper: VueWrapper | null = null
  const body = () => new DOMWrapper(document.body)
  const input = () => document.getElementById('global-search') as HTMLInputElement
  const groups = () => [...document.querySelectorAll('[data-slot="command-group"]')].map((group) => group.getAttribute('data-group'))
  const active = () => document.getElementById(input().getAttribute('aria-activedescendant') ?? '')

  beforeEach(() => {
    setFetch(async (request) => {
      const url = String(request)
      const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
      if (url.includes('/loras/unified-folder-tree')) return json({ tree: { style: { anime: {} } } })
      if (url.includes('unified-folder-tree')) return json({ tree: {} })
      if (/\/loras\/list/.test(url) && url.includes('search=anim')) {
        return json({ items: [{ model_name: 'Anime Lines', file_name: 'anime-lines', file_path: 'D:/loras/anime-lines.safetensors', folder: '', preview_url: '' }], total: 1 })
      }
      if (url.includes('/list') || url.includes('/recipes')) return json({ items: [], total: 0 })
      if (url.includes('search-tags')) return json({ tags: [] })
      return json({ success: true, queue: [], groups: [], totals: {} })
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    setFetch(null)
    document.body.innerHTML = ''
  })

  async function openPalette(path = '/loras') {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(path)
    wrapper = mount(AppRail, { global: { plugins: [router] }, attachTo: document.body })
    await flushPromises()
    const opener = wrapper.get('button[aria-label="Search all libraries"]').element as HTMLButtonElement
    opener.focus()
    opener.click()
    await flushPromises()
    return { router, opener }
  }

  async function type(text: string): Promise<void> {
    await new DOMWrapper(input()).setValue(text)
    await flushPromises()
  }

  async function press(key: string): Promise<void> {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await flushPromises()
  }

  it('is a labelled combobox that controls the result listbox; idle it lists pages and actions', async () => {
    await openPalette()
    expect(document.activeElement).toBe(input())
    expect(input().getAttribute('role')).toBe('combobox')
    const list = document.getElementById(input().getAttribute('aria-controls')!)!
    expect(list.getAttribute('role')).toBe('listbox')
    expect(groups()).toEqual(['pages', 'actions'])
    expect(body().get('[data-group="actions"]').text()).toContain('Help')
  })

  it('groups models from the search API, folders, pages and settings while typing', async () => {
    await openPalette()
    await type('anim')
    await new Promise((resolve) => setTimeout(resolve, 200))
    await flushPromises()
    expect(groups()).toEqual(['loras', 'folders'])
    expect(body().get('[data-group="loras"]').text()).toContain('Anime Lines')
    expect(body().get('[data-group="folders"]').text()).toContain('LoRAs › style/anime')
    expect(body().get('[data-group="search"]').text()).toContain('Search everywhere for “anim”')

    await type('backup')
    await new Promise((resolve) => setTimeout(resolve, 200))
    await flushPromises()
    expect(groups()).toEqual(['settings'])
  })

  it('moves the highlight with the arrow keys and runs the highlighted entry on Enter', async () => {
    const { router } = await openPalette()
    await type('sett')
    const first = active()
    expect(first?.textContent).toContain('Settings')
    await press('ArrowDown')
    expect(active()).not.toBe(first)
    await press('ArrowUp')
    expect(active()).toBe(first)
    await press('Enter')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/settings'))
    expect(body().find('#global-search').exists()).toBe(false)
  })

  it('opens a folder of a library and searches everywhere from the last row', async () => {
    const { router } = await openPalette()
    await type('anime')
    body().get('[data-group="folders"] [role="option"]').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ folder: 'style/anime' })

    wrapper!.get('button[aria-label="Search all libraries"]').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    await type('zzz')
    await press('End')
    expect(active()?.getAttribute('data-group')).toBe('search')
    await press('Enter')
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/search?q=zzz'))
  })

  it('runs app actions (Help opens its dialog) and returns focus to the opener on Escape', async () => {
    const { opener } = await openPalette()
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(body().find('#global-search').exists()).toBe(false)
    expect(document.activeElement).toBe(opener)

    opener.click()
    await flushPromises()
    await type('help')
    await press('Enter')
    await flushPromises()
    expect(body().get('[role="dialog"]').text()).toContain('Shortcuts')
  })
})
