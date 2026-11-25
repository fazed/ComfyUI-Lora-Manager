/**
 * Updates phase 2: bulk update (selection rules, confirm contents, sequential
 * queueing with live progress, partial failures, duplicates, stop on a hard
 * error, no double submit), ignore / restore (payloads, optimistic view,
 * Undo, rollback on error, the Ignored view), changelog and file format in
 * the row, Check now's stop, and the drawer's Versions tab (destination next
 * to the file, classification chip). Every backend call is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { setFetch } from '@/api/http'
import { createModelApi, updatesApi } from '@/api/endpoints'
import type { ModelItem, QueueItem, UpdateCandidate, UpdateGroup, UpdatesOverview } from '@/api/types'
import { setBasePathsForTesting } from '@/utils/basePath'
import {
  applyIgnoreChanges,
  autoSelectable,
  bulkConfirmMessage,
  bulkSizeText,
  destinationForFile,
  fileLabel,
  filterCounts,
  formatLabel,
  hardErrorOf,
  ignoredEntries,
  summarizeBulk,
  versionClassification,
  type BulkItem,
} from '@/utils/updates'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import { resetUpdatesSummaryForTesting } from '@/composables/useUpdates'
import { ALWAYS_KEEP_KEY, resetReplaceChoiceForTesting } from '@/composables/useReplaceChoice'
import { installDialogStub } from './dialogStub'

installDialogStub()
import UpdatesPage from '@/pages/UpdatesPage.vue'
import UpdateRow from '@/components/UpdateRow.vue'
import ModelDrawer from '@/components/ModelDrawer.vue'
import { routes } from '@/router'

// --- fixtures ----------------------------------------------------------------

function cand(partial: Partial<UpdateCandidate> & { versionId: number }): UpdateCandidate {
  return {
    name: `v${partial.versionId}`,
    baseModel: 'Illustrious',
    releasedAt: '2026-11-04T00:00:00Z',
    sizeBytes: 100 * 1024 * 1024,
    fileCount: 1,
    usageControl: 'Download',
    isEarlyAccess: false,
    earlyAccessEndsAt: null,
    isPaid: false,
    previewUrl: null,
    hasBeenDownloaded: false,
    isIgnored: false,
    confidence: 'likely',
    reason: 'next_version_same_base',
    hiddenBecause: [],
    ...partial,
  }
}

function group(partial: Partial<UpdateGroup> & { modelId: number; candidates: UpdateCandidate[] }, folder = 'styles'): UpdateGroup {
  const base = partial.baseModel ?? 'Illustrious'
  return {
    key: `${partial.modelId}:${base.toLowerCase()}`,
    modelName: `Model ${partial.modelId}`,
    baseModel: base,
    tier: 'likely',
    isIgnored: false,
    lastCheckedAt: '2026-11-13T00:00:00Z',
    ownedVersionIds: [partial.modelId * 10],
    newestOwned: { versionId: partial.modelId * 10, name: 'v1.0', releasedAt: '2026-11-01T00:00:00Z', sizeBytes: 1 },
    previewNsfwLevel: 0,
    localCards: [
      {
        filePath: `D:/Models/Loras/${folder}/model${partial.modelId}.safetensors`,
        fileName: `model${partial.modelId}`,
        folder,
        baseModel: base,
        versionId: partial.modelId * 10,
        versionName: 'v1.0',
        releasedAt: '2026-11-01T00:00:00Z',
        sizeBytes: 1,
        previewUrl: null,
        previewNsfwLevel: 0,
      },
    ],
    ...partial,
  }
}

/** Three likely lines (two folders, one outside every root), a possible one, a hidden variant, an ignored model and version. */
function overviewFixture(): UpdatesOverview {
  return {
    success: true,
    modelType: 'lora',
    settings: { hideEarlyAccessUpdates: false, hidePaidUpdates: false },
    totals: { likely: 3, possible: 1, hidden: 2, groups: 6, upToDate: 10 },
    models: { local: 20, tracked: 20, checked: 20, untracked: 0, neverChecked: 0 },
    unchecked: 0,
    oldestCheckedAt: '2026-11-13T00:00:00Z',
    newestCheckedAt: '2026-11-24T00:00:00Z',
    groups: [
      group({ modelId: 1, modelName: 'Ink', candidates: [cand({ versionId: 11, name: 'v2' })] }, 'styles'),
      group({ modelId: 2, modelName: 'Pencil', candidates: [cand({ versionId: 21, name: 'v3', sizeBytes: null })] }, 'sketch'),
      {
        ...group({ modelId: 3, modelName: 'Elsewhere', candidates: [cand({ versionId: 31, name: 'v4' })] }),
        localCards: [{ ...group({ modelId: 3, candidates: [] }).localCards[0], filePath: 'Z:/Other/model3.safetensors' }],
      },
      group({
        modelId: 4,
        modelName: 'Paint',
        tier: 'possible',
        candidates: [
          cand({ versionId: 41, name: 'alt', confidence: 'possible', reason: 'parallel_line' }),
          cand({ versionId: 42, name: 'old v2', confidence: 'likely', isIgnored: true, hiddenBecause: ['ignored'] }),
        ],
      }),
      group({
        modelId: 5,
        modelName: 'Remap',
        tier: 'hidden',
        candidates: [cand({ versionId: 51, confidence: 'variant', reason: 'looks_like_format_variant', hiddenBecause: ['already_downloaded'] })],
      }),
      group({
        modelId: 6,
        modelName: 'Muted',
        tier: 'hidden',
        isIgnored: true,
        candidates: [cand({ versionId: 61, isIgnored: true, hiddenBecause: ['ignored'] })],
      }),
    ],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface Call {
  method: string
  url: string
  body?: string
}

type Handler = (call: Call) => Response | Promise<Response>

function backend(overrides: Record<string, Handler> = {}) {
  const calls: Call[] = []
  let queue: QueueItem[] = []
  const state = {
    overview: overviewFixture() as UpdatesOverview,
    setQueue: (items: QueueItem[]) => (queue = items),
    addHandler: null as Handler | null,
  }
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? 'GET', url: input, body: init?.body as string | undefined }
    calls.push(call)
    const path = input.split('?')[0]
    const key = `${call.method} ${path}`
    if (overrides[key]) return overrides[key](call)
    if (key === 'GET /api/lm/downloads/queue/add' && state.addHandler) return state.addHandler(call)
    if (key.endsWith('/updates/overview')) return jsonResponse(state.overview)
    if (key.endsWith('/roots')) return jsonResponse({ success: true, roots: ['D:\\Models\\Loras'] })
    if (key === 'GET /api/lm/downloads/queue') return jsonResponse({ success: true, queue, stats: {}, worker: null, queue_worker: true })
    if (key === 'GET /api/lm/downloads/history') return jsonResponse({ success: true, items: [], total: 0 })
    if (key === 'GET /api/lm/settings') return jsonResponse({ success: true, settings: { blur_mature_content: true } })
    if (key === 'GET /api/lm/downloads/queue/add') return jsonResponse({ success: true, queued: true, duplicate: false, item: null })
    if (key.endsWith('/updates/ignore-version') || key.endsWith('/updates/ignore')) return jsonResponse({ success: true, record: {} })
    if (key.endsWith('/updates/refresh')) return jsonResponse({ success: true, records: [], events: [] })
    if (key.endsWith('/cancel-task')) return jsonResponse({ status: 'success' })
    return jsonResponse({ success: false, error: `unexpected ${key}` }, 500)
  })
  setFetch(fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)
  return { calls, state }
}

