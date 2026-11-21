import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { createPoller } from '@/composables/usePolling'
import { clampCardSize, useLibraryFilters } from '@/composables/useLibraryFilters'
import { LIBRARIES } from '@/config/libraries'
import type { PagedResponse } from '@/api/types'
import { buildSettingsPatch, draftFromSettings, validateConcurrency } from '@/utils/settingsForm'

function page<T>(items: T[], pageNo: number, totalPages: number, total = 99): PagedResponse<T> {
  return { items, page: pageNo, total_pages: totalPages, total, page_size: items.length }
}

describe('useInfiniteList', () => {
  it('appends pages until the last one', async () => {
    const fetcher = vi.fn(async (p: number) => page([`a${p}`], p, 2))
    const list = useInfiniteList<string>(fetcher)
    await list.reset()
    expect(list.items.value).toEqual(['a1'])
    expect(list.hasMore.value).toBe(true)
    await list.loadMore()
    expect(list.items.value).toEqual(['a1', 'a2'])
    expect(list.hasMore.value).toBe(false)
    await list.loadMore()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('drops stale responses after a reset', async () => {
    let resolveFirst: (value: PagedResponse<string>) => void = () => undefined
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(async () => page(['fresh'], 1, 1))
    const list = useInfiniteList<string>(fetcher)
    const first = list.reset()
    const second = list.reset()
    resolveFirst(page(['stale'], 1, 1))
    await Promise.all([first, second])
    expect(list.items.value).toEqual(['fresh'])
    // The first request was aborted.
    expect((fetcher.mock.calls[0][1] as AbortSignal).aborted).toBe(true)
  })

  it('reports errors and can update items in place', async () => {
    const list = useInfiniteList<{ id: number; v: string }>(async () => {
      throw new Error('boom')
    })
    await list.reset()
    expect(list.error.value).toBe('boom')

    const ok = useInfiniteList<{ id: number; v: string }>(async () => page([{ id: 1, v: 'a' }], 1, 1))
    await ok.reset()
    ok.updateItem((item) => item.id === 1, (item) => ({ ...item, v: 'b' }))
    expect(ok.items.value[0].v).toBe('b')
  })
})

describe('createPoller', () => {
  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('polls at the interval and pauses while the tab is hidden', async () => {
    vi.useFakeTimers()
    const task = vi.fn()
    const poller = createPoller(task, 1000)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(task).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(task).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(task).toHaveBeenCalledTimes(3)

    poller.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('never overlaps slow runs', async () => {
    vi.useFakeTimers()
    let running = 0
    let maxRunning = 0
    const poller = createPoller(async () => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await new Promise((resolve) => setTimeout(resolve, 2500))
      running -= 1
    }, 500)
    poller.start()
    await vi.advanceTimersByTimeAsync(10000)
    poller.stop()
    expect(maxRunning).toBe(1)
  })
})

describe('useLibraryFilters', () => {
  it('builds chips and clears them', async () => {
    const filters = useLibraryFilters(LIBRARIES.loras)
    filters.state.folder = 'Anima/style'
    filters.toggle('baseModels', 'Illustrious')
    filters.toggle('tags', 'style')
    filters.state.favoritesOnly = true
    await nextTick()
    expect(filters.chips.value.map((chip) => chip.label)).toEqual(['Folder: Anima/style', 'Illustrious', '#style', 'Favorites only'])
    expect(filters.panelCount.value).toBe(3)

    filters.chips.value[1].remove()
    expect(filters.state.baseModels).toEqual([])

    const before = filters.signature.value
    filters.clear()
    expect(filters.chips.value).toEqual([])
    expect(filters.signature.value).not.toBe(before)
  })

  it('clamps card sizes', () => {
    expect(clampCardSize(10)).toBe(140)
    expect(clampCardSize(999)).toBe(360)
    expect(clampCardSize(Number.NaN)).toBe(210)
  })
})

describe('settings form helpers', () => {
  const settings = {
    default_lora_root: 'G:/loras',
    default_checkpoint_root: 'G:/ckpt',
    default_unet_root: '',
    default_embedding_root: 'G:/emb',
    download_filename_templates: { lora: '{model_name}', custom: 'keep-me' },
    download_path_templates: {},
    download_queue_max_concurrent: 4,
    skip_previously_downloaded_model_versions: false,
    show_only_sfw: false,
    blur_mature_content: true,
    unrelated: 'x',
  }

  it('produces an empty patch when nothing changed', () => {
    expect(buildSettingsPatch(settings, draftFromSettings(settings))).toEqual({})
  })

  it('only sends changed keys and keeps unmanaged template entries', () => {
    const draft = draftFromSettings(settings)
    draft.roots.default_lora_root = 'C:/other'
    draft.filenameTemplates.lora = ''
    draft.pathTemplates.checkpoint = ' {base_model} '
    draft.concurrency = '2'
    draft.toggles.blur_mature_content = false
    expect(buildSettingsPatch(settings, draft)).toEqual({
      default_lora_root: 'C:/other',
      download_filename_templates: { custom: 'keep-me' },
      download_path_templates: { checkpoint: '{base_model}' },
      download_queue_max_concurrent: 2,
      blur_mature_content: false,
    })
  })

  it('validates concurrency', () => {
    expect(validateConcurrency('3')).toBeNull()
    expect(validateConcurrency('0')).not.toBeNull()
    expect(validateConcurrency('6')).not.toBeNull()
    expect(validateConcurrency('2.5')).not.toBeNull()
    expect(validateConcurrency('')).not.toBeNull()
    expect(validateConcurrency(4)).toBeNull()
    expect(validateConcurrency(7)).not.toBeNull()
  })

  it('leaves invalid concurrency out of the patch', () => {
    const draft = draftFromSettings(settings)
    draft.concurrency = '99'
    expect(buildSettingsPatch(settings, draft)).toEqual({})
  })
})
