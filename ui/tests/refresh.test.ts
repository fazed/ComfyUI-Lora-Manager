/**
 * In-app refresh: the page-level registry (composables/useRefresh.ts), the `r`
 * shortcut and the visibility auto-refresh of the host, the in-place list
 * refresh (useInfiniteList.refresh + utils/refreshList.ts) and the library page
 * end to end against a mocked backend (filters, selection and the open drawer
 * survive, only GET requests are sent).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import {
  AUTO_REFRESH_AFTER_MS,
  runRefresh,
  useRefresh,
  useRefreshHandler,
  useRefreshHost,
  type RefreshHandler,
} from '@/composables/useRefresh'
import { useToasts } from '@/composables/useFeedback'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { refreshInPlace, type AnchorGrid } from '@/utils/refreshList'
import { runLibraryScan, scanNotice, type ScanOutcome } from '@/utils/libraryScan'
import { ApiError } from '@/api/http'
import { anchorAt } from '@/utils/gridLayout'
import RefreshButton from '@/components/RefreshButton.vue'
import PageShell from '@/components/PageShell.vue'
import LibraryToolbar from '@/components/LibraryToolbar.vue'
import { setFetch } from '@/api/http'
import { clearBrowseView, saveBrowseView } from '@/utils/browse'
import type { PagedResponse } from '@/api/types'

function page<T>(items: T[], pageNo: number, totalPages: number, total = 99): PagedResponse<T> {
  return { items, page: pageNo, total_pages: totalPages, total, page_size: items.length }
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A page component that registers one refresh handler while mounted. */
const Page = defineComponent({
  props: { handler: { type: Object as PropType<RefreshHandler>, required: true } },
  setup(props) {
    useRefreshHandler(props.handler)
    return () => h('div', { class: 'page' })
  },
})

/** Exposes the shell view of the registry. */
function probe() {
  let api!: ReturnType<typeof useRefresh>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useRefresh()
        return () => h('span')
      },
    }),
  )
  return { api, wrapper }
}

describe('refresh registry', () => {
  it('registers the mounted page and unregisters it on unmount', async () => {
    const { api, wrapper: shell } = probe()
    expect(api.available.value).toBe(false)
    const run = vi.fn(async () => undefined)
    const page = mount(Page, { props: { handler: { run } } })
    expect(api.available.value).toBe(true)
    expect(api.showButton.value).toBe(true)
    await api.run()
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ silent: false }))
    page.unmount()
    expect(api.available.value).toBe(false)
    expect(await runRefresh()).toBe(false)
    shell.unmount()
  })

  it('keeps the newest page when an older one unmounts later', () => {
    const { api, wrapper: shell } = probe()
    const first = mount(Page, { props: { handler: { run: vi.fn(async () => undefined) } } })
    const second = mount(Page, { props: { handler: { run: vi.fn(async () => undefined), button: false } } })
    first.unmount()
    expect(api.available.value).toBe(true)
    expect(api.showButton.value).toBe(false)
    second.unmount()
    expect(api.available.value).toBe(false)
    shell.unmount()
  })

  it('follows route changes (the handler of the routed page is current)', async () => {
    const runA = vi.fn(async () => undefined)
    const runB = vi.fn(async () => undefined)
    const A = defineComponent({ setup: () => (useRefreshHandler({ run: runA }), () => h('p', 'a')) })
    const B = defineComponent({ setup: () => (useRefreshHandler({ run: runB }), () => h('p', 'b')) })
    const C = defineComponent({ setup: () => () => h('p', 'c') })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/a', component: A },
        { path: '/b', component: B },
        { path: '/c', component: C },
      ],
    })
    await router.push('/a')
    const app = mount(RouterView, { global: { plugins: [router] } })
    await flushPromises()
    await runRefresh()
    expect(runA).toHaveBeenCalledTimes(1)
    await router.push('/b')
    await flushPromises()
    await runRefresh()
    expect(runB).toHaveBeenCalledTimes(1)
    expect(runA).toHaveBeenCalledTimes(1)
    await router.push('/c')
    await flushPromises()
    expect(await runRefresh()).toBe(false)
    app.unmount()
  })

  it('never runs twice at once and exposes the busy state', async () => {
    const { api, wrapper: shell } = probe()
    const gate = deferred()
    const run = vi.fn(() => gate.promise)
    const page = mount(Page, { props: { handler: { run } } })
    const first = api.run()
    expect(api.busy.value).toBe(true)
    expect(await api.run()).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
    gate.resolve()
    expect(await first).toBe(true)
    expect(api.busy.value).toBe(false)
    page.unmount()
    shell.unmount()
  })

  it('reports a failed refresh as an error toast (silent runs stay quiet)', async () => {
    const toasts = useToasts()
    toasts.toasts.value = []
    const run = vi.fn(async () => {
      throw new Error('Network error: the LoRA Manager backend is not reachable')
    })
    const page = mount(Page, { props: { handler: { run } } })
    expect(await runRefresh()).toBe(false)
    expect(toasts.toasts.value.map((toast) => toast.kind)).toEqual(['error'])
    expect(toasts.toasts.value[0].message).toContain('not reachable')
    await runRefresh({ silent: true })
    expect(toasts.toasts.value).toHaveLength(1)
    page.unmount()
    toasts.toasts.value = []
  })
})

