/**
 * Updates page (phase 1): API client, pure helpers (filters, reasons,
 * destination derivation, queue state), the page against a mocked backend
 * (tiers, Update queueing, duplicates, Check now with confirm and its error
 * paths, queue states, refresh registry, empty / error states) and the
 * top-bar badge. Every backend call is mocked; only the overview, roots,
 * queue, history and settings GETs plus the explicitly triggered queue/add
 * and updates/refresh are allowed.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { setFetch } from '@/api/http'
import { updatesApi } from '@/api/endpoints'
import type { QueueItem, UpdateCandidate, UpdateGroup, UpdatesOverview } from '@/api/types'
import { setBasePathsForTesting } from '@/utils/basePath'
import {
  ageInDays,
  canQueue,
  checkedAgoText,
  currentCard,
  daysBetween,
  deriveDestination,
  filterCounts,
  groupsForFilter,
  hiddenText,
  isUpdatePrefix,
  libraryLink,
  primaryCandidate,
  queueStateFor,
  reasonText,
  UPDATE_PREFIXES,
} from '@/utils/updates'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import { runRefresh } from '@/composables/useRefresh'
import { resetUpdatesSummaryForTesting, useUpdatesSummary } from '@/composables/useUpdates'
import UpdatesPage from '@/pages/UpdatesPage.vue'
import UpdateRow from '@/components/UpdateRow.vue'
import TopBar from '@/components/TopBar.vue'
import { routes } from '@/router'
import { messages } from '@/i18n'

// --- fixtures ----------------------------------------------------------------

function cand(partial: Partial<UpdateCandidate> & { versionId: number }): UpdateCandidate {
  return {
    name: `v${partial.versionId}`,
    baseModel: 'Illustrious',
    releasedAt: '2026-11-04T00:00:00Z',
    sizeBytes: 228_000_000,
    fileCount: 1,
    usageControl: 'Download',
    isEarlyAccess: false,
    earlyAccessEndsAt: null,
    isPaid: false,
    previewUrl: 'https://image.civitai.com/x/preview.jpeg',
    hasBeenDownloaded: false,
    isIgnored: false,
    confidence: 'likely',
    reason: 'next_version_same_base',
    hiddenBecause: [],
    ...partial,
  }
}

function group(partial: Partial<UpdateGroup> & { modelId: number; candidates: UpdateCandidate[] }): UpdateGroup {
  const base = partial.baseModel ?? 'Illustrious'
  return {
    key: `${partial.modelId}:${base.toLowerCase()}`,
    modelName: `Model ${partial.modelId}`,
    baseModel: base,
    tier: 'likely',
    isIgnored: false,
    lastCheckedAt: '2026-11-13T00:00:00Z',
    ownedVersionIds: [partial.modelId * 10],
    newestOwned: { versionId: partial.modelId * 10, name: 'v1.0', releasedAt: '2026-11-01T00:00:00Z', sizeBytes: 228_000_000 },
    previewNsfwLevel: 0,
    localCards: [
      {
        filePath: `D:/Models/Loras/styles/ink/model${partial.modelId}.safetensors`,
        fileName: `model${partial.modelId}`,
        folder: 'styles/ink',
        baseModel: base,
        versionId: partial.modelId * 10,
        versionName: 'v1.0',
        releasedAt: '2026-11-01T00:00:00Z',
        sizeBytes: 228_000_000,
        previewUrl: '/api/lm/previews?path=x',
        previewNsfwLevel: 0,
      },
    ],
    ...partial,
  }
}

function overviewFixture(): UpdatesOverview {
  return {
    success: true,
    modelType: 'lora',
    settings: { hideEarlyAccessUpdates: false, hidePaidUpdates: false },
    totals: { likely: 1, possible: 1, hidden: 1, groups: 3, upToDate: 40 },
    models: { local: 50, tracked: 45, checked: 40, untracked: 5, neverChecked: 5 },
    unchecked: 10,
    oldestCheckedAt: '2026-11-13T00:00:00Z',
    newestCheckedAt: '2026-11-24T00:00:00Z',
    groups: [
      group({
        modelId: 1,
        modelName: 'Ink Style',
        tier: 'likely',
        candidates: [cand({ versionId: 11, name: 'v2.0' }), cand({ versionId: 12, name: 'v2.0 fp8', confidence: 'variant', reason: 'looks_like_format_variant' })],
      }),
      group({
        modelId: 2,
        modelName: 'Watercolor',
        tier: 'possible',
        candidates: [cand({ versionId: 21, name: 'Ink v1', confidence: 'possible', reason: 'parallel_line' })],
      }),
      group({
        modelId: 3,
        modelName: 'Big Checkpoint Remap',
        tier: 'hidden',
        candidates: [cand({ versionId: 31, name: 'v1 remapped', confidence: 'variant', reason: 'looks_like_format_variant', hiddenBecause: ['already_downloaded'] })],
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

/** A mocked backend: routes by method + path; records every call. */
function backend(overrides: Record<string, (call: Call) => Response | Promise<Response>> = {}) {
  const calls: Call[] = []
  let queue: QueueItem[] = []
  let history: QueueItem[] = []
  const state = {
    overview: overviewFixture() as UpdatesOverview,
    setQueue: (items: QueueItem[]) => (queue = items),
    setHistory: (items: QueueItem[]) => (history = items),
  }
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? 'GET', url: input, body: init?.body as string | undefined }
    calls.push(call)
    const path = input.split('?')[0]
    const key = `${call.method} ${path}`
    if (overrides[key]) return overrides[key](call)
    if (key.endsWith('/updates/overview')) return jsonResponse(state.overview)
    if (key.endsWith('/roots')) return jsonResponse({ success: true, roots: ['D:\\Models\\Loras', 'E:/More/Loras'] })
    if (key === 'GET /api/lm/downloads/queue') return jsonResponse({ success: true, queue, stats: {}, worker: null, queue_worker: true })
    if (key === 'GET /api/lm/downloads/history') return jsonResponse({ success: true, items: history, total: history.length })
    if (key === 'GET /api/lm/settings') return jsonResponse({ success: true, settings: { blur_mature_content: true, civitai_host: 'civitai.com' } })
    if (key === 'GET /api/lm/downloads/queue/add') return jsonResponse({ success: true, queued: true, duplicate: false, item: null })
    if (key.endsWith('/updates/refresh')) return jsonResponse({ success: true, records: [], events: [] })
    return jsonResponse({ success: false, error: `unexpected ${key}` }, 500)
  })
  setFetch(fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)
  return { calls, state, fetchMock }
}