async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/updates')
  await router.isReady()
  const wrapper = mount(UpdatesPage, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const confirmState = () => useConfirm().confirmState
async function answerConfirm(value: boolean) {
  expect(confirmState().value).not.toBeNull()
  confirmState().value!.resolve(value)
  await flushPromises()
}
/** Update selected opens its own summary dialog (with the per-row Keep / Replace choice; Keep by default). */
async function answerBulk(value: boolean) {
  const dialog = document.querySelector('[data-testid="bulk-confirm"]')
  expect(dialog).not.toBeNull()
  const target = value
    ? (dialog!.querySelector('[data-testid="bulk-confirm-submit"]') as HTMLButtonElement)
    : ([...dialog!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement)
  target.click()
  await flushPromises()
}

const filterButton = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('[role="group"] button').find((b) => b.text().startsWith(label))!
const button = (wrapper: VueWrapper, label: string) => wrapper.findAll('button').find((b) => b.text().trim() === label)!
const adds = (calls: Call[]) =>
  calls.filter((c) => c.url.startsWith('/api/lm/downloads/queue/add')).map((c) => Number(new URL(c.url, 'http://x').searchParams.get('model_version_id')))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  setBasePathsForTesting({ appBase: 'http://host/lm-ui/', appPath: '/lm-ui/', mountPrefix: '' })
  localStorage.clear()
  // Queueing is covered here with "always keep both" remembered (no replace prompt);
  // the prompt and the bulk Keep / Replace choice are covered in versionManagement.test.ts.
  localStorage.setItem(ALWAYS_KEEP_KEY, 'true')
  resetReplaceChoiceForTesting()
  resetUpdatesSummaryForTesting()
  useToasts().toasts.value = []
  confirmState().value = null
})

afterEach(() => {
  setFetch(null)
  setBasePathsForTesting(null)
  document.body.innerHTML = ''
})

// --- helpers ---------------------------------------------------------------------