describe('refresh host: r shortcut and tab visibility', () => {
  const Host = defineComponent({ setup: () => (useRefreshHost(), () => h('div')) })
  let visibility: DocumentVisibilityState = 'visible'

  beforeEach(() => {
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }

  it('refreshes on a bare r, not with modifiers, in fields, dialogs or menus', async () => {
    const run = vi.fn(async () => undefined)
    const host = mount(Host, { attachTo: document.body })
    const page = mount(Page, { props: { handler: { run } }, attachTo: document.body })

    const event = press('r')
    await flushPromises()
    expect(run).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)

    press('r', { ctrlKey: true })
    press('R', { shiftKey: true })
    press('r', { altKey: true })
    const input = document.createElement('input')
    document.body.appendChild(input)
    press('r', {}, input)
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    const inside = document.createElement('button')
    dialog.appendChild(inside)
    document.body.appendChild(dialog)
    press('r', {}, inside)
    press('r')
    dialog.remove()
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)
    press('r')
    menu.remove()
    await flushPromises()
    expect(run).toHaveBeenCalledTimes(1)

    page.unmount()
    host.unmount()
  })

  it('does not clash with the f / s / j / k shortcuts', async () => {
    const run = vi.fn(async () => undefined)
    const host = mount(Host, { attachTo: document.body })
    const page = mount(Page, { props: { handler: { run } }, attachTo: document.body })
    for (const key of ['f', 's', 'j', 'k', '/']) press(key)
    await flushPromises()
    expect(run).not.toHaveBeenCalled()
    page.unmount()
    host.unmount()
  })

  it('refreshes silently after the tab was hidden for a while, only for opted-in pages', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-25T10:00:00Z'))
    const run = vi.fn(async () => undefined)
    const host = mount(Host)
    const page = mount(Page, { props: { handler: { run, onVisible: true } } })

    const flip = async (state: DocumentVisibilityState) => {
      visibility = state
      document.dispatchEvent(new Event('visibilitychange'))
      await nextTick()
      await Promise.resolve()
    }

    // A short absence does nothing.
    await flip('hidden')
    vi.advanceTimersByTime(AUTO_REFRESH_AFTER_MS - 1000)
    await flip('visible')
    expect(run).not.toHaveBeenCalled()

    // A long one refreshes once, silently.
    await flip('hidden')
    vi.advanceTimersByTime(AUTO_REFRESH_AFTER_MS + 1000)
    await flip('visible')
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ silent: true }))
    page.unmount()

    // A page that did not opt in is left alone.
    const quiet = vi.fn(async () => undefined)
    const other = mount(Page, { props: { handler: { run: quiet } } })
    await flip('hidden')
    vi.advanceTimersByTime(AUTO_REFRESH_AFTER_MS * 3)
    await flip('visible')
    expect(quiet).not.toHaveBeenCalled()
    other.unmount()
    host.unmount()
  })
})