async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/updates')
  await router.isReady()
  const wrapper = mount(UpdatesPage, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

const answerConfirm = async (value: boolean) => {
  const { confirmState } = useConfirm()
  expect(confirmState.value).not.toBeNull()
  confirmState.value!.resolve(value)
  await flushPromises()
}

beforeEach(() => {
  setBasePathsForTesting({ appBase: 'http://host/lm-ui/', appPath: '/lm-ui/', mountPrefix: '' })
  localStorage.clear()
  resetUpdatesSummaryForTesting()
  useToasts().toasts.value = []
})

afterEach(() => {
  setFetch(null)
  setBasePathsForTesting(null)
  document.body.innerHTML = ''
})

// --- API client ----------------------------------------------------------------

describe('updatesApi', () => {
  it('overview is a GET of /api/lm/{prefix}/updates/overview', async () => {
    const { calls } = backend()
    await updatesApi.overview('checkpoints')
    expect(calls).toEqual([{ method: 'GET', url: '/api/lm/checkpoints/updates/overview', body: undefined }])
  })

  it('refresh posts force:false and never force:true', async () => {
    const { calls } = backend()
    await updatesApi.refresh('loras')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('/api/lm/loras/updates/refresh')
    expect(JSON.parse(calls[0].body!)).toEqual({ force: false })
  })
})

// --- helpers ---------------------------------------------------------------------

describe('updates helpers', () => {
  const data = overviewFixture()

  it('lists the update-tracked types and validates stored values', () => {
    expect(UPDATE_PREFIXES).toEqual(['loras', 'checkpoints', 'embeddings'])
    expect(isUpdatePrefix('checkpoints')).toBe(true)
    expect(isUpdatePrefix('recipes')).toBe(false)
  })

  it('splits lines by tier; All shows every line', () => {
    expect(groupsForFilter(data.groups, 'likely').map((g) => g.modelId)).toEqual([1])
    expect(groupsForFilter(data.groups, 'possible').map((g) => g.modelId)).toEqual([2])
    expect(groupsForFilter(data.groups, 'all').map((g) => g.modelId)).toEqual([1, 2, 3])
    expect(filterCounts(data)).toEqual({ likely: 1, possible: 1, all: 3 })
    expect(filterCounts(null)).toEqual({ likely: 0, possible: 0, all: 0 })
  })

  it('picks the candidate a row shows per filter', () => {
    const [likely, possible, hidden] = data.groups
    expect(primaryCandidate(likely, 'likely')?.versionId).toBe(11)
    expect(primaryCandidate(likely, 'possible')).toBeNull()
    expect(primaryCandidate(possible, 'possible')?.versionId).toBe(21)
    expect(primaryCandidate(hidden, 'likely')).toBeNull()
    expect(primaryCandidate(hidden, 'all')?.versionId).toBe(31)
  })

  it('writes reason sentences from the codes, with the release gap', () => {
    const [likely, possible] = data.groups
    expect(reasonText(likely, likely.candidates[0])).toBe(
      'Newer version on the same base model (Illustrious), released 3 days after yours.',
    )
    expect(reasonText(possible, possible.candidates[0])).toBe(
      'Newer, but the name suggests a separate line of this model, released 3 days after yours.',
    )
    const sameDay = cand({ versionId: 5, releasedAt: '2026-11-01T06:00:00Z', reason: 'same_day_as_owned' })
    expect(reasonText(likely, sameDay)).toContain('released the same day as yours')
    const noDate = cand({ versionId: 6, releasedAt: null, reason: 'unknown_release_date' })
    expect(reasonText(likely, noDate)).toBe('Newer by Civitai id; the release dates are unknown.')
    const oneDay = cand({ versionId: 7, releasedAt: '2026-11-02T01:00:00Z' })
    expect(reasonText(likely, oneDay)).toContain('released 1 day after yours')
  })

  it('has a message for every backend reason and gate code', () => {
    // Mirrors REASON_CODES / HIDDEN_CODES in py/services/update_classifier.py.
    const source = readFileSync(resolve(__dirname, '../../py/services/update_classifier.py'), 'utf8')
    const constants = Object.fromEntries(
      [...source.matchAll(/^(REASON_\w+|HIDDEN_\w+) = "(\w+)"\r?$/gm)].map((match) => [match[1], match[2]]),
    )
    const listed = (name: string) =>
      (source.match(new RegExp(`${name} = \\(([^)]*)\\)`))?.[1] ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => constants[entry])
    const reasons = listed('REASON_CODES')
    const gates = listed('HIDDEN_CODES')
    expect(reasons.length).toBeGreaterThanOrEqual(12)
    expect(gates.length).toBe(7)
    const table = messages as Record<string, string>
    for (const code of reasons) expect(table[`updates.reason.${code}`], code).toBeTruthy()
    for (const code of gates) expect(table[`updates.hidden.${code}`], code).toBeTruthy()
    expect(reasons).toContain('new_label')
  })

  it('explains a new label without a version number', () => {
    const [, possible] = data.groups
    const entry = cand({ versionId: 22, name: 'More Realism', confidence: 'possible', reason: 'new_label' })
    expect(reasonText(possible, entry)).toBe(
      'Newer, but named differently from your version and without a version number: maybe another style, released 3 days after yours.',
    )
  })

  it('labels the gates that hide a candidate', () => {
    expect(hiddenText(cand({ versionId: 1 }))).toBe('')
    expect(hiddenText(cand({ versionId: 1, hiddenBecause: ['early_access', 'already_downloaded'] }))).toBe(
      'Hidden: early access (hidden by your settings), downloaded before',
    )
  })

  it('formats the check age', () => {
    const now = new Date('2026-11-25T12:00:00Z')
    expect(ageInDays('2026-11-13T00:00:00Z', now)).toBe(12)
    expect(checkedAgoText('2026-11-13T00:00:00Z', now)).toBe('Checked 12 days ago')
    expect(checkedAgoText('2026-11-24T10:00:00Z', now)).toBe('Checked 1 day ago')
    expect(checkedAgoText('2026-11-25T08:00:00Z', now)).toBe('Checked today')
    expect(checkedAgoText(null, now)).toBe('Never checked')
    expect(daysBetween('2026-11-01T00:00:00Z', '2026-11-04T00:00:00Z')).toBe(3)
    expect(daysBetween(null, '2026-11-04T00:00:00Z')).toBeNull()
  })

  describe('deriveDestination', () => {
    const card = (filePath: string) => ({ ...currentCard(data.groups[0])!, filePath })

    it('uses the root and folder of the current file (Windows paths, case-insensitive)', () => {
      const result = deriveDestination(card('d:/models/loras/styles/ink/a.safetensors'), ['D:\\Models\\Loras'])
      expect(result).toEqual({
        params: { model_root: 'D:\\Models\\Loras', relative_path: 'styles/ink', use_default_paths: 'false' },
        known: true,
        display: 'D:/Models/Loras/styles/ink',
      })
    })

    it('handles backslashes in the file path and picks the longest matching root', () => {
      const result = deriveDestination(card('D:\\Models\\Loras\\extra\\deep\\x\\a.safetensors'), [
        'D:/Models/Loras',
        'D:/Models/Loras/extra',
      ])
      expect(result.params).toEqual({ model_root: 'D:/Models/Loras/extra', relative_path: 'deep/x', use_default_paths: 'false' })
    })

    it('a file directly in the root has an empty folder', () => {
      const result = deriveDestination(card('E:/More/Loras/a.safetensors'), ['E:/More/Loras/'])
      expect(result.params).toEqual({ model_root: 'E:/More/Loras/', relative_path: '', use_default_paths: 'false' })
      expect(result.display).toBe('E:/More/Loras')
    })

    it('does not match a sibling folder that only shares a prefix', () => {
      expect(deriveDestination(card('D:/Models/LorasOld/a.safetensors'), ['D:/Models/Loras']).known).toBe(false)
    })

    it('POSIX paths stay case-sensitive', () => {
      expect(deriveDestination(card('/data/Loras/a/b.safetensors'), ['/data/loras']).known).toBe(false)
      expect(deriveDestination(card('/data/loras/a/b.safetensors'), ['/data/loras']).params.relative_path).toBe('a')
    })

    it('falls back to the default paths when the root is unknown', () => {
      expect(deriveDestination(card('F:/elsewhere/a.safetensors'), ['D:/Models/Loras'])).toEqual({
        params: {},
        known: false,
        display: '',
      })
      expect(deriveDestination(null, ['D:/x']).known).toBe(false)
      expect(deriveDestination(card('D:/Models/Loras/a.safetensors'), []).known).toBe(false)
    })
  })

  it('builds the library link with forward slashes', () => {
    expect(libraryLink('loras', 'D:\\Models\\Loras\\a.safetensors')).toEqual({
      path: '/loras',
      query: { open: 'D:/Models/Loras/a.safetensors' },
    })
  })

  it('reads the queue state of a version', () => {
    const items = [
      { download_id: 'a', model_version_id: 11, status: 'downloading', progress: 42.4 },
      { download_id: 'b', model_version_id: 12, status: 'queued' },
      { download_id: 'c', model_version_id: 13, status: 'completed' },
      { download_id: 'd', model_version_id: 14, status: 'failed', error: 'disk full' },
      { download_id: 'e', model_version_id: 15, status: 'paused' },
    ] as QueueItem[]
    expect(queueStateFor(11, items)).toEqual({ kind: 'downloading', progress: 42 })
    expect(queueStateFor(12, items)).toEqual({ kind: 'queued' })
    expect(queueStateFor(13, items)).toEqual({ kind: 'done' })
    expect(queueStateFor(14, items)).toEqual({ kind: 'failed', error: 'disk full' })
    expect(queueStateFor(15, items)).toEqual({ kind: 'paused' })
    expect(queueStateFor(99, items)).toBeNull()
    expect(canQueue(null)).toBe(true)
    expect(canQueue({ kind: 'failed', error: '' })).toBe(true)
    expect(canQueue({ kind: 'queued' })).toBe(false)
    expect(canQueue({ kind: 'done' })).toBe(false)
  })
})

// --- row -------------------------------------------------------------------------

describe('UpdateRow', () => {
  async function mountRow(props: Partial<InstanceType<typeof UpdateRow>['$props']> = {}) {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const data = overviewFixture()
    return mount(UpdateRow, {
      global: { plugins: [router] },
      props: {
        group: data.groups[0],
        candidate: data.groups[0].candidates[0],
        prefix: 'loras',
        state: null,
        queuing: false,
        destination: { params: {}, known: false, display: '' },
        moreCount: 1,
        blurMature: true,
        civitaiHost: 'civitai.com',
        ...props,
      },
    })
  }

  it('shows your version, the new version, reason, destination and labelled actions', async () => {
    const row = await mountRow({ destination: { params: {}, known: true, display: 'D:/Models/Loras/styles/ink' } })
    const text = row.text()
    expect(text).toContain('Ink Style')
    expect(text).toContain('Your version')
    expect(text).toContain('v1.0')
    expect(text).toContain('New version')
    expect(text).toContain('v2.0')
    expect(text).toContain('217.4 MB')
    expect(text).toContain('Newer version on the same base model (Illustrious)')
    expect(text).toContain('Saves to D:/Models/Loras/styles/ink')
    expect(text).toContain('+1 more newer version under All')
    expect(row.get('button').attributes('aria-label')).toBe('Update Ink Style to v2.0')
    const civitai = row.get('a[target="_blank"]')
    expect(civitai.attributes('href')).toBe('https://civitai.com/models/1?modelVersionId=11')
    expect(civitai.attributes('aria-label')).toBe('Open Ink Style on Civitai')
    expect(civitai.attributes('rel')).toContain('noopener')
    const library = row.findAll('a').find((a) => a.attributes('aria-label') === 'Open Ink Style in the library')
    expect(library?.attributes('href')).toContain('/loras?open=D:/Models/Loras/styles/ink/model1.safetensors')
  })

  it('says when the default folder is used', async () => {
    const row = await mountRow()
    expect(row.text()).toContain('Saves to the default folder')
  })

  it('shows badges with text and the hiding reason', async () => {
    const data = overviewFixture()
    const row = await mountRow({
      group: data.groups[2],
      candidate: cand({ versionId: 31, isEarlyAccess: true, isPaid: true, confidence: 'variant', hiddenBecause: ['already_downloaded'] }),
    })
    expect(row.text()).toContain('Early access')
    expect(row.text()).toContain('Paid')
    expect(row.text()).toContain('Variant')
    expect(row.text()).toContain('Hidden: downloaded before')
  })

  it('disables Update while queued or downloading and shows the state', async () => {
    const queued = await mountRow({ state: { kind: 'queued' } })
    expect(queued.text()).toContain('Queued')
    expect(queued.get('button').attributes('disabled')).toBeDefined()
    const downloading = await mountRow({ state: { kind: 'downloading', progress: 40 } })
    expect(downloading.text()).toContain('Downloading 40%')
    expect(downloading.get('button').attributes('disabled')).toBeDefined()
    const done = await mountRow({ state: { kind: 'done' } })
    expect(done.text()).toContain('In library')
    expect(done.get('button').attributes('disabled')).toBeDefined()
    const failed = await mountRow({ state: { kind: 'failed', error: 'disk full' } })
    expect(failed.text()).toContain('Download failed')
    expect(failed.get('button').attributes('disabled')).toBeUndefined()
  })

  it('blurs a mature model thumbnail when the setting is on', async () => {
    const data = overviewFixture()
    const mature = { ...data.groups[0], previewNsfwLevel: 8 }
    const row = await mountRow({ group: mature })
    expect(row.html()).toContain('blur-[12px]')
    const off = await mountRow({ group: mature, blurMature: false })
    expect(off.html()).not.toContain('blur-[12px]')
  })
})

// --- page ------------------------------------------------------------------------

describe('UpdatesPage', () => {
  let wrapper: VueWrapper | null = null
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('loads the overview with GET only and shows likely rows by default', async () => {
    const { calls } = backend()
    ;({ wrapper } = await mountPage())
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    expect(calls.some((call) => call.url === '/api/lm/loras/updates/overview')).toBe(true)
    expect(calls.some((call) => call.url === '/api/lm/loras/roots')).toBe(true)
    expect(calls.some((call) => call.url.includes('/scan'))).toBe(false)
    expect(calls.some((call) => call.url.includes('updates/refresh'))).toBe(false)
    const rows = wrapper.findAll('li h3').map((h) => h.text())
    expect(rows).toEqual(['Ink Style'])
    expect(wrapper.find('h1').text()).toBe('Updates')
    expect(wrapper.text()).toContain('Checked')
    expect(wrapper.get('[data-testid="unchecked-notice"]').text()).toContain('10 models not checked yet')
    expect(wrapper.text()).toContain('1 hidden')
  })

  it('switches tiers: Possible, All with the hiding reason, and Show all from the footer', async () => {
    backend()
    ;({ wrapper } = await mountPage())
    const filterButton = (label: string) =>
      wrapper!.findAll('[role="group"] button').find((b) => b.text().startsWith(label))!
    await filterButton('Possible').trigger('click')
    expect(wrapper.findAll('li h3').map((h) => h.text())).toEqual(['Watercolor'])
    expect(filterButton('Possible').attributes('aria-pressed')).toBe('true')
    await filterButton('Likely').trigger('click')
    const showAll = wrapper.findAll('button').find((b) => b.text() === 'Show all')!
    await showAll.trigger('click')
    expect(wrapper.findAll('li h3').map((h) => h.text())).toEqual(['Ink Style', 'Watercolor', 'Big Checkpoint Remap'])
    expect(wrapper.text()).toContain('Hidden: downloaded before')
  })

  it('remembers the model type and reloads that type', async () => {
    const { calls } = backend()
    ;({ wrapper } = await mountPage())
    const typeButton = wrapper.findAll('[role="group"] button').find((b) => b.text().startsWith('Checkpoints'))!
    await typeButton.trigger('click')
    await flushPromises()
    expect(localStorage.getItem('lm-ui.updates.type')).toBe('checkpoints')
    expect(calls.some((call) => call.url === '/api/lm/checkpoints/updates/overview')).toBe(true)
    expect(calls.some((call) => call.url === '/api/lm/checkpoints/roots')).toBe(true)
  })

  it('Update queues the version into the folder of the current file', async () => {
    const { calls } = backend()
    ;({ wrapper } = await mountPage())
    expect(wrapper.text()).toContain('Saves to D:/Models/Loras/styles/ink')
    await wrapper.get('button[aria-label="Update Ink Style to v2.0"]').trigger('click')
    await flushPromises()
    const add = calls.find((call) => call.url.startsWith('/api/lm/downloads/queue/add'))!
    expect(add.method).toBe('GET')
    const query = new URL(add.url, 'http://x').searchParams
    expect(query.get('model_id')).toBe('1')
    expect(query.get('model_version_id')).toBe('11')
    expect(query.get('source')).toBe('civitai')
    expect(query.get('model_root')).toBe('D:\\Models\\Loras')
    expect(query.get('relative_path')).toBe('styles/ink')
    expect(query.get('use_default_paths')).toBe('false')
    expect(query.get('model_name')).toBe('Ink Style')
    expect(query.get('version_name')).toBe('v2.0')
    expect(useToasts().toasts.value.at(-1)?.message).toBe('Queued Ink Style v2.0.')
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Queued Ink Style v2.0.')
  })

  it('Update falls back to the default paths when the root is unknown', async () => {
    const { calls } = backend({
      'GET /api/lm/loras/roots': () => jsonResponse({ success: true, roots: ['Z:/nothing'] }),
    })
    ;({ wrapper } = await mountPage())
    expect(wrapper.text()).toContain('Saves to the default folder')
    await wrapper.get('button[aria-label="Update Ink Style to v2.0"]').trigger('click')
    await flushPromises()
    const add = calls.find((call) => call.url.startsWith('/api/lm/downloads/queue/add'))!
    const query = new URL(add.url, 'http://x').searchParams
    expect(query.has('model_root')).toBe(false)
    expect(query.has('relative_path')).toBe(false)
    expect(query.has('use_default_paths')).toBe(false)
  })

  it('reports an already queued version', async () => {
    backend({
      'GET /api/lm/downloads/queue/add': () =>
        jsonResponse({ success: true, queued: false, duplicate: true, reason: 'already_queued', item: null }),
    })
    ;({ wrapper } = await mountPage())
    await wrapper.get('button[aria-label="Update Ink Style to v2.0"]').trigger('click')
    await flushPromises()
    expect(useToasts().toasts.value.at(-1)?.message).toBe('Ink Style v2.0 is already in the download queue.')
  })

  it('reports a queue error', async () => {
    backend({
      'GET /api/lm/downloads/queue/add': () => jsonResponse({ success: false, error: 'model_root is not a configured model root' }, 400),
    })
    ;({ wrapper } = await mountPage())
    await wrapper.get('button[aria-label="Update Ink Style to v2.0"]').trigger('click')
    await flushPromises()
    const last = useToasts().toasts.value.at(-1)
    expect(last?.kind).toBe('error')
    expect(last?.message).toContain('model_root is not a configured model root')
  })

  it('rows follow the download queue: queued disables Update', async () => {
    const { state } = backend()
    state.setQueue([{ download_id: 'q1', model_version_id: 11, status: 'queued' }] as QueueItem[])
    ;({ wrapper } = await mountPage())
    const button = wrapper.get('button[aria-label="Update Ink Style to v2.0"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Queued')
  })

  it('a queued update that finishes flips to In library and reloads the overview', async () => {
    const { calls, state } = backend()
    ;({ wrapper } = await mountPage())
    state.setQueue([{ download_id: 'q1', model_version_id: 11, status: 'queued' }] as QueueItem[])
    await wrapper.get('button[aria-label="Update Ink Style to v2.0"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Queued')
    // The worker finished it: gone from the queue, completed in the history.
    state.setQueue([])
    state.setHistory([{ download_id: 'q1', model_version_id: 11, status: 'completed' }] as QueueItem[])
    const before = calls.filter((call) => call.url === '/api/lm/loras/updates/overview').length
    const { useDownloadQueue } = await import('@/composables/useDownloadQueue')
    await useDownloadQueue().refresh()
    await flushPromises()
    expect(wrapper.text()).toContain('In library')
    expect(calls.filter((call) => call.url === '/api/lm/loras/updates/overview').length).toBe(before + 1)
  })

  it('Check now asks first; cancelling sends nothing', async () => {
    const { calls } = backend()
    ;({ wrapper } = await mountPage())
    await wrapper.findAll('button').find((b) => b.text() === 'Check now')!.trigger('click')
    expect(useConfirm().confirmState.value?.message).toContain('Civitai')
    expect(useConfirm().confirmState.value?.message).toContain('LoRAs')
    await answerConfirm(false)
    expect(calls.some((call) => call.url.includes('updates/refresh'))).toBe(false)
  })

  it('Check now posts force:false after the confirm, then reloads the overview', async () => {
    const { calls } = backend()
    ;({ wrapper } = await mountPage())
    const overviewsBefore = calls.filter((call) => call.url.endsWith('/updates/overview')).length
    await wrapper.findAll('button').find((b) => b.text() === 'Check now')!.trigger('click')
    await answerConfirm(true)
    const post = calls.find((call) => call.url.includes('updates/refresh'))!
    expect(post.method).toBe('POST')
    expect(post.url).toBe('/api/lm/loras/updates/refresh')
    expect(JSON.parse(post.body!)).toEqual({ force: false })
    expect(calls.filter((call) => call.url.endsWith('/updates/overview')).length).toBe(overviewsBefore + 1)
    expect(useToasts().toasts.value.at(-1)?.kind).toBe('success')
  })

  it('Check now: a 429 shows the rate-limit notice and rests the button', async () => {
    backend({
      'POST /api/lm/loras/updates/refresh': () => jsonResponse({ success: false, error: 'Rate limited' }, 429),
    })
    ;({ wrapper } = await mountPage())
    const checkButton = () => wrapper!.findAll('button').find((b) => b.text() === 'Check now')!
    await checkButton().trigger('click')
    await answerConfirm(true)
    expect(wrapper.text()).toContain('Civitai is limiting requests right now')
    expect(wrapper.text()).toContain('available again in a minute')
    expect(checkButton().attributes('disabled')).toBeDefined()
  })

  it('Check now: an offline backend (503) shows the connection notice', async () => {
    backend({
      'POST /api/lm/loras/updates/refresh': () => jsonResponse({ success: false, error: 'offline' }, 503),
    })
    ;({ wrapper } = await mountPage())
    await wrapper.findAll('button').find((b) => b.text() === 'Check now')!.trigger('click')
    await answerConfirm(true)
    expect(wrapper.text()).toContain('Civitai could not be reached')
  })

  it('Check now: another failure is an error toast', async () => {
    backend({
      'POST /api/lm/loras/updates/refresh': () => jsonResponse({ success: false, error: 'boom' }, 500),
    })
    ;({ wrapper } = await mountPage())
    await wrapper.findAll('button').find((b) => b.text() === 'Check now')!.trigger('click')
    await answerConfirm(true)
    const last = useToasts().toasts.value.at(-1)
    expect(last?.kind).toBe('error')
    expect(last?.message).toBe('Check failed: boom')
  })

  it('the refresh registry re-reads the overview only (GET, no scan, no Civitai)', async () => {
    const { calls } = backend()
    ;({ wrapper } = await mountPage())
    const count = calls.length
    await expect(runRefresh()).resolves.toBe(true)
    await flushPromises()
    const added = calls.slice(count)
    expect(added.some((call) => call.url === '/api/lm/loras/updates/overview')).toBe(true)
    expect(added.every((call) => call.method === 'GET')).toBe(true)
    expect(added.some((call) => call.url.includes('scan') || call.url.includes('refresh'))).toBe(false)
  })

  it('shows the empty state with Check now when nothing is found', async () => {
    const { state } = backend()
    state.overview = { ...overviewFixture(), groups: [], totals: { likely: 0, possible: 0, hidden: 0, groups: 0, upToDate: 45 }, unchecked: 0 }
    ;({ wrapper } = await mountPage())
    expect(wrapper.text()).toContain('No updates found')
    expect(wrapper.text()).toContain('Checked')
    expect(wrapper.findAll('button').filter((b) => b.text() === 'Check now').length).toBe(2)
    expect(wrapper.find('[data-testid="unchecked-notice"]').exists()).toBe(false)
  })

  it('a type that was never checked is "Not checked yet", not "No updates found"', async () => {
    const { state } = backend()
    state.overview = {
      ...overviewFixture(),
      groups: [],
      totals: { likely: 0, possible: 0, hidden: 0, groups: 0, upToDate: 47 },
      unchecked: 47,
      oldestCheckedAt: null,
      newestCheckedAt: null,
    }
    ;({ wrapper } = await mountPage())
    expect(wrapper.text()).toContain('Not checked yet')
    expect(wrapper.text()).not.toContain('No updates found')
    expect(wrapper.text()).toContain('Never checked')
    expect(wrapper.get('[data-testid="unchecked-notice"]').text()).toContain('47 models not checked yet')
  })

  it('points to the possible updates when there is no likely one', async () => {
    const { state } = backend()
    const data = overviewFixture()
    state.overview = { ...data, groups: data.groups.slice(1), totals: { ...data.totals, likely: 0 } }
    ;({ wrapper } = await mountPage())
    expect(wrapper.text()).toContain('No likely updates. 1 possible update to review.')
    await wrapper.findAll('button').find((b) => b.text() === 'Show possible')!.trigger('click')
    expect(wrapper.findAll('li h3').map((h) => h.text())).toEqual(['Watercolor'])
  })

  it('shows an error with Retry, and a hint for a backend without the endpoint', async () => {
    let fail = true
    backend({
      'GET /api/lm/loras/updates/overview': () =>
        fail ? new Response('Not Found', { status: 404 }) : jsonResponse(overviewFixture()),
    })
    ;({ wrapper } = await mountPage())
    expect(wrapper.text()).toContain('Could not load the updates')
    expect(wrapper.text()).toContain('Restart ComfyUI')
    fail = false
    await wrapper.findAll('button').find((b) => b.text().includes('Retry'))!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('li h3').map((h) => h.text())).toEqual(['Ink Style'])
  })
})