describe('phase 2 helpers', () => {
  const data = overviewFixture()
  const item = (g: UpdateGroup, roots = ['D:/Models/Loras']): BulkItem => ({
    key: g.key,
    group: g,
    candidate: g.candidates[0],
    destination: destinationForFile(g.localCards[0].filePath, roots),
  })

  it('lists ignored models once and ignored versions of models that are not ignored', () => {
    const entries = ignoredEntries(data.groups)
    expect(entries.map((e) => e.key)).toEqual(['v:4:42', 'm:6'])
    expect(filterCounts(data).ignored).toBe(2)
    const twoLines = [data.groups[5], { ...data.groups[5], key: '6:pony', baseModel: 'Pony' }]
    expect(ignoredEntries(twoLines)).toHaveLength(1)
  })

  it('applies an ignore optimistically: the gate, the tier and the totals', () => {
    const view = applyIgnoreChanges(data, [{ modelId: 1, versionId: 11, ignore: true }])!
    const ink = view.groups.find((g) => g.modelId === 1)!
    expect(ink.candidates[0].isIgnored).toBe(true)
    expect(ink.candidates[0].hiddenBecause).toEqual(['ignored'])
    expect(ink.tier).toBe('hidden')
    expect(view.totals).toMatchObject({ likely: 2, possible: 1, hidden: 3 })
    // The input is not mutated.
    expect(data.groups[0].tier).toBe('likely')
  })

  it('restores a version and a model optimistically', () => {
    const restoredVersion = applyIgnoreChanges(data, [{ modelId: 4, versionId: 42, ignore: false }])!
    const paint = restoredVersion.groups.find((g) => g.modelId === 4)!
    expect(paint.candidates[1].hiddenBecause).toEqual([])
    expect(paint.tier).toBe('likely')
    const restoredModel = applyIgnoreChanges(data, [{ modelId: 6, versionId: null, ignore: false }])!
    const muted = restoredModel.groups.find((g) => g.modelId === 6)!
    expect(muted.isIgnored).toBe(false)
    expect(muted.candidates[0].isIgnored).toBe(false)
    expect(muted.tier).toBe('likely')
    expect(applyIgnoreChanges(data, [])).toBe(data)
  })

  it('auto-selects only visible rows whose Update is available', () => {
    const [ink, , , , remap] = data.groups
    expect(autoSelectable({ group: ink, candidate: ink.candidates[0], more: 0 }, null)).toBe(true)
    expect(autoSelectable({ group: ink, candidate: ink.candidates[0], more: 0 }, { kind: 'queued' })).toBe(false)
    expect(autoSelectable({ group: ink, candidate: ink.candidates[0], more: 0 }, { kind: 'done' })).toBe(false)
    expect(autoSelectable({ group: ink, candidate: ink.candidates[0], more: 0 }, { kind: 'failed', error: 'x' })).toBe(true)
    expect(autoSelectable({ group: remap, candidate: remap.candidates[0], more: 0 }, null)).toBe(false)
  })

  it('summarizes a bulk plan: count, size, distinct folders and the default fallback', () => {
    const [ink, pencil, elsewhere] = data.groups
    const summary = summarizeBulk([item(ink), item(pencil), item(elsewhere), item({ ...ink, key: 'x' })])
    expect(summary).toEqual({
      count: 4,
      totalBytes: 300 * 1024 * 1024,
      unknownSizes: 1,
      folders: ['D:/Models/Loras/styles', 'D:/Models/Loras/sketch'],
      defaultCount: 1,
    })
    expect(bulkSizeText(summary)).toBe('at least 300.0 MB (1 without a size)')
    expect(bulkSizeText({ count: 1, totalBytes: 0, unknownSizes: 1 })).toBe('size unknown')
    const message = bulkConfirmMessage(summary)
    expect(message).toContain('4 updates will be added to the download queue')
    expect(message).toContain('- D:/Models/Loras/styles\n- D:/Models/Loras/sketch')
    expect(message).toContain('1 without a known library folder: saved to the default folder')
  })

  it('treats 403, offline and 429 as errors that stop a bulk run', () => {
    expect(hardErrorOf(403)).toBe('forbidden')
    expect(hardErrorOf(0)).toBe('offline')
    expect(hardErrorOf(503)).toBe('offline')
    expect(hardErrorOf(429)).toBe('rate_limited')
    expect(hardErrorOf(400)).toBeNull()
    expect(hardErrorOf(500)).toBeNull()
    expect(hardErrorOf(null)).toBeNull()
  })

  it('derives a destination from a file path (shared with the drawer)', () => {
    expect(destinationForFile('d:\\models\\loras\\a\\b.safetensors', ['D:/Models/Loras'])).toEqual({
      params: { model_root: 'D:/Models/Loras', relative_path: 'a', use_default_paths: 'false' },
      known: true,
      display: 'D:/Models/Loras/a',
    })
    expect(destinationForFile('D:/Models/LorasX/b.safetensors', ['D:/Models/Loras']).known).toBe(false)
    expect(destinationForFile(null, ['D:/Models/Loras']).params).toEqual({})
  })

  it('classifies the versions of one model, best confidence first', () => {
    const map = versionClassification(data, 4)
    expect(map.get(41)).toBe('possible')
    expect(map.get(42)).toBe('likely')
    expect(versionClassification(data, 999).size).toBe(0)
    expect(versionClassification(null, 4).size).toBe(0)
  })

  it('labels the file format', () => {
    expect(formatLabel({ fileFormat: 'SafeTensor', precision: 'fp16' })).toBe('SafeTensor · fp16')
    expect(formatLabel({ fileFormat: 'GGUF', precision: null })).toBe('GGUF')
    expect(formatLabel({})).toBe('')
    expect(fileLabel({ type: 'Model', format: 'GGUF', precision: 'fp8', size: 'pruned', sizeBytes: 1, primary: false })).toBe('GGUF · fp8 · pruned')
  })
})