describe('useInfiniteList.refresh', () => {
  it('re-fetches the loaded range and swaps the items without clearing them first', async () => {
    let version = 'v1'
    const fetcher = vi.fn(async (p: number) => page([`${version}-${p}a`, `${version}-${p}b`], p, 5, 10))
    const list = useInfiniteList<string>(fetcher)
    await list.reset()
    await list.loadMore()
    await list.loadMore()
    expect(list.items.value).toHaveLength(6)
    fetcher.mockClear()

    version = 'v2'
    const pending = list.refresh()
    // While refreshing the old items stay visible.
    expect(list.items.value).toHaveLength(6)
    expect(list.refreshing.value).toBe(true)
    await pending
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([1, 2, 3])
    expect(list.items.value).toEqual(['v2-1a', 'v2-1b', 'v2-2a', 'v2-2b', 'v2-3a', 'v2-3b'])
    expect(list.page.value).toBe(3)
    expect(list.hasMore.value).toBe(true)
    expect(list.refreshing.value).toBe(false)
  })

  it('caps the number of pages and stops at the last page', async () => {
    const fetcher = vi.fn(async (p: number) => page([`i${p}`], p, 4, 4))
    const list = useInfiniteList<string>(fetcher)
    await list.reset()
    for (let n = 0; n < 3; n++) await list.loadMore()
    expect(list.page.value).toBe(4)
    fetcher.mockClear()
    await list.refresh({ maxPages: 2 })
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([1, 2])
    expect(list.items.value).toEqual(['i1', 'i2'])
    expect(list.page.value).toBe(2)

    // The library shrank to one page: the refresh stops there.
    fetcher.mockImplementation(async (p: number) => page([`j${p}`], p, 1, 1))
    await list.refresh({ maxPages: 10 })
    expect(fetcher.mock.calls.slice(2).map((call) => call[0])).toEqual([1])
    expect(list.items.value).toEqual(['j1'])
    expect(list.hasMore.value).toBe(false)
  })

  it('drops duplicates when items shift between pages during the refresh', async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => page(['a', 'b'], 1, 2, 4))
      .mockImplementationOnce(async () => page(['c', 'd'], 2, 2, 4))
      .mockImplementationOnce(async () => page(['new', 'a'], 1, 3, 5))
      .mockImplementationOnce(async () => page(['b', 'c'], 2, 3, 5))
    const list = useInfiniteList<string>(fetcher)
    await list.reset()
    await list.loadMore()
    await list.refresh({ key: (value) => value })
    expect(list.items.value).toEqual(['new', 'a', 'b', 'c'])
    expect(list.total.value).toBe(5)
  })

  it('keeps the items and rejects when the refresh fails', async () => {
    const fetcher = vi.fn(async (p: number) => page([`x${p}`], p, 1, 1))
    const list = useInfiniteList<string>(fetcher)
    await list.reset()
    fetcher.mockImplementationOnce(async () => {
      throw new Error('offline')
    })
    await expect(list.refresh()).rejects.toThrow('offline')
    expect(list.items.value).toEqual(['x1'])
    expect(list.error.value).toBeNull()
    expect(list.refreshing.value).toBe(false)
  })

  it('is superseded by a reset (filter change) and defers a load-more request', async () => {
    const gate = deferred<PagedResponse<string>>()
    const fetcher = vi.fn(async (p: number) => page([`p${p}`], p, 3, 3))
    const list = useInfiniteList<string>(fetcher)
    await list.reset()

    // loadMore while refreshing runs after the refresh.
    fetcher.mockImplementationOnce(() => gate.promise)
    const refreshing = list.refresh()
    await list.loadMore()
    expect(fetcher).toHaveBeenCalledTimes(2)
    gate.resolve(page(['fresh1'], 1, 3, 3))
    await refreshing
    await flushPromises()
    expect(list.items.value).toEqual(['fresh1', 'p2'])

    // A reset during a refresh wins; the refresh result is dropped.
    const slow = deferred<PagedResponse<string>>()
    fetcher.mockImplementationOnce(() => slow.promise)
    const stale = list.refresh()
    await list.reset()
    slow.resolve(page(['stale'], 1, 1, 1))
    await stale
    expect(list.items.value).toEqual(['p1'])
    expect(list.refreshing.value).toBe(false)
  })

  it('loads the first page when nothing was loaded yet', async () => {
    const fetcher = vi.fn(async (p: number) => page([`a${p}`], p, 1, 1))
    const list = useInfiniteList<string>(fetcher)
    await list.refresh()
    expect(list.items.value).toEqual(['a1'])
  })
})