// --- top bar and likely counts ------------------------------------------------

/** A backend whose overview per type reports the given likely count. */
function countsBackend(likely: Partial<Record<'loras' | 'checkpoints' | 'embeddings', number>>) {
  const overrides: Record<string, () => Response> = {}
  for (const [prefix, count] of Object.entries(likely)) {
    overrides[`GET /api/lm/${prefix}/updates/overview`] = () =>
      jsonResponse({ ...overviewFixture(), totals: { ...overviewFixture().totals, likely: count } })
  }
  return backend(overrides)
}

const overviewCalls = (calls: Call[]) => calls.filter((call) => call.url.endsWith('/updates/overview'))

async function mountTopBar(path = '/loras') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  return mount(TopBar, { global: { plugins: [router] } })
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('top bar Updates link', () => {
  afterEach(() => {
    vi.useRealTimers()
    setVisibility('visible')
  })

  it('links to /updates; the badge sums the types and names the split (GET only, lazily)', async () => {
    vi.useFakeTimers()
    const { calls } = countsBackend({ loras: 3, checkpoints: 1, embeddings: 0 })
    const bar = await mountTopBar()
    await flushPromises()
    expect(overviewCalls(calls)).toEqual([])
    await vi.advanceTimersByTimeAsync(1600)
    await flushPromises()
    expect(overviewCalls(calls).map((call) => call.url)).toEqual([
      '/api/lm/loras/updates/overview',
      '/api/lm/checkpoints/updates/overview',
      '/api/lm/embeddings/updates/overview',
    ])
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    const link = bar.get('[data-testid="topbar-updates"]')
    expect(link.attributes('href')).toBe('/updates')
    expect(link.attributes('aria-label')).toBe('Updates: 4 likely updates (LoRAs 3, Checkpoints 1)')
    expect(link.attributes('title')).toBe(link.attributes('aria-label'))
    expect(link.text()).toContain('4')
    bar.unmount()
  })

  it('uses the singular for one update', async () => {
    countsBackend({ loras: 0, checkpoints: 1, embeddings: 0 })
    await useUpdatesSummary().refreshLikelyCounts()
    const bar = await mountTopBar()
    expect(bar.get('[data-testid="topbar-updates"]').attributes('aria-label')).toBe(
      'Updates: 1 likely update (Checkpoints 1)',
    )
    bar.unmount()
  })

  it('stays quiet when the backend has no overview endpoint', async () => {
    backend({
      'GET /api/lm/loras/updates/overview': () => new Response('Not Found', { status: 404 }),
      'GET /api/lm/checkpoints/updates/overview': () => new Response('Not Found', { status: 404 }),
      'GET /api/lm/embeddings/updates/overview': () => new Response('Not Found', { status: 404 }),
    })
    await useUpdatesSummary().refreshLikelyCounts()
    expect(useUpdatesSummary().total.value).toBe(0)
    expect(useToasts().toasts.value).toEqual([])
    const bar = await mountTopBar()
    expect(bar.get('[data-testid="topbar-updates"]').attributes('aria-label')).toBe('Updates')
    bar.unmount()
  })

  it('never reads twice while a read is running, and skips fresh counts', async () => {
    const { calls } = countsBackend({ loras: 2 })
    const summary = useUpdatesSummary()
    const first = summary.refreshLikelyCounts()
    const second = summary.refreshLikelyCounts()
    expect(second).toBe(first)
    await first
    expect(overviewCalls(calls)).toHaveLength(3)
    await summary.refreshLikelyCounts()
    expect(overviewCalls(calls)).toHaveLength(3)
    await summary.refreshLikelyCounts({ force: true })
    expect(overviewCalls(calls)).toHaveLength(6)
  })

  it('re-reads stale counts after a minute', async () => {
    vi.useFakeTimers()
    const { calls } = countsBackend({ loras: 2 })
    const summary = useUpdatesSummary()
    await summary.refreshLikelyCounts()
    vi.advanceTimersByTime(30_000)
    await summary.refreshLikelyCounts()
    expect(overviewCalls(calls)).toHaveLength(3)
    vi.advanceTimersByTime(31_000)
    await summary.refreshLikelyCounts()
    expect(overviewCalls(calls)).toHaveLength(6)
  })

  it('re-reads when the tab becomes visible again, at most every 5 minutes', async () => {
    vi.useFakeTimers()
    const { calls } = countsBackend({ loras: 1 })
    const bar = await mountTopBar()
    await vi.advanceTimersByTimeAsync(1600)
    await flushPromises()
    expect(overviewCalls(calls)).toHaveLength(3)
    // Back after a minute: within the throttle, nothing.
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(60_000)
    setVisibility('visible')
    await flushPromises()
    expect(overviewCalls(calls)).toHaveLength(3)
    // Back after more than 5 minutes: one re-read of every type.
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    setVisibility('visible')
    await flushPromises()
    expect(overviewCalls(calls)).toHaveLength(6)
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    bar.unmount()
  })
})