// --- API ---------------------------------------------------------------------------

describe('phase 2 API', () => {
  it('ignore-version and ignore post the backend payloads', async () => {
    const { calls } = backend()
    await updatesApi.ignoreVersion('loras', 1, 11, true)
    await updatesApi.ignoreModel('checkpoints', 2, false)
    await updatesApi.cancelCheck('embeddings')
    expect(calls.map((c) => [c.method, c.url, c.body && JSON.parse(c.body)])).toEqual([
      ['POST', '/api/lm/loras/updates/ignore-version', { modelId: 1, versionId: 11, shouldIgnore: true }],
      ['POST', '/api/lm/checkpoints/updates/ignore', { modelId: 2, shouldIgnore: false }],
      ['POST', '/api/lm/embeddings/cancel-task', {}],
    ])
  })
})

// --- row ---------------------------------------------------------------------------

describe('UpdateRow phase 2', () => {
  async function mountRow(props: Partial<InstanceType<typeof UpdateRow>['$props']> = {}) {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const data = overviewFixture()
    return mount(UpdateRow, {
      global: { plugins: [router] },
      attachTo: document.body,
      props: {
        group: data.groups[0],
        candidate: data.groups[0].candidates[0],
        prefix: 'loras',
        state: null,
        queuing: false,
        destination: { params: {}, known: false, display: '' },
        moreCount: 0,
        blurMature: true,
        civitaiHost: 'civitai.com',
        ...props,
      },
    })
  }

  it('has a labelled checkbox only while Update is available', async () => {
    const row = await mountRow()
    const box = row.get('input[type="checkbox"]')
    expect(box.attributes('aria-label')).toBe('Select Ink v2 for Update selected')
    await box.setValue(true)
    expect(row.emitted('select')).toEqual([[true]])
    expect((await mountRow({ state: { kind: 'queued' } })).find('input[type="checkbox"]').exists()).toBe(false)
    expect((await mountRow({ state: { kind: 'done' } })).find('input[type="checkbox"]').exists()).toBe(false)
    const locked = await mountRow({ locked: true })
    expect(locked.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
    expect(locked.get('button[aria-label="Update Ink to v2"]').attributes('disabled')).toBeDefined()
  })

  it('shows the changelog as text in a collapsed section and the format badge', async () => {
    const data = overviewFixture()
    const candidate = cand({
      versionId: 11,
      name: 'v2',
      description: 'Better hands.\n<img src=x onerror=alert(1)>',
      fileFormat: 'SafeTensor',
      precision: 'fp16',
      files: [
        { type: 'Model', format: 'SafeTensor', precision: 'fp16', size: 'pruned', sizeBytes: 2048, primary: true },
        { type: 'Model', format: 'GGUF', precision: 'fp8', size: null, sizeBytes: null, primary: false },
      ],
    })
    const row = await mountRow({ group: data.groups[0], candidate })
    expect(row.get('[data-testid="format-badge"]').text()).toBe('SafeTensor · fp16')
    const details = row.get('details[data-testid="changelog"]')
    expect(details.attributes('open')).toBeUndefined()
    expect(details.get('summary').text()).toContain("What's new")
    expect(details.text()).toContain('Better hands.')
    // Rendered as text, never as markup.
    expect(details.find('img').exists()).toBe(false)
    expect(details.text()).toContain('<img src=x onerror=alert(1)>')
    expect(details.text()).toContain('GGUF · fp8')
    expect(details.text()).toContain('(main file)')
  })

  it('shows nothing extra before the next check', async () => {
    const row = await mountRow()
    expect(row.find('[data-testid="changelog"]').exists()).toBe(false)
    expect(row.find('[data-testid="format-badge"]').exists()).toBe(false)
  })

  it('offers Ignore this version / Ignore model in a menu', async () => {
    const row = await mountRow()
    await button(row, 'Ignore').trigger('click')
    const items = row.findAll('[role="menuitem"]')
    expect(items.map((i) => i.text())).toEqual(['Ignore this version', 'Ignore model'])
    await items[1].trigger('click')
    expect(row.emitted('ignore')).toEqual([['model']])
  })
})

// --- bulk update -------------------------------------------------------------------

describe('bulk update on the Updates page', () => {
  let wrapper: VueWrapper | null = null
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('Select all visible picks the selectable rows of the current filter', async () => {
    const { state } = backend()
    state.setQueue([{ download_id: 'q', model_version_id: 21, status: 'queued' } as QueueItem])
    wrapper = await mountPage()
    const bar = wrapper.get('[data-testid="bulk-bar"]')
    await button(wrapper, 'Select all visible').trigger('click')
    // Likely: Ink and Elsewhere; Pencil is already queued (no checkbox).
    expect(wrapper.find('[data-testid="select-2:illustrious"]').exists()).toBe(false)
    expect(bar.text()).toContain('2 selected')
    expect(bar.text()).toContain('200.0 MB in total')

    await filterButton(wrapper, 'All').trigger('click')
    await button(wrapper, 'Select all visible').trigger('click')
    // All: Paint's visible possible candidate joins; the hidden variant and the ignored model do not.
    expect(wrapper.get('[data-testid="bulk-bar"]').text()).toContain('3 selected')
    expect((wrapper.get('[data-testid="select-5:illustrious"]').element as HTMLInputElement).checked).toBe(false)
    // A hidden row can still be ticked by hand.
    await wrapper.get('[data-testid="select-5:illustrious"]').setValue(true)
    expect(wrapper.get('[data-testid="bulk-bar"]').text()).toContain('4 selected')
    await button(wrapper, 'Clear selection').trigger('click')
    expect(wrapper.get('[data-testid="bulk-bar"]').text()).toContain('0 selected')
  })

  it('confirms with count, size and folders, then queues sequentially with live progress', async () => {
    const { calls, state } = backend()
    const gates: Array<ReturnType<typeof deferred<Response>>> = []
    let inFlight = 0
    let maxInFlight = 0
    state.addHandler = async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      const gate = deferred<Response>()
      gates.push(gate)
      const response = await gate.promise
      inFlight -= 1
      return response
    }
    wrapper = await mountPage()
    await button(wrapper, 'Select all visible').trigger('click')
    await wrapper.get('[data-testid="bulk-update"]').trigger('click')
    await flushPromises()
    expect(document.getElementById('bulk-update-confirm-title')?.textContent).toBe('Update 3 models?')
    const message = document.querySelector('[data-testid="bulk-confirm-message"]')!.textContent!
    expect(message).toContain('3 updates will be added to the download queue (at least 200.0 MB (1 without a size))')
    expect(message).toContain('- D:/Models/Loras/styles\n- D:/Models/Loras/sketch')
    expect(message).toContain('1 without a known library folder: saved to the default folder')
    expect(message).toContain('Nothing is deleted')
    expect(document.querySelector('[data-testid="bulk-confirm-submit"]')!.textContent!.trim()).toBe('Update 3')
    expect(adds(calls)).toEqual([])
    await answerBulk(true)

    const status = () => wrapper!.get('[data-testid="bulk-status"]')
    expect(status().attributes('aria-live')).toBe('polite')
    expect(status().text()).toContain('Queueing 0/3')
    expect(wrapper.get('[data-testid="bulk-update"]').attributes('disabled')).toBeDefined()
    // Second click while running: ignored.
    await wrapper.get('[data-testid="bulk-update"]').trigger('click')
    gates[0].resolve(jsonResponse({ success: true, queued: true, duplicate: false, item: null }))
    await flushPromises()
    expect(status().text()).toContain('Queueing 1/3')
    gates[1].resolve(jsonResponse({ success: true, queued: true, duplicate: false, item: null }))
    await flushPromises()
    gates[2].resolve(jsonResponse({ success: true, queued: true, duplicate: false, item: null }))
    await flushPromises()
    expect(maxInFlight).toBe(1)
    expect(adds(calls)).toEqual([11, 21, 31])
    // Same destination rule as single Update; the row without a known root sends none.
    const params = calls.filter((c) => c.url.startsWith('/api/lm/downloads/queue/add')).map((c) => new URL(c.url, 'http://x').searchParams)
    expect(params[0].get('relative_path')).toBe('styles')
    expect(params[1].get('relative_path')).toBe('sketch')
    expect(params[2].get('model_root')).toBeNull()
    expect(status().text()).toContain('3 added to the queue')
    expect(status().get('a').attributes('href')).toContain('/downloads')
    expect(document.querySelector('[data-testid="bulk-confirm"]')).toBeNull()
    // Nothing was asked to be replaced.
    expect(params.every((p) => p.getAll('replace_file_path').length === 0)).toBe(true)
    // Added rows leave the selection.
    expect(wrapper.get('[data-testid="bulk-bar"]').text()).toContain('0 selected')
  })

  it('cancelling the confirm sends nothing', async () => {
    const { calls } = backend()
    wrapper = await mountPage()
    await button(wrapper, 'Select all visible').trigger('click')
    await wrapper.get('[data-testid="bulk-update"]').trigger('click')
    await answerBulk(false)
    expect(adds(calls)).toEqual([])
  })

  it('continues after a per-item error, counts duplicates and keeps failed rows selected', async () => {
    const { state } = backend()
    let n = 0
    state.addHandler = () => {
      n += 1
      if (n === 1) return jsonResponse({ success: false, error: 'Version not found' }, 400)
      return jsonResponse({ success: true, queued: false, duplicate: true, item: null })
    }
    wrapper = await mountPage()
    await button(wrapper, 'Select all visible').trigger('click')
    await wrapper.get('[data-testid="bulk-update"]').trigger('click')
    await answerBulk(true)
    const status = wrapper.get('[data-testid="bulk-status"]').text()
    expect(n).toBe(3)
    expect(status).toContain('2 already queued')
    expect(status).toContain('1 failed')
    expect(status).toContain('Ink v2: Version not found')
    expect(wrapper.get('[data-testid="bulk-bar"]').text()).toContain('1 selected')
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Bulk update finished: 0 added, 2 already queued, 1 failed.')
  })

  it('stops at a 403 (request guard) and reports the rest as not sent', async () => {
    const { calls, state } = backend()
    state.overview.groups.push(group({ modelId: 7, modelName: 'Late', candidates: [cand({ versionId: 71 })] }))
    state.addHandler = () => jsonResponse({ success: false, error: 'Cross-site request blocked', code: 'csrf_blocked' }, 403)
    wrapper = await mountPage()
    await button(wrapper, 'Select all visible').trigger('click')
    await wrapper.get('[data-testid="bulk-update"]').trigger('click')
    await answerBulk(true)
    expect(adds(calls)).toEqual([11])
    const status = wrapper.get('[data-testid="bulk-status"]').text()
    expect(status).toContain('1 failed')
    expect(status).toContain('3 not sent')
    expect(status).toContain('Stopped: the backend refused the request (403)')
    expect(wrapper.get('[data-testid="bulk-bar"]').text()).toContain('4 selected')
  })

  it('with the stop option off, a hard error does not stop the run', async () => {
    const { calls, state } = backend()
    state.addHandler = () => jsonResponse({ success: false, error: 'Too many requests' }, 429)
    wrapper = await mountPage()
    expect(wrapper.find('[data-testid="bulk-bar"] input[type="checkbox"]').exists()).toBe(false)
    await button(wrapper, 'Select all visible').trigger('click')
    await wrapper.get('[data-testid="bulk-bar"] input[type="checkbox"]').setValue(false)
    await wrapper.get('[data-testid="bulk-update"]').trigger('click')
    await answerBulk(true)
    expect(adds(calls)).toEqual([11, 21, 31])
    expect(wrapper.get('[data-testid="bulk-status"]').text()).toContain('3 failed')
  })
})