describe('refreshInPlace keeps the scroll anchor', () => {
  function fakeGrid(index: number, offset: number): AnchorGrid & { moved: [number, number][] } {
    const moved: [number, number][] = []
    return { anchor: () => ({ index, offset }), scrollToAnchor: (i, o) => void moved.push([i, o]), moved }
  }

  it('moves to the anchor item when items were added above it', async () => {
    let data = ['a', 'b', 'c', 'd']
    const list = useInfiniteList<string>(async (p) => page(data, p, 1, data.length))
    await list.reset()
    const grid = fakeGrid(2, 17)
    data = ['new1', 'new2', 'a', 'b', 'c', 'd']
    await refreshInPlace(list, grid, (value) => value, 10)
    expect(grid.moved).toEqual([[4, 17]])
  })

  it('leaves the scroll position alone when nothing moved or the anchor is gone', async () => {
    let data = ['a', 'b', 'c']
    const list = useInfiniteList<string>(async (p) => page(data, p, 1, data.length))
    await list.reset()
    const still = fakeGrid(1, 5)
    await refreshInPlace(list, still, (value) => value, 10)
    expect(still.moved).toEqual([])
    data = ['x', 'y']
    const gone = fakeGrid(1, 5)
    await refreshInPlace(list, gone, (value) => value, 10)
    expect(gone.moved).toEqual([])
    expect(list.items.value).toEqual(['x', 'y'])
  })
})

describe('anchorAt', () => {
  const metrics = { columns: 4, gap: 10, itemWidth: 200, itemHeight: 290 }
  it('names the first item of the top row and the pixels scrolled into it', () => {
    expect(anchorAt(0, metrics)).toEqual({ index: 0, offset: 0 })
    expect(anchorAt(650, metrics)).toEqual({ index: 8, offset: 50 })
    expect(anchorAt(70, { ...metrics, columns: 1, itemHeight: 56, gap: 6 })).toEqual({ index: 1, offset: 8 })
  })
})