describe('likely counts on the Updates page', () => {
  let wrapper: VueWrapper | null = null
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  const typeButton = (prefix: string) => wrapper!.get(`[data-testid="updates-type-${prefix}"]`)

  it("the type buttons show each type's likely count once known", async () => {
    const { calls } = countsBackend({ loras: 3, checkpoints: 1, embeddings: 0 })
    ;({ wrapper } = await mountPage())
    await flushPromises()
    expect(typeButton('loras').text()).toBe('LoRAs 3, 3 likely updates')
    expect(typeButton('loras').attributes('title')).toBe('3 likely updates')
    expect(typeButton('checkpoints').text()).toBe('Checkpoints 1, 1 likely update')
    expect(typeButton('embeddings').text()).toBe('Embeddings 0, 0 likely updates')
    // The page read its own type; the summary only added the others.
    expect(overviewCalls(calls).map((call) => call.url)).toEqual([
      '/api/lm/loras/updates/overview',
      '/api/lm/checkpoints/updates/overview',
      '/api/lm/embeddings/updates/overview',
    ])
    expect(useUpdatesSummary().total.value).toBe(4)
  })

  it('an unknown count shows no number', async () => {
    backend({
      'GET /api/lm/checkpoints/updates/overview': () => new Response('Not Found', { status: 404 }),
    })
    ;({ wrapper } = await mountPage())
    await flushPromises()
    expect(typeButton('checkpoints').text()).toBe('Checkpoints')
    expect(typeButton('checkpoints').attributes('title')).toBeUndefined()
  })

  it('Check now updates the count of the checked type and re-reads stale types', async () => {
    vi.useFakeTimers()
    const { calls, state } = countsBackend({ checkpoints: 1, embeddings: 0 })
    ;({ wrapper } = await mountPage())
    await flushPromises()
    expect(useUpdatesSummary().total.value).toBe(2)
    vi.advanceTimersByTime(61_000)
    state.overview = { ...overviewFixture(), totals: { ...overviewFixture().totals, likely: 5 } }
    const before = overviewCalls(calls).length
    await wrapper.findAll('button').find((b) => b.text() === 'Check now')!.trigger('click')
    await answerConfirm(true)
    await flushPromises()
    expect(useUpdatesSummary().total.value).toBe(6)
    expect(overviewCalls(calls).slice(before).map((call) => call.url)).toEqual([
      '/api/lm/loras/updates/overview',
      '/api/lm/checkpoints/updates/overview',
      '/api/lm/embeddings/updates/overview',
    ])
  })

  it('a finished queued update refreshes the counts', async () => {
    const { state } = backend()
    ;({ wrapper } = await mountPage())
    await flushPromises()
    expect(useUpdatesSummary().byPrefix.loras).toBe(1)
    state.setQueue([{ download_id: 'q1', model_version_id: 11, status: 'queued' }] as QueueItem[])
    await wrapper.get('button[aria-label="Update Ink Style to v2.0"]').trigger('click')
    await flushPromises()
    state.setQueue([])
    state.setHistory([{ download_id: 'q1', model_version_id: 11, status: 'completed' }] as QueueItem[])
    state.overview = { ...overviewFixture(), totals: { ...overviewFixture().totals, likely: 0 } }
    const { useDownloadQueue } = await import('@/composables/useDownloadQueue')
    await useDownloadQueue().refresh()
    await flushPromises()
    expect(useUpdatesSummary().byPrefix.loras).toBe(0)
    expect(typeButton('loras').text()).toBe('LoRAs 0, 0 likely updates')
  })
})