// --- ignore / restore -----------------------------------------------------------------

describe('ignore and restore on the Updates page', () => {
  let wrapper: VueWrapper | null = null
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  async function ignoreFirstRow(scope: 'Ignore this version' | 'Ignore model') {
    await wrapper!.findAll('li')[0].findAll('button').find((b) => b.text().trim() === 'Ignore')!.trigger('click')
    await wrapper!.findAll('[role="menuitem"]').find((b) => b.text() === scope)!.trigger('click')
  }

  it('ignores a version optimistically, stores it, reloads and refreshes the badge counts', async () => {
    const gate = deferred<Response>()
    const { calls } = backend({ 'POST /api/lm/loras/updates/ignore-version': () => gate.promise })
    wrapper = await mountPage()
    expect(wrapper.findAll('li h3').map((h) => h.text())).toEqual(['Ink', 'Pencil', 'Elsewhere'])
    const overviewReads = () => calls.filter((c) => c.url.endsWith('/updates/overview')).length
    const before = overviewReads()
    await ignoreFirstRow('Ignore this version')
    await flushPromises()
    // Hidden at once, before the backend answered.
    expect(wrapper.findAll('li h3').map((h) => h.text())).toEqual(['Pencil', 'Elsewhere'])
    const post = calls.find((c) => c.url === '/api/lm/loras/updates/ignore-version')!
    expect(JSON.parse(post.body!)).toEqual({ modelId: 1, versionId: 11, shouldIgnore: true })
    gate.resolve(jsonResponse({ success: true, record: {} }))
    await flushPromises()
    // Re-read the overview, and forced count reads for every type.
    expect(overviewReads()).toBeGreaterThan(before)
    expect(calls.some((c) => c.url === '/api/lm/checkpoints/updates/overview')).toBe(true)
    const toast = useToasts().toasts.value.at(-1)!
    expect(toast.message).toBe('Ignored Ink v2.')
    expect(toast.action?.label).toBe('Undo')
  })

  it('Undo restores with the same endpoint and shouldIgnore:false', async () => {
    const { calls } = backend()
    wrapper = await mountPage()
    await ignoreFirstRow('Ignore model')
    await flushPromises()
    expect(JSON.parse(calls.find((c) => c.url === '/api/lm/loras/updates/ignore')!.body!)).toEqual({ modelId: 1, shouldIgnore: true })
    useToasts().toasts.value.at(-1)!.action!.run()
    await flushPromises()
    const posts = calls.filter((c) => c.url === '/api/lm/loras/updates/ignore').map((c) => JSON.parse(c.body!))
    expect(posts).toEqual([
      { modelId: 1, shouldIgnore: true },
      { modelId: 1, shouldIgnore: false },
    ])
    expect(useToasts().toasts.value.at(-1)?.message).toBe('Restored Ink: its new versions are offered again.')
  })

  it('rolls the change back when the backend refuses it', async () => {
    backend({ 'POST /api/lm/loras/updates/ignore-version': () => jsonResponse({ success: false, error: 'database locked' }, 500) })
    wrapper = await mountPage()
    await ignoreFirstRow('Ignore this version')
    await flushPromises()
    expect(wrapper.findAll('li h3').map((h) => h.text())).toEqual(['Ink', 'Pencil', 'Elsewhere'])
    const toast = useToasts().toasts.value.at(-1)!
    expect(toast.kind).toBe('error')
    expect(toast.message).toBe('Could not save the change: database locked')
  })

  it('the Ignored view lists ignored models and versions with Restore', async () => {
    const { calls } = backend()
    wrapper = await mountPage()
    expect(filterButton(wrapper, 'Ignored').text()).toContain('2')
    await filterButton(wrapper, 'Ignored').trigger('click')
    const view = wrapper.get('[data-testid="ignored-view"]')
    expect(view.findAll('li h3').map((h) => h.text())).toEqual(['Paint', 'Muted'])
    expect(view.text()).toContain('old v2')
    expect(view.text()).toContain('All versions')
    expect(wrapper.find('[data-testid="bulk-bar"]').exists()).toBe(false)
    await view.get('button[aria-label="Restore Muted All versions"]').trigger('click')
    await flushPromises()
    await wrapper.get('button[aria-label="Restore Paint old v2"]').trigger('click')
    await flushPromises()
    expect(calls.filter((c) => c.method === 'POST').map((c) => [c.url, JSON.parse(c.body!)])).toEqual([
      ['/api/lm/loras/updates/ignore', { modelId: 6, shouldIgnore: false }],
      ['/api/lm/loras/updates/ignore-version', { modelId: 4, versionId: 42, shouldIgnore: false }],
    ])
  })

  it('an empty Ignored view says so', async () => {
    const { state } = backend()
    state.overview.groups = state.overview.groups.filter((g) => g.modelId < 4)
    wrapper = await mountPage()
    await filterButton(wrapper, 'Ignored').trigger('click')
    expect(wrapper.text()).toContain('Nothing ignored')
  })
})