describe('RefreshButton and the page header', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders only while the page has a refresh handler that wants a button', () => {
    const button = mount(RefreshButton)
    expect(button.find('button').exists()).toBe(false)
    const page = mount(Page, { props: { handler: { run: vi.fn(async () => undefined) } } })
    const shown = mount(RefreshButton)
    const element = shown.get('button')
    expect(element.attributes('aria-label')).toBe('Refresh')
    expect(element.attributes('aria-keyshortcuts')).toBe('R')
    expect(element.attributes('title')).toBe('Refresh (R)')
    page.unmount()
    const hidden = mount(Page, { props: { handler: { run: vi.fn(async () => undefined), button: false } } })
    expect(mount(RefreshButton).find('button').exists()).toBe(false)
    hidden.unmount()
    button.unmount()
    shown.unmount()
  })

  it('is aria-busy while refreshing, ignores clicks meanwhile and keeps focus (no disabled)', async () => {
    const gate = deferred()
    const run = vi.fn(() => gate.promise)
    const page = mount(Page, { props: { handler: { run } } })
    const wrapper = mount(RefreshButton, { props: { variant: 'row' }, attachTo: document.body })
    await wrapper.get('button').trigger('click')
    await wrapper.get('button').trigger('click')
    expect(run).toHaveBeenCalledTimes(1)
    const element = wrapper.get('button')
    expect(element.attributes('aria-busy')).toBe('true')
    expect(element.attributes('aria-disabled')).toBe('true')
    expect(element.attributes('disabled')).toBeUndefined()
    expect(element.text()).toBe('Refreshing...')
    expect(element.find('svg').classes()).toContain('animate-spinner')
    expect(element.find('svg').classes()).toContain('motion-reduce:animate-none')
    gate.resolve()
    await flushPromises()
    expect(element.attributes('aria-busy')).toBeUndefined()
    expect(element.text()).toBe('Refresh')
    wrapper.unmount()
    page.unmount()
  })

  it('sits in the library toolbar before Tools, with the scan tooltip', () => {
    const page = mount(Page, { props: { handler: { run: vi.fn(async () => undefined) } } })
    const toolbar = mount(LibraryToolbar, {
      props: {
        title: 'LoRAs',
        countText: '2 models',
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
      },
      global: { stubs: { SearchCombobox: { template: '<input type="search" />' } } },
    })
    const buttons = toolbar.findAll('[role="toolbar"] > button, [role="toolbar"] > div > button')
    const refresh = toolbar.get('[role="toolbar"] button[aria-label="Refresh"]')
    expect(refresh.attributes('title')).toBe('Refresh (R): scan the library folders for added or removed files, then reload')
    expect(refresh.attributes('title')).not.toContain('classic')
    // Directly before the Tools menu button.
    const order = buttons.map((button) => button.attributes('aria-label') ?? button.text())
    expect(order.indexOf('Refresh')).toBe(order.indexOf('Tools') - 1)
    toolbar.unmount()
    page.unmount()
  })

  it('says "Scanning library..." while the page reports the scanning phase', async () => {
    const scanning = deferred()
    const loading = deferred()
    const page = mount(Page, {
      props: {
        handler: {
          run: async ({ setPhase }) => {
            setPhase('scanning')
            await scanning.promise
            setPhase('loading')
            await loading.promise
          },
        },
      },
    })
    const icon = mount(RefreshButton)
    const row = mount(RefreshButton, { props: { variant: 'row' } })
    const pending = runRefresh()
    await nextTick()
    expect(icon.get('button').attributes('title')).toBe('Scanning library...')
    expect(icon.get('button').attributes('aria-label')).toBe('Scanning library...')
    expect(row.get('button').text()).toBe('Scanning library...')
    scanning.resolve()
    await flushPromises()
    expect(row.get('button').text()).toBe('Refreshing...')
    loading.resolve()
    await pending
    await nextTick()
    expect(icon.get('button').attributes('title')).toBe('Refresh (R)')
    expect(icon.get('button').attributes('aria-label')).toBe('Refresh')
    icon.unmount()
    row.unmount()
    page.unmount()
  })

  it('appears in the PageShell header of content pages', () => {
    const page = mount(Page, { props: { handler: { run: vi.fn(async () => undefined) } } })
    const shell = mount(PageShell, { props: { title: 'Statistics' } })
    expect(shell.find('header button[aria-label="Refresh"]').exists()).toBe(true)
    page.unmount()
    shell.unmount()
    const bare = mount(PageShell, { props: { title: 'Not found' } })
    expect(bare.find('header button').exists()).toBe(false)
    bare.unmount()
  })
})

describe('runLibraryScan', () => {
  const ok = (status = 'complete') => async () => ({ status })

  it('scans only when the scanner is idle and reads the counts', async () => {
    const scan = vi.fn(async () => ({ status: 'success', added: 2, removed: 1 }))
    expect(await runLibraryScan({ initStatus: ok(), scan })).toEqual({ kind: 'scanned', added: 2, removed: 1 })
    expect(scan).toHaveBeenCalledTimes(1)
  })

  it('leaves a running scan alone (busy) and does not scan an unready library', async () => {
    const scan = vi.fn(async () => ({}))
    expect(await runLibraryScan({ initStatus: ok('initializing'), scan })).toEqual({ kind: 'busy' })
    expect(await runLibraryScan({ initStatus: ok('awaiting_first_scan'), scan })).toEqual({ kind: 'not-ready' })
    expect(await runLibraryScan({ initStatus: ok('error'), scan })).toEqual({ kind: 'not-ready' })
    expect(scan).not.toHaveBeenCalled()
  })

  it('treats a 409 as busy, other failures as failed, and missing counts as unknown', async () => {
    const conflict = async () => {
      throw new ApiError('Scan already running', 409)
    }
    expect(await runLibraryScan({ initStatus: ok(), scan: conflict })).toEqual({ kind: 'busy' })
    const broken = async () => {
      throw new ApiError('boom', 500)
    }
    expect(await runLibraryScan({ initStatus: ok(), scan: broken })).toEqual({ kind: 'failed', message: 'boom' })
    expect(await runLibraryScan({ initStatus: ok(), scan: async () => ({}) })).toEqual({ kind: 'scanned', added: null, removed: null })
    expect(await runLibraryScan({ initStatus: ok(), scan: async () => ({ status: 'cancelled' }) })).toEqual({
      kind: 'scanned',
      added: null,
      removed: null,
    })
  })

  it('rejects when the scanner state cannot be read (backend unreachable)', async () => {
    const down = async (): Promise<{ status?: string }> => {
      throw new ApiError('Network error', 0)
    }
    await expect(runLibraryScan({ initStatus: down, scan: vi.fn() })).rejects.toThrow('Network error')
  })

  it('builds a toast only for changes, a skipped scan or a failure', () => {
    const parts = { added: (n: number) => `${n} new`, removed: (n: number) => `${n} removed` }
    const notice = (outcome: ScanOutcome) => scanNotice(outcome, parts)
    expect(notice({ kind: 'scanned', added: 2, removed: 1 })).toEqual({ kind: 'info', key: 'refresh.scanChanges', params: { changes: '2 new, 1 removed' } })
    expect(notice({ kind: 'scanned', added: 0, removed: 3 })?.params).toEqual({ changes: '3 removed' })
    expect(notice({ kind: 'scanned', added: 0, removed: 0 })).toBeNull()
    expect(notice({ kind: 'scanned', added: null, removed: null })).toBeNull()
    expect(notice({ kind: 'busy' })?.key).toBe('refresh.scanBusy')
    expect(notice({ kind: 'not-ready' })?.key).toBe('refresh.scanNotReady')
    expect(notice({ kind: 'failed', message: 'x' })).toEqual({ kind: 'error', key: 'refresh.scanFailed', params: { message: 'x' } })
  })
})

// --- Library pages against a mocked backend ---------------------------------------

interface Call {
  url: string
  method: string
}

const ITEM = (name: string, extra: Record<string, unknown> = {}) => ({
  file_name: name,
  model_name: name,
  file_path: `/root/${name}.safetensors`,
  folder: '',
  preview_url: '',
  tags: [],
  notes: '',
  ...extra,
})

interface BackendState {
  version: number
  /** `init-status` answer. */
  scanner?: string
  scanResult?: Record<string, unknown>
  /** Holds the scan request open until resolved. */
  scanGate?: Promise<void>
}

function installBackend(state: BackendState) {
  const calls: Call[] = []
  setFetch(async (input, init) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/init-status')) return json({ status: state.scanner ?? 'complete' })
    if (/\/(loras|checkpoints|embeddings|recipes)\/scan/.test(url)) {
      await state.scanGate
      return json(state.scanResult ?? { status: 'success', message: 'scan completed', added: 0, removed: 0 })
    }
    if (/\/(loras|checkpoints|embeddings)\/list/.test(url)) {
      const items = [ITEM('alpha', { notes: `v${state.version}` }), ITEM('beta')]
      return json({ items, total: items.length, page: 1, total_pages: 1 })
    }
    if (/\/api\/lm\/recipes\?/.test(url)) {
      const items = [{ id: 'r1', title: `Recipe v${state.version}`, loras: [], tags: [] }]
      return json({ items, total: 1, page: 1, total_pages: 1 })
    }
    if (url.includes('unified-folder-tree')) return json({ tree: state.version > 1 ? { fresh: {} } : { old: {} } })
    if (url.includes('base-models')) return json({ base_models: [{ name: 'SDXL', count: 2 }] })
    if (url.includes('top-tags')) return json({ tags: [] })
    if (url.includes('/settings')) return json({ success: true, settings: {} })
    return json({ success: true })
  })
  return calls
}

const pathOf = (url: string) => new URL(url, 'http://x').pathname
const indexOf = (calls: Call[], test: (path: string) => boolean) => calls.findIndex((call) => test(pathOf(call.url)))

/** Stand-in for VirtualGrid with its exposed API (scroll anchor at the top). */
const GridStub = defineComponent({
  setup(_, { expose }) {
    expose({
      scrollToTop: () => undefined,
      scrollToIndex: () => undefined,
      scrollTo: () => undefined,
      scrollOffset: () => 0,
      anchor: () => ({ index: 0, offset: 0 }),
      scrollToAnchor: () => undefined,
    })
    return () => h('div', { class: 'grid-stub' })
  },
})