// --- Check now stop ---------------------------------------------------------------------

describe('Check now progress and stop', () => {
  it('shows the running state and stops through cancel-task', async () => {
    const gate = deferred<Response>()
    const { calls } = backend({ 'POST /api/lm/loras/updates/refresh': () => gate.promise })
    const wrapper = await mountPage()
    await button(wrapper, 'Check now').trigger('click')
    await answerConfirm(true)
    const progress = wrapper.get('[data-testid="check-progress"]')
    expect(progress.text()).toContain('Checking Civitai for new versions of your LoRAs')
    await button(wrapper, 'Stop').trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/lm/loras/cancel-task')).toBe(true)
    expect(wrapper.get('[data-testid="check-progress"]').text()).toContain('Stopping after the current model')
    gate.resolve(jsonResponse({ success: false, status: 'cancelled', message: 'Update refresh cancelled' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="check-progress"]').exists()).toBe(false)
    expect(useToasts().toasts.value.at(-1)?.message).toBe('Check stopped. Models checked so far keep their results.')
    expect(useToasts().toasts.value.some((t) => t.kind === 'error')).toBe(false)
    wrapper.unmount()
  })
})

// --- drawer Versions tab ------------------------------------------------------------------

describe('drawer Versions tab', () => {
  const item = {
    file_path: 'D:/Models/Loras/styles/ink/model4.safetensors',
    file_name: 'model4',
    model_name: 'Paint',
    folder: 'styles/ink',
    base_model: 'Illustrious',
    from_civitai: true,
    tags: [],
    civitai: { modelId: 4, id: 40 },
  } as unknown as ModelItem

  function drawerBackend() {
    return backend({
      'GET /api/lm/loras/updates/versions/4': () =>
        jsonResponse({
          success: true,
          record: {
            modelId: 4,
            hasUpdate: true,
            versions: [
              { versionId: 41, name: 'alt', isInLibrary: false },
              { versionId: 42, name: 'old v2', isInLibrary: false },
              { versionId: 43, name: 'older', isInLibrary: false },
              { versionId: 40, name: 'v1.0', isInLibrary: true },
            ],
          },
        }),
      'GET /api/lm/loras/metadata': () => jsonResponse({ success: true, metadata: null }),
    })
  }

  async function mountDrawer() {
    localStorage.setItem('lm-ui.detail.tab', 'versions')
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(ModelDrawer, {
      global: { plugins: [router] },
      attachTo: document.body,
      props: { item, api: createModelApi('loras'), classicUrl: '/loras' },
    })
    await flushPromises()
    return wrapper
  }

  it('shows the classification chip from one read-only overview read', async () => {
    const { calls } = drawerBackend()
    const wrapper = await mountDrawer()
    const chips = wrapper.findAll('[data-testid="update-chip"]').map((c) => c.text())
    expect(chips).toEqual(['Possible update', 'Likely update'])
    expect(calls.filter((c) => c.url === '/api/lm/loras/updates/overview')).toHaveLength(1)
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
    wrapper.unmount()
  })

  it('shows no chip when the overview is not available', async () => {
    backend({
      'GET /api/lm/loras/updates/overview': () => jsonResponse({ success: false, error: 'Not Found' }, 404),
      'GET /api/lm/loras/updates/versions/4': () =>
        jsonResponse({ success: true, record: { modelId: 4, hasUpdate: true, versions: [{ versionId: 41, name: 'alt', isInLibrary: false }] } }),
      'GET /api/lm/loras/metadata': () => jsonResponse({ success: true, metadata: null }),
    })
    const wrapper = await mountDrawer()
    expect(wrapper.text()).toContain('alt')
    expect(wrapper.find('[data-testid="update-chip"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('queues a version next to the open file (same root and folder)', async () => {
    const { calls } = drawerBackend()
    const wrapper = await mountDrawer()
    const queueButtons = wrapper.findAll('#panel-versions button').filter((b) => b.text().includes('Queue') || b.text().includes('queue'))
    expect(queueButtons.length).toBeGreaterThan(0)
    await queueButtons[0].trigger('click')
    await flushPromises()
    const add = calls.find((c) => c.url.startsWith('/api/lm/downloads/queue/add'))!
    const params = new URL(add.url, 'http://x').searchParams
    expect(params.get('model_version_id')).toBe('41')
    expect(params.get('model_root')).toBe('D:\\Models\\Loras')
    expect(params.get('relative_path')).toBe('styles/ink')
    expect(params.get('use_default_paths')).toBe('false')
    expect(useToasts().toasts.value.at(-1)?.message).toBe('Added to the download queue. Saves to D:/Models/Loras/styles/ink')
    wrapper.unmount()
  })

  it('falls back to the default folder when no root contains the file', async () => {
    const { calls } = backend({
      'GET /api/lm/loras/roots': () => jsonResponse({ success: true, roots: ['E:/elsewhere'] }),
      'GET /api/lm/loras/updates/versions/4': () =>
        jsonResponse({ success: true, record: { modelId: 4, hasUpdate: true, versions: [{ versionId: 41, name: 'alt', isInLibrary: false }] } }),
      'GET /api/lm/loras/metadata': () => jsonResponse({ success: true, metadata: null }),
    })
    const wrapper = await mountDrawer()
    const queue = wrapper.findAll('#panel-versions button').find((b) => /queue/i.test(b.text()))!
    await queue.trigger('click')
    await flushPromises()
    const params = new URL(calls.find((c) => c.url.startsWith('/api/lm/downloads/queue/add'))!.url, 'http://x').searchParams
    expect(params.get('model_root')).toBeNull()
    expect(params.get('use_default_paths')).toBeNull()
    expect(useToasts().toasts.value.at(-1)?.message).toContain('default folder')
    wrapper.unmount()
  })
})