async function mountRoute(name: 'loras' | 'checkpoints' | 'embeddings' | 'recipes', path: string) {
  const component =
    name === 'recipes' ? (await import('@/pages/RecipesPage.vue')).default : (await import('@/pages/LibraryPage.vue')).default
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: `/${name}`, name, component, props: name === 'recipes' ? {} : { prefix: name } }],
  })
  await router.push(path)
  // jsdom has no layout: the virtual grid is stubbed (its maths has its own tests).
  const wrapper = mount(RouterView, {
    global: { plugins: [router], stubs: { VirtualGrid: GridStub } },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, router }
}

describe('library page refresh', () => {
  beforeEach(() => {
    useToasts().toasts.value = []
  })
  afterEach(() => {
    setFetch(null)
    clearBrowseView()
    useToasts().toasts.value = []
    document.body.innerHTML = ''
  })

  it('scans first (quick mode), then re-fetches with the same filters and keeps selection mode', async () => {
    const backend: BackendState = { version: 1, scanResult: { status: 'success', added: 2, removed: 1 } }
    const calls = installBackend(backend)
    saveBrowseView('loras', {
      search: '',
      folder: 'characters',
      baseModels: ['SDXL'],
      tags: ['anime'],
      favoritesOnly: true,
      updatesOnly: false,
      missingOnly: false,
      scrollTop: 0,
      loadedCount: 0,
      knownTotal: null,
    })
    const { wrapper } = await mountRoute('loras', '/loras')
    // Mounting never scans.
    expect(calls.some((call) => pathOf(call.url).endsWith('/scan'))).toBe(false)
    // Selection mode on (bare s).
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    await flushPromises()
    expect(wrapper.text()).toContain('selected')

    calls.length = 0
    backend.version = 2
    expect(await runRefresh()).toBe(true)
    await flushPromises()

    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    // Exactly one quick scan of this library: the bare URL, no full rebuild, no other mutating route.
    const scans = calls.filter((call) => pathOf(call.url).endsWith('/scan'))
    expect(scans.map((call) => call.url)).toEqual(['/api/lm/loras/scan'])
    expect(calls.some((call) => /full_rebuild|repair|first-scan/.test(call.url))).toBe(false)
    // Order: scanner state, then the scan, then the re-fetch.
    const status = calls.findIndex((call) => call.url === '/api/lm/init-status?page=loras')
    const scan = indexOf(calls, (path) => path === '/api/lm/loras/scan')
    const list = indexOf(calls, (path) => path === '/api/lm/loras/list')
    expect(status).toBeGreaterThanOrEqual(0)
    expect(status).toBeLessThan(scan)
    expect(scan).toBeLessThan(list)
    expect(scan).toBeLessThan(indexOf(calls, (path) => path.endsWith('unified-folder-tree')))

    const query = new URL(calls[list].url, 'http://x').searchParams
    expect(query.get('folder')).toBe('characters')
    expect(query.getAll('base_model')).toEqual(['SDXL'])
    expect(query.getAll('tag_include')).toEqual(['anime'])
    expect(query.get('favorites_only')).toBe('true')
    expect(query.get('page')).toBe('1')
    expect(calls.some((call) => call.url.includes('base-models'))).toBe(true)
    expect(calls.some((call) => call.url.includes('top-tags'))).toBe(true)
    // The scan found changes: one short summary toast.
    expect(useToasts().toasts.value.map((toast) => toast.message)).toEqual(['Library scan: 2 new, 1 removed'])
    // Still in selection mode.
    expect(wrapper.text()).toContain('selected')
    wrapper.unmount()
  })

  it.each(['checkpoints', 'embeddings'] as const)('scans /api/lm/%s/scan on that library', async (prefix) => {
    const calls = installBackend({ version: 1 })
    const { wrapper } = await mountRoute(prefix, `/${prefix}`)
    calls.length = 0
    expect(await runRefresh()).toBe(true)
    await flushPromises()
    expect(calls.filter((call) => pathOf(call.url).endsWith('/scan')).map((call) => call.url)).toEqual([`/api/lm/${prefix}/scan`])
    expect(calls.some((call) => call.url === `/api/lm/init-status?page=${prefix}`)).toBe(true)
    // No changes found: no toast.
    expect(useToasts().toasts.value).toEqual([])
    wrapper.unmount()
  })

  it('scans recipes with GET /api/lm/recipes/scan before re-reading them', async () => {
    const calls = installBackend({ version: 1, scanResult: { success: true, message: 'Recipe cache refreshed successfully' } })
    const { wrapper } = await mountRoute('recipes', '/recipes')
    calls.length = 0
    expect(await runRefresh()).toBe(true)
    await flushPromises()
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    expect(calls.filter((call) => pathOf(call.url).endsWith('/scan')).map((call) => call.url)).toEqual(['/api/lm/recipes/scan'])
    const scan = indexOf(calls, (path) => path === '/api/lm/recipes/scan')
    const list = indexOf(calls, (path) => path === '/api/lm/recipes')
    expect(scan).toBeGreaterThanOrEqual(0)
    expect(scan).toBeLessThan(list)
    expect(calls.findIndex((call) => call.url === '/api/lm/init-status?page=recipes')).toBeLessThan(scan)
    // Recipes answer no counts: no toast.
    expect(useToasts().toasts.value).toEqual([])
    wrapper.unmount()
  })

  it('keeps the tab-return refresh light: no scan, no scanner state request', async () => {
    const calls = installBackend({ version: 1 })
    const { wrapper } = await mountRoute('loras', '/loras')
    calls.length = 0
    expect(await runRefresh({ silent: true })).toBe(true)
    await flushPromises()
    expect(calls.some((call) => /\/scan|init-status/.test(call.url))).toBe(false)
    expect(calls.some((call) => pathOf(call.url) === '/api/lm/loras/list')).toBe(true)
    wrapper.unmount()
  })

  it('ignores a second trigger while the scan runs', async () => {
    let release!: () => void
    const backend: BackendState = { version: 1, scanGate: new Promise<void>((resolve) => (release = resolve)) }
    const calls = installBackend(backend)
    const { wrapper } = await mountRoute('loras', '/loras')
    calls.length = 0
    const first = runRefresh()
    await flushPromises()
    expect(await runRefresh()).toBe(false)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
    await flushPromises()
    release()
    expect(await first).toBe(true)
    await flushPromises()
    expect(calls.filter((call) => pathOf(call.url).endsWith('/scan'))).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not start a scan while the server is already scanning, but still reloads', async () => {
    const calls = installBackend({ version: 1, scanner: 'initializing' })
    const { wrapper } = await mountRoute('loras', '/loras')
    calls.length = 0
    expect(await runRefresh()).toBe(true)
    await flushPromises()
    expect(calls.some((call) => pathOf(call.url).endsWith('/scan'))).toBe(false)
    expect(calls.some((call) => pathOf(call.url) === '/api/lm/loras/list')).toBe(true)
    expect(useToasts().toasts.value.map((toast) => toast.message)).toEqual(['A library scan is already running; showing the current data.'])
    wrapper.unmount()
  })

  it('keeps the open drawer on the same model and re-reads its metadata', async () => {
    const backend: BackendState = { version: 1 }
    const calls = installBackend(backend)
    const { wrapper, router } = await mountRoute('loras', `/loras?open=${encodeURIComponent('/root/alpha.safetensors')}`)
    const drawer = () => document.body.querySelector('[role="dialog"][aria-modal="true"]')
    expect(drawer()).not.toBeNull()
    const before = drawer()

    calls.length = 0
    backend.version = 2
    expect(await runRefresh()).toBe(true)
    await flushPromises()

    // Same drawer element (not closed and re-opened), same model in the URL.
    expect(drawer()).toBe(before)
    expect(router.currentRoute.value.query.open).toBe('/root/alpha.safetensors')
    expect(calls.some((call) => call.url.includes('/loras/metadata'))).toBe(true)
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    // The drawer follows the refreshed notes (no unsaved draft).
    const notes = document.body.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement
    expect(notes.value).toBe('v2')

    // An unsaved notes draft is never overwritten by a refresh.
    notes.value = 'my draft'
    notes.dispatchEvent(new Event('input'))
    backend.version = 3
    expect(await runRefresh()).toBe(true)
    await flushPromises()
    expect(notes.value).toBe('my draft')
    wrapper.unmount()
  })
})
