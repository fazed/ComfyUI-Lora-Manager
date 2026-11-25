/**
 * Version management: delete a specific version (drawer Versions tab and its
 * delete flow), the replace-or-keep prompt (single Update, bulk confirm,
 * drawer queue), the replace state of queue rows and the "Old versions" view.
 * Every backend call is mocked; nothing here can reach a real backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { setFetch } from '@/api/http'
import { createModelApi, downloadsApi } from '@/api/endpoints'
import type { ModelItem, ModelUpdateRecord, ModelVersionInfo, OldVersionsResponse, QueueItem, UpdateCandidate, UpdateGroup, UpdatesOverview } from '@/api/types'
import { setBasePathsForTesting } from '@/utils/basePath'
import {
  canRestore,
  defaultReplaceSelection,
  isOwnedVersion,
  isVersionDownloading,
  ownedFilesForGroup,
  ownedFilesForVersion,
  queueErrorText,
  replaceInfoOf,
  replaceLines,
} from '@/utils/versionManagement'
import { ApiError } from '@/api/http'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import { useModelActions } from '@/composables/useModelActions'
import { ALWAYS_KEEP_KEY, resetReplaceChoiceForTesting, useReplaceChoice } from '@/composables/useReplaceChoice'
import { resetUpdatesSummaryForTesting } from '@/composables/useUpdates'
import ReplaceChoiceDialog from '@/components/ReplaceChoiceDialog.vue'
import ReplaceNote from '@/components/ReplaceNote.vue'
import ModelDrawer from '@/components/ModelDrawer.vue'
import OldVersionsView from '@/components/OldVersionsView.vue'
import UpdatesPage from '@/pages/UpdatesPage.vue'
import { routes } from '@/router'
import { installDialogStub } from './dialogStub'

installDialogStub()

// --- fixtures -----------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface Call {
  method: string
  url: string
  body?: string
}

type Handler = (call: Call) => Response | Promise<Response>

function backend(handlers: Record<string, Handler> = {}) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? 'GET', url: input, body: init?.body as string | undefined }
    calls.push(call)
    const key = `${call.method} ${input.split('?')[0]}`
    if (handlers[key]) return handlers[key](call)
    if (key.endsWith('/roots')) return jsonResponse({ success: true, roots: ['D:/Models/Loras'] })
    if (key === 'GET /api/lm/downloads/queue') return jsonResponse({ success: true, queue: [], stats: {}, queue_worker: true })
    if (key === 'GET /api/lm/downloads/history') return jsonResponse({ success: true, items: [], total: 0 })
    if (key === 'GET /api/lm/settings') return jsonResponse({ success: true, settings: {} })
    if (key === 'GET /api/lm/downloads/queue/add') return jsonResponse({ success: true, queued: true, duplicate: false, item: null, replace_attached: true })
    if (key.endsWith('/metadata')) return jsonResponse({ success: true, metadata: null })
    return jsonResponse({ success: false, error: `unexpected ${key}` }, 500)
  })
  setFetch(fetchMock as unknown as (input: string, init?: RequestInit) => Promise<Response>)
  return { calls }
}

const paramsOf = (call: Call) => new URL(call.url, 'http://x').searchParams
const addCalls = (calls: Call[]) => calls.filter((c) => c.url.startsWith('/api/lm/downloads/queue/add'))
const mutating = (calls: Call[]) => calls.filter((c) => c.method !== 'GET' || /queue\/add/.test(c.url))

function cand(versionId: number, name = `v${versionId}`): UpdateCandidate {
  return {
    versionId,
    name,
    baseModel: 'Anima',
    releasedAt: '2026-11-04T00:00:00Z',
    sizeBytes: 100,
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
  }
}

function card(versionId: number, file: string, releasedAt: string, versionName = `v${versionId}`) {
  return {
    filePath: `D:/Models/Loras/chars/${file}.safetensors`,
    fileName: file,
    folder: 'chars',
    baseModel: 'Anima',
    versionId,
    versionName,
    releasedAt,
    sizeBytes: 1024 * 1024,
    previewUrl: null,
    previewNsfwLevel: 0,
  }
}

/** Eldreda: owns v1.0 Anima as two cards (v1 and its variant) and v1.5; v2.0 is offered. */
function eldredaGroup(): UpdateGroup {
  return {
    key: '7000:anima',
    modelId: 7000,
    modelName: 'Eldreda',
    baseModel: 'Anima',
    tier: 'likely',
    isIgnored: false,
    lastCheckedAt: '2026-11-13T00:00:00Z',
    ownedVersionIds: [7001, 7015],
    newestOwned: { versionId: 7015, name: 'v1.5', releasedAt: '2026-10-01T00:00:00Z', sizeBytes: 1 },
    previewNsfwLevel: 0,
    localCards: [
      card(7001, 'eldreda_v1', '2026-01-01T00:00:00Z', 'v1.0'),
      card(7001, 'eldreda_v1_fp8', '2026-01-01T00:00:00Z', 'v1.0'),
      card(7015, 'eldreda_v15', '2026-10-01T00:00:00Z', 'v1.5'),
    ],
    candidates: [cand(7002, 'v2.0')],
  }
}

function overview(groups: UpdateGroup[]): UpdatesOverview {
  return {
    success: true,
    modelType: 'lora',
    settings: { hideEarlyAccessUpdates: false, hidePaidUpdates: false },
    totals: { likely: groups.length, possible: 0, hidden: 0, groups: groups.length, upToDate: 0 },
    models: { local: 1, tracked: 1, checked: 1, untracked: 0, neverChecked: 0 },
    unchecked: 0,
    oldestCheckedAt: '2026-11-13T00:00:00Z',
    newestCheckedAt: '2026-11-13T00:00:00Z',
    groups,
  }
}

const confirmState = () => useConfirm().confirmState

beforeEach(() => {
  setBasePathsForTesting({ appBase: 'http://host/lm-ui/', appPath: '/lm-ui/', mountPrefix: '' })
  localStorage.clear()
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

// --- pure helpers ---------------------------------------------------------------

describe('version management helpers', () => {
  it('lists the owned files of a line without the version being downloaded, newest first', () => {
    const files = ownedFilesForGroup(eldredaGroup(), cand(7002))
    expect(files.map((f) => f.fileName)).toEqual(['eldreda_v15.safetensors', 'eldreda_v1.safetensors', 'eldreda_v1_fp8.safetensors'])
    expect(ownedFilesForGroup(eldredaGroup(), cand(7015)).map((f) => f.versionId)).toEqual([7001, 7001])
  })

  it('preselects only the newest owned file', () => {
    const files = ownedFilesForGroup(eldredaGroup(), cand(7002))
    expect(defaultReplaceSelection(files)).toEqual(['D:/Models/Loras/chars/eldreda_v15.safetensors'])
    expect(defaultReplaceSelection([])).toEqual([])
  })

  it('reads ownership from localFiles when the backend sends them, else from the flag', () => {
    expect(isOwnedVersion({ versionId: 1, name: 'a', isInLibrary: false, localFiles: [{ filePath: 'x', fileName: 'x', folder: '' }] })).toBe(true)
    expect(isOwnedVersion({ versionId: 1, name: 'a', isInLibrary: true, localFiles: [] })).toBe(false)
    expect(isOwnedVersion({ versionId: 1, name: 'a', isInLibrary: true })).toBe(true)
  })

  it('offers only owned files on the same base for a drawer replace', () => {
    const record: ModelUpdateRecord = {
      modelId: 7000,
      hasUpdate: false,
      versions: [
        { versionId: 7001, name: 'v1.0 Anima', baseModel: 'Anima', releasedAt: '2026-01-01', localFiles: [{ filePath: 'D:/a/v1.safetensors', fileName: 'v1', folder: 'a' }] },
        { versionId: 7003, name: 'v1.0 Illustrious', baseModel: 'Illustrious', localFiles: [{ filePath: 'D:/a/il.safetensors', fileName: 'il', folder: 'a' }] },
        { versionId: 7002, name: 'v2.0 Anima', baseModel: 'Anima', localFiles: [] },
      ],
    }
    const files = ownedFilesForVersion(record, record.versions[2])
    expect(files.map((f) => f.filePath)).toEqual(['D:/a/v1.safetensors'])
  })

  it('knows a version that is being downloaded', () => {
    const queue = [{ download_id: 'a', model_version_id: 5, status: 'downloading' }] as QueueItem[]
    expect(isVersionDownloading(5, queue)).toBe(true)
    expect(isVersionDownloading(6, queue)).toBe(false)
  })

  it('parses replace targets defensively', () => {
    expect(replaceInfoOf(null)).toBeNull()
    expect(replaceInfoOf({ replace_targets: 'not json', replace_status: 'pending' })).toBeNull()
    expect(replaceInfoOf({ replace_targets: '[{"nopath":1}]', replace_status: 'pending' })).toBeNull()
    const info = replaceInfoOf({
      replace_targets: JSON.stringify([{ path: 'D:/x/old.safetensors', status: 'replaced', batch_id: 'b1', undo_until: 2000 }]),
      replace_status: 'done',
    })!
    expect(info.phase).toBe('done')
    expect(info.targets[0]).toMatchObject({ fileName: 'old.safetensors', status: 'replaced', batchId: 'b1', undoUntil: 2000 })
    expect(canRestore(info.targets[0], 1000)).toBe(true)
    expect(canRestore(info.targets[0], 1999)).toBe(false)
  })

  it('describes every replace phase and outcome', () => {
    const item = (status: string | null, targets: object[], phase = 'done') => ({
      replace_targets: JSON.stringify(targets),
      replace_status: phase,
      status,
    })
    const one = (status: string | null, target: object, phase = 'done') =>
      replaceLines(replaceInfoOf(item(status, [{ path: 'D:/x/old.safetensors', ...target }], phase)), status, 1000)[0].text
    expect(one('queued', {}, 'pending')).toBe('Will replace old.safetensors when finished')
    expect(one('completed', { status: 'replaced', batch_id: 'b', undo_until: 9999 })).toBe(
      'Replaced old.safetensors; the old file was moved to the pending-delete folder',
    )
    expect(one('completed', { status: 'kept', note: 'new_file_not_verified' })).toBe(
      'Kept old.safetensors: could not replace (the new file could not be verified in the library)',
    )
    expect(one('completed', { status: 'kept', note: 'delete_failed: disk' })).toBe('Kept old.safetensors: could not replace (see the server log)')
    expect(one('completed', { status: 'already_gone' })).toBe('old.safetensors was already gone')
    expect(one('completed', { status: 'kept', note: 'interrupted' }, 'interrupted')).toBe(
      'Kept old.safetensors: the replace was interrupted by a restart',
    )
    expect(one('failed', {}, 'pending')).toBe('Not replaced: the download did not complete; old.safetensors was kept (Retry keeps the replace request)')
  })

  it('maps queue/add replace codes to a readable text', () => {
    const error = new ApiError('raw', 400, { success: false, error: 'raw', code: 'replace_model_mismatch' })
    expect(queueErrorText(error)).toBe('Only another version of the same model can be replaced.')
    expect(queueErrorText(new ApiError('plain', 500, {}))).toBe('plain')
  })
})

describe('queue/add payload', () => {
  it('sends every old file as a repeated replace_file_path, and nothing for Keep', async () => {
    const { calls } = backend()
    await downloadsApi.add({ modelId: 1, versionId: 2, replaceFilePaths: ['D:/a/one.safetensors', 'D:/a/two.safetensors'] })
    await downloadsApi.add({ modelId: 1, versionId: 3 })
    expect(paramsOf(calls[0]).getAll('replace_file_path')).toEqual(['D:/a/one.safetensors', 'D:/a/two.safetensors'])
    expect(paramsOf(calls[1]).getAll('replace_file_path')).toEqual([])
  })
})

// --- the prompt ---------------------------------------------------------------------

describe('replace-or-keep prompt', () => {
  it('does not ask without owned files and answers Keep', async () => {
    expect(await useReplaceChoice().ask({ modelName: 'M', versionName: 'v2', files: [] })).toEqual({ mode: 'keep' })
  })

  it('remembers only Keep both, never Replace, and can be reset', async () => {
    const choice = useReplaceChoice()
    const files = ownedFilesForGroup(eldredaGroup(), cand(7002))
    let pending = choice.ask({ modelName: 'M', versionName: 'v2', files })
    choice.answer({ mode: 'replace', paths: [files[0].filePath] }, true)
    expect(await pending).toEqual({ mode: 'replace', paths: [files[0].filePath] })
    expect(choice.alwaysKeep.value).toBe(false)

    pending = choice.ask({ modelName: 'M', versionName: 'v2', files })
    choice.answer({ mode: 'keep' }, true)
    expect(await pending).toEqual({ mode: 'keep' })
    expect(choice.alwaysKeep.value).toBe(true)
    expect(localStorage.getItem(ALWAYS_KEEP_KEY)).toBe('true')
    // Remembered: no dialog, Keep at once.
    expect(await choice.ask({ modelName: 'M', versionName: 'v2', files })).toEqual({ mode: 'keep' })
    expect(choice.pending.value).toBeNull()
    choice.resetAlwaysKeep()
    expect(choice.alwaysKeep.value).toBe(false)
  })

  it('names the single owned file, its size and that replacing deletes it after verification', async () => {
    const wrapper = mount(ReplaceChoiceDialog, { attachTo: document.body })
    const files = ownedFilesForGroup(eldredaGroup(), cand(7002)).slice(0, 1)
    const pending = useReplaceChoice().ask({ modelName: 'Eldreda', versionName: 'v2.0', files })
    await flushPromises()
    const text = document.querySelector('[data-testid="replace-dialog"]')!.textContent!
    expect(document.getElementById('replace-choice-title')!.textContent).toBe('Update Eldreda to v2.0?')
    expect(text).toContain('You already have v1.5 (eldreda_v15.safetensors, 1.0 MB).')
    expect(text).toContain('Only after the download has completed and is verified')
    expect(text).toContain('pending-delete folder')
    ;(document.querySelector('[data-testid="replace-confirm"]') as HTMLButtonElement).click()
    expect(await pending).toEqual({ mode: 'replace', paths: ['D:/Models/Loras/chars/eldreda_v15.safetensors'] })
    wrapper.unmount()
  })

  it('lists several owned files with only the newest ticked; nothing ticked disables Replace', async () => {
    const wrapper = mount(ReplaceChoiceDialog, { attachTo: document.body })
    const files = ownedFilesForGroup(eldredaGroup(), cand(7002))
    const pending = useReplaceChoice().ask({ modelName: 'Eldreda', versionName: 'v2.0', files })
    await flushPromises()
    const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-testid="replace-dialog"] fieldset input[type="checkbox"]')]
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false])
    boxes[0].click()
    await flushPromises()
    expect((document.querySelector('[data-testid="replace-confirm"]') as HTMLButtonElement).disabled).toBe(true)
    boxes[1].click()
    boxes[2].click()
    await flushPromises()
    expect(document.querySelector('[data-testid="replace-confirm"]')!.textContent!.trim()).toBe('Replace 2 files')
    ;(document.querySelector('[data-testid="replace-confirm"]') as HTMLButtonElement).click()
    expect(await pending).toEqual({
      mode: 'replace',
      paths: ['D:/Models/Loras/chars/eldreda_v1.safetensors', 'D:/Models/Loras/chars/eldreda_v1_fp8.safetensors'],
    })
    wrapper.unmount()
  })

  it('Cancel answers null; Keep with "don\'t ask again" is remembered', async () => {
    const wrapper = mount(ReplaceChoiceDialog, { attachTo: document.body })
    const files = ownedFilesForGroup(eldredaGroup(), cand(7002))
    let pending = useReplaceChoice().ask({ modelName: 'E', versionName: 'v2', files })
    await flushPromises()
    ;(document.querySelector('[data-testid="replace-cancel"]') as HTMLButtonElement).click()
    expect(await pending).toBeNull()

    pending = useReplaceChoice().ask({ modelName: 'E', versionName: 'v2', files })
    await flushPromises()
    ;(document.querySelector('[data-testid="replace-remember"]') as HTMLInputElement).click()
    await flushPromises()
    ;(document.querySelector('[data-testid="replace-keep"]') as HTMLButtonElement).click()
    expect(await pending).toEqual({ mode: 'keep' })
    expect(localStorage.getItem(ALWAYS_KEEP_KEY)).toBe('true')
    wrapper.unmount()
  })
})

// --- Updates page: single Update and bulk -----------------------------------------------

async function mountUpdates(groups: UpdateGroup[], handlers: Record<string, Handler> = {}) {
  const env = backend({ 'GET /api/lm/loras/updates/overview': () => jsonResponse(overview(groups)), ...handlers })
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/updates')
  await router.isReady()
  const wrapper = mount({ components: { UpdatesPage, ReplaceChoiceDialog }, template: '<UpdatesPage /><ReplaceChoiceDialog />' }, {
    global: { plugins: [router] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, ...env }
}

const clickText = async (wrapper: VueWrapper, label: string) => {
  await wrapper.findAll('button').find((b) => b.text().trim() === label)!.trigger('click')
  await flushPromises()
}
const clickTestId = async (id: string) => {
  ;(document.querySelector(`[data-testid="${id}"]`) as HTMLElement).click()
  await flushPromises()
}

describe('Update on the Updates page asks replace or keep', () => {
  it('Replace sends the exact old path; Keep sends none; Cancel sends nothing', async () => {
    const { wrapper, calls } = await mountUpdates([eldredaGroup()])
    await clickText(wrapper, 'Update')
    expect(document.querySelector('[data-testid="replace-dialog"]')).not.toBeNull()
    expect(addCalls(calls)).toHaveLength(0)
    await clickTestId('replace-confirm')
    expect(paramsOf(addCalls(calls)[0]).getAll('replace_file_path')).toEqual(['D:/Models/Loras/chars/eldreda_v15.safetensors'])
    expect(useToasts().toasts.value.at(-1)?.message).toBe(
      'Queued Eldreda v2.0; it will replace eldreda_v15.safetensors when finished.',
    )
    wrapper.unmount()
  })

  it('Keep both queues without a replace and Cancel queues nothing', async () => {
    const { wrapper, calls } = await mountUpdates([eldredaGroup()])
    await clickText(wrapper, 'Update')
    await clickTestId('replace-cancel')
    expect(addCalls(calls)).toHaveLength(0)
    await clickText(wrapper, 'Update')
    await clickTestId('replace-keep')
    expect(addCalls(calls)).toHaveLength(1)
    expect(paramsOf(addCalls(calls)[0]).getAll('replace_file_path')).toEqual([])
    wrapper.unmount()
  })

  it('shows the backend refusal of a replace as a readable error', async () => {
    const { wrapper } = await mountUpdates([eldredaGroup()], {
      'GET /api/lm/downloads/queue/add': () =>
        jsonResponse({ success: false, error: 'raw', code: 'replace_not_in_library' }, 400),
    })
    await clickText(wrapper, 'Update')
    await clickTestId('replace-confirm')
    expect(useToasts().toasts.value.at(-1)?.message).toContain('The file to replace is no longer in the library.')
    wrapper.unmount()
  })

  it('a remembered "keep both" skips the prompt and the page offers to ask again', async () => {
    localStorage.setItem(ALWAYS_KEEP_KEY, 'true')
    resetReplaceChoiceForTesting()
    const { wrapper, calls } = await mountUpdates([eldredaGroup()])
    expect(wrapper.find('[data-testid="always-keep-notice"]').exists()).toBe(true)
    await clickText(wrapper, 'Update')
    expect(document.querySelector('[data-testid="replace-dialog"]')).toBeNull()
    expect(paramsOf(addCalls(calls)[0]).getAll('replace_file_path')).toEqual([])
    await clickText(wrapper, 'Ask again')
    expect(wrapper.find('[data-testid="always-keep-notice"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows "Will replace" on the row while the update is queued', async () => {
    const queued: QueueItem = {
      download_id: 'q1',
      model_version_id: 7002,
      status: 'queued',
      replace_targets: JSON.stringify([{ path: 'D:/Models/Loras/chars/eldreda_v15.safetensors', file_name: 'eldreda_v15.safetensors' }]),
      replace_status: 'pending',
    }
    const { wrapper } = await mountUpdates([eldredaGroup()], {
      'GET /api/lm/downloads/queue': () => jsonResponse({ success: true, queue: [queued], stats: {}, queue_worker: true }),
    })
    expect(wrapper.get('[data-testid="replace-note"]').text()).toContain('Will replace eldreda_v15.safetensors when finished')
    wrapper.unmount()
  })
})

describe('bulk update: one summary with Keep / Replace per row', () => {
  function ink(): UpdateGroup {
    return {
      ...eldredaGroup(),
      key: '8000:anima',
      modelId: 8000,
      modelName: 'Ink',
      localCards: [card(8001, 'ink_v1', '2026-01-01T00:00:00Z')],
      candidates: [cand(8002, 'v2')],
    }
  }

  async function openBulk() {
    const env = await mountUpdates([eldredaGroup(), ink()])
    await clickText(env.wrapper, 'Select all visible')
    await env.wrapper.get('[data-testid="bulk-update"]').trigger('click')
    await flushPromises()
    return env
  }

  it('defaults every row to Keep and sends no replace', async () => {
    const { wrapper, calls } = await openBulk()
    const selects = [...document.querySelectorAll<HTMLSelectElement>('[data-testid="bulk-confirm"] select')]
    expect(selects.map((s) => s.value)).toEqual(['keep', 'keep'])
    expect(document.querySelector('[data-testid="bulk-confirm-message"]')!.textContent).toContain('Nothing is deleted')
    await clickTestId('bulk-confirm-submit')
    expect(addCalls(calls).map((c) => paramsOf(c).getAll('replace_file_path'))).toEqual([[], []])
    wrapper.unmount()
  })

  it('replaces only the rows set to Replace, with the newest owned file of each line', async () => {
    const { wrapper, calls } = await openBulk()
    const select = document.querySelector<HTMLSelectElement>('[data-testid="bulk-row-8000:anima"]')!
    select.value = 'replace'
    select.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(document.querySelector('[data-testid="bulk-confirm-message"]')!.textContent).toContain(
      '1 old file will be replaced after the downloads are verified.',
    )
    await clickTestId('bulk-confirm-submit')
    const sent = Object.fromEntries(addCalls(calls).map((c) => [paramsOf(c).get('model_version_id'), paramsOf(c).getAll('replace_file_path')]))
    expect(sent).toEqual({ '7002': [], '8002': ['D:/Models/Loras/chars/ink_v1.safetensors'] })
    wrapper.unmount()
  })

  it('Replace all / Keep all switch every row', async () => {
    const { wrapper, calls } = await openBulk()
    await clickTestId('bulk-replace-all')
    let selects = [...document.querySelectorAll<HTMLSelectElement>('[data-testid="bulk-confirm"] select')]
    expect(selects.map((s) => s.value)).toEqual(['replace', 'replace'])
    await clickTestId('bulk-keep-all')
    selects = [...document.querySelectorAll<HTMLSelectElement>('[data-testid="bulk-confirm"] select')]
    expect(selects.map((s) => s.value)).toEqual(['keep', 'keep'])
    await clickTestId('bulk-replace-all')
    await clickTestId('bulk-confirm-submit')
    expect(addCalls(calls).map((c) => paramsOf(c).getAll('replace_file_path'))).toEqual([
      ['D:/Models/Loras/chars/eldreda_v15.safetensors'],
      ['D:/Models/Loras/chars/ink_v1.safetensors'],
    ])
    wrapper.unmount()
  })
})

// --- drawer Versions tab ----------------------------------------------------------------

describe('drawer Versions tab: local files and delete', () => {
  const item = {
    file_path: 'D:/Models/Loras/chars/eldreda_v1_anima.safetensors',
    file_name: 'eldreda_v1_anima',
    model_name: 'Eldreda',
    folder: 'chars',
    base_model: 'Anima',
    from_civitai: true,
    tags: [],
    civitai: { modelId: 7000, id: 7001 },
  } as unknown as ModelItem

  const file = (name: string, base = 'Anima', size = 2 * 1024 * 1024) => ({
    filePath: `D:/Models/Loras/chars/${name}.safetensors`,
    fileName: name,
    folder: 'chars',
    baseModel: base,
    sizeBytes: size,
  })

  /** The user's case: v1.0 Anima (current), v2.0 Anima (stale flag false), v1.0 Illustrious; two remapped not owned. */
  const versions: ModelVersionInfo[] = [
    { versionId: 7001, name: 'v1.0 Anima', baseModel: 'Anima', isInLibrary: true, localFiles: [file('eldreda_v1_anima')] },
    { versionId: 7002, name: 'v2.0 Anima', baseModel: 'Anima', isInLibrary: false, releasedAt: '2026-06-01', localFiles: [file('eldreda_v2_anima')] },
    {
      versionId: 7003,
      name: 'v1.0 Illustrious',
      baseModel: 'Illustrious',
      isInLibrary: true,
      localFiles: [file('eldreda_il', 'Illustrious'), file('eldreda_il_fp8', 'Illustrious')],
    },
    { versionId: 7005, name: 'v2.0 Remapped Anima 2.9B', baseModel: 'Anima 2.9B', isInLibrary: false, localFiles: [] },
    { versionId: 7004, name: 'v1.0 Remapped Anima 2.9B', baseModel: 'Anima 2.9B', isInLibrary: false, localFiles: [] },
  ]

  async function mountDrawer(queue: QueueItem[] = []) {
    const env = backend({
      'GET /api/lm/loras/updates/versions/7000': () => jsonResponse({ success: true, record: { modelId: 7000, hasUpdate: false, versions } }),
      'GET /api/lm/loras/updates/overview': () => jsonResponse(overview([])),
    })
    const { downloadQueueSnapshot } = await import('@/composables/useDownloadQueue')
    downloadQueueSnapshot().value = queue
    localStorage.setItem('lm-ui.detail.tab', 'versions')
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(
      { components: { ModelDrawer, ReplaceChoiceDialog }, template: '<ModelDrawer v-bind="$attrs" /><ReplaceChoiceDialog />', inheritAttrs: false },
      { global: { plugins: [router] }, attachTo: document.body, attrs: { item, api: createModelApi('loras'), classicUrl: '/loras' } },
    )
    await flushPromises()
    return { wrapper, drawer: wrapper.findComponent(ModelDrawer), ...env }
  }

  it('marks in-library versions with their file and offers Delete on every one, the current row included', async () => {
    const { wrapper } = await mountDrawer()
    const row = (id: number) => wrapper.get(`[data-testid="version-${id}"]`)
    expect(row(7001).text()).toContain('Current')
    expect(row(7001).text()).toContain('In your library as eldreda_v1_anima.safetensors in chars')
    expect(row(7001).find('[data-testid="delete-version"]').exists()).toBe(true)
    // Owned on disk although the persisted flag says no: read-time ownership.
    expect(row(7002).text()).toContain('In library')
    expect(row(7002).find('[data-testid="delete-version"]').exists()).toBe(true)
    // Two files of one version: a Delete per file, none in the actions column.
    expect(row(7003).findAll('[data-testid="delete-file"]')).toHaveLength(2)
    expect(row(7003).find('[data-testid="delete-version"]').exists()).toBe(false)
    // Not in the library: Queue download, never Delete.
    for (const id of [7004, 7005]) {
      expect(row(id).find('[data-testid="delete-version"]').exists()).toBe(false)
      expect(row(id).find('[data-testid="delete-file"]').exists()).toBe(false)
      expect(row(id).text()).toContain('Queue download')
    }
    wrapper.unmount()
  })

  it('emits the exact file, whether it is the open one and a sibling to switch to', async () => {
    const { wrapper, drawer, calls } = await mountDrawer()
    await wrapper.get('[data-testid="version-7001"] [data-testid="delete-version"]').trigger('click')
    await wrapper.get('[data-testid="version-7003"] [data-testid="delete-file"]').trigger('click')
    const events = drawer.emitted('delete-file') as Array<[{ file: { filePath: string }; isCurrent: boolean; siblingPath: string | null }]>
    expect(events[0][0]).toEqual({
      file: { filePath: 'D:/Models/Loras/chars/eldreda_v1_anima.safetensors', fileName: 'eldreda_v1_anima.safetensors', folder: 'chars', sizeBytes: 2097152, versionName: 'v1.0 Anima' },
      isCurrent: true,
      siblingPath: 'D:/Models/Loras/chars/eldreda_v2_anima.safetensors',
    })
    expect(events[1][0]).toMatchObject({ file: { filePath: 'D:/Models/Loras/chars/eldreda_il.safetensors' }, isCurrent: false, siblingPath: null })
    // The drawer itself never deletes.
    expect(mutating(calls)).toEqual([])
    wrapper.unmount()
  })

  it('offers no delete while the version is being downloaded', async () => {
    const { wrapper } = await mountDrawer([{ download_id: 'd', model_version_id: 7002, status: 'downloading' } as QueueItem])
    expect(wrapper.get('[data-testid="version-7002"]').find('[data-testid="delete-version"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="version-7002"]').text()).toContain('Being downloaded')
    wrapper.unmount()
  })

  it('Queue download asks about the owned versions of the same base only', async () => {
    const { wrapper, calls } = await mountDrawer()
    const queueButton = wrapper.get('[data-testid="version-7005"]').findAll('button').find((b) => b.text().includes('Queue download'))!
    await queueButton.trigger('click')
    await flushPromises()
    // Anima 2.9B: no owned version on that base -> no prompt, queued with Keep.
    expect(document.querySelector('[data-testid="replace-dialog"]')).toBeNull()
    expect(paramsOf(addCalls(calls)[0]).getAll('replace_file_path')).toEqual([])
    wrapper.unmount()
  })
})

// --- the delete flow (same endpoint as the cards) -------------------------------------

describe('deleting a specific version', () => {
  const target = {
    filePath: 'D:/Models/Loras/chars/eldreda_v1.safetensors',
    fileName: 'eldreda_v1.safetensors',
    folder: 'chars',
    sizeBytes: 3 * 1024 * 1024,
    versionName: 'v1.0 Anima',
  }

  function actions(handlers: Record<string, Handler> = {}) {
    const env = backend(handlers)
    const removed = vi.fn()
    const changed = vi.fn()
    return { ...env, removed, changed, flows: useModelActions(createModelApi('loras'), { removed, changed }) }
  }

  it('confirms with version, file, folder, size and the undo window, then posts the exact path', async () => {
    const { calls, removed, flows } = actions({
      'POST /api/lm/loras/delete': () => jsonResponse({ success: true, batch_id: 'b'.repeat(32) }),
    })
    const done = flows.deleteVersionFile(target)
    await flushPromises()
    const request = confirmState().value!
    expect(request.title).toBe('Delete v1.0 Anima?')
    expect(request.message).toContain('File: eldreda_v1.safetensors (3.0 MB)')
    expect(request.message).toContain('Folder: chars')
    expect(request.message).toContain('pending-delete folder')
    expect(request.message).toContain('undo this for 20 seconds')
    expect(request.danger).toBe(true)
    expect(calls).toEqual([])
    request.resolve(true)
    expect(await done).toBe(true)
    expect(calls).toEqual([{ method: 'POST', url: '/api/lm/loras/delete', body: JSON.stringify({ file_path: target.filePath }) }])
    expect(removed).toHaveBeenCalledWith([target.filePath])
    const toast = useToasts().toasts.value.at(-1)!
    expect(toast.message).toBe('Deleted v1.0 Anima (eldreda_v1.safetensors).')
    expect(toast.action?.label).toBe('Undo')
  })

  it('Undo restores through undo-delete and calls back', async () => {
    const onUndone = vi.fn()
    const { calls, changed, flows } = actions({
      'POST /api/lm/loras/delete': () => jsonResponse({ success: true, batch_id: 'c'.repeat(32) }),
      'POST /api/lm/undo-delete': () => jsonResponse({ success: true }),
    })
    const done = flows.deleteVersionFile(target, { onUndone })
    await flushPromises()
    confirmState().value!.resolve(true)
    await done
    useToasts().toasts.value.at(-1)!.action!.run()
    await flushPromises()
    expect(calls.at(-1)).toEqual({ method: 'POST', url: '/api/lm/undo-delete', body: JSON.stringify({ batch_id: 'c'.repeat(32) }) })
    expect(onUndone).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenCalled()
  })

  it('Cancel sends nothing; a failed delete reports the error and reloads', async () => {
    const { calls, removed, changed, flows } = actions({
      'POST /api/lm/loras/delete': () => jsonResponse({ success: false, error: 'locked' }, 500),
    })
    let done = flows.deleteVersionFile(target)
    await flushPromises()
    confirmState().value!.resolve(false)
    expect(await done).toBe(false)
    expect(calls).toEqual([])
    done = flows.deleteVersionFile(target)
    await flushPromises()
    confirmState().value!.resolve(true)
    expect(await done).toBe(false)
    expect(removed).not.toHaveBeenCalled()
    expect(changed).toHaveBeenCalled()
    expect(useToasts().toasts.value.at(-1)?.message).toBe('Could not delete eldreda_v1.safetensors: locked')
  })

  it('a hard-delete fallback (no batch) says permanent and offers no Undo', async () => {
    const { flows } = actions({ 'POST /api/lm/loras/delete': () => jsonResponse({ success: true, batch_id: null }) })
    const done = flows.deleteVersionFile(target)
    await flushPromises()
    confirmState().value!.resolve(true)
    await done
    const toast = useToasts().toasts.value.at(-1)!
    expect(toast.message).toContain('permanently')
    expect(toast.action).toBeUndefined()
  })

  it('"Delete all older" lists every file and uses the bulk delete', async () => {
    const { calls, flows } = actions({
      'POST /api/lm/loras/bulk-delete': () =>
        jsonResponse({ success: true, batch_id: 'd'.repeat(32), results: [{ file_path: 'D:/a/1.safetensors', success: true }, { file_path: 'D:/a/2.safetensors', success: true }] }),
    })
    const files = [
      { ...target, filePath: 'D:/a/1.safetensors', fileName: '1.safetensors', versionName: 'v1' },
      { ...target, filePath: 'D:/a/2.safetensors', fileName: '2.safetensors', versionName: 'v1.5', folder: '' },
    ]
    const done = flows.deleteVersionFiles(files, { modelName: 'Eldreda', keptName: 'v2.0' })
    await flushPromises()
    const request = confirmState().value!
    expect(request.title).toBe('Delete 2 older files of Eldreda?')
    expect(request.message).toContain('- v1: 1.safetensors (chars)')
    expect(request.message).toContain('- v1.5: 2.safetensors')
    expect(request.message).toContain('Kept: v2.0.')
    expect(request.message).toContain('6.0 MB in total')
    request.resolve(true)
    await done
    expect(calls).toEqual([
      { method: 'POST', url: '/api/lm/loras/bulk-delete', body: JSON.stringify({ file_paths: ['D:/a/1.safetensors', 'D:/a/2.safetensors'] }) },
    ])
  })
})

// --- queue rows ---------------------------------------------------------------------------

describe('replace note on queue and history rows', () => {
  it('offers Restore while the staged old file can be undone', async () => {
    const { calls } = backend({ 'POST /api/lm/undo-delete': () => jsonResponse({ success: true }) })
    const until = Math.floor(Date.now() / 1000) + 600
    const item: QueueItem = {
      download_id: 'h1',
      status: 'completed',
      replace_status: 'done',
      replace_targets: JSON.stringify([{ path: 'D:/x/old.safetensors', status: 'replaced', batch_id: 'e'.repeat(32), undo_until: until }]),
    }
    const wrapper = mount(ReplaceNote, { props: { item } })
    expect(wrapper.text()).toContain('Replaced old.safetensors')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(calls).toEqual([{ method: 'POST', url: '/api/lm/undo-delete', body: JSON.stringify({ batch_id: 'e'.repeat(32) }) }])
    expect(wrapper.emitted('restored')).toEqual([['D:/x/old.safetensors']])
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('renders nothing without a replace request', () => {
    const wrapper = mount(ReplaceNote, { props: { item: { download_id: 'x', status: 'queued' } } })
    expect(wrapper.html()).toBe('<!--v-if-->')
  })
})

// --- Old versions view ------------------------------------------------------------------------

function oldVersions(): OldVersionsResponse {
  const f = (name: string, size: number) => ({
    filePath: `D:/Models/Loras/chars/${name}.safetensors`,
    fileName: `${name}.safetensors`,
    folder: 'chars',
    sizeBytes: size,
    modified: 1_700_000_000,
    previewUrl: null,
    previewNsfwLevel: 0,
  })
  return {
    success: true,
    modelType: 'lora',
    totals: { groups: 1, olderVersions: 2, olderFiles: 3, olderBytes: 3 * 1024 * 1024 },
    groups: [
      {
        key: '7000:anima',
        modelId: 7000,
        modelName: 'Eldreda',
        baseModel: 'Anima',
        newest: { versionId: 7002, name: 'v2.0', releasedAt: '2026-06-01T00:00:00Z', sizeBytes: 1, files: [f('eldreda_v2', 1)] },
        older: [
          { versionId: 7015, name: 'v1.5', releasedAt: '2026-03-01T00:00:00Z', sizeBytes: 1048576, files: [f('eldreda_v15', 1048576)] },
          { versionId: 7001, name: 'v1.0', releasedAt: '2026-01-01T00:00:00Z', sizeBytes: 2097152, files: [f('eldreda_v1', 1048576), f('eldreda_v1_fp8', 1048576)] },
        ],
      },
    ],
  }
}

describe('Old versions view', () => {
  async function mountView(data: OldVersionsResponse, handlers: Record<string, Handler> = {}) {
    const env = backend({ 'GET /api/lm/loras/updates/old-versions': () => jsonResponse(data), ...handlers })
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(OldVersionsView, { props: { prefix: 'loras', blurMature: true }, global: { plugins: [router] }, attachTo: document.body })
    await flushPromises()
    return { wrapper, ...env }
  }

  it('shows the newest owned version as kept and every older file with Delete; nothing preselected', async () => {
    const { wrapper, calls } = await mountView(oldVersions())
    expect(wrapper.get('h2').text()).toContain('Old versions')
    const group = wrapper.get('[data-testid="old-group-7000:anima"]')
    expect(group.text()).toContain('Newest in your library')
    expect(group.text()).toContain('v2.0')
    expect(group.findAll('[data-testid="old-file"]').map((r) => r.text().split(' · ')[0])).toEqual([
      'eldreda_v15.safetensors',
      'eldreda_v1.safetensors',
      'eldreda_v1_fp8.safetensors',
    ])
    expect(group.findAll('[data-testid="delete-old-file"]')).toHaveLength(3)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
    expect(wrapper.emitted('counts')).toEqual([[null], [1]])
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
    wrapper.unmount()
  })

  it('Delete on one file posts that path, then re-reads the list', async () => {
    const { wrapper, calls } = await mountView(oldVersions(), {
      'POST /api/lm/loras/delete': () => jsonResponse({ success: true, batch_id: 'f'.repeat(32) }),
    })
    await wrapper.findAll('[data-testid="delete-old-file"]')[1].trigger('click')
    await flushPromises()
    expect(confirmState().value!.title).toBe('Delete v1.0?')
    confirmState().value!.resolve(true)
    await flushPromises()
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts).toEqual([{ method: 'POST', url: '/api/lm/loras/delete', body: JSON.stringify({ file_path: 'D:/Models/Loras/chars/eldreda_v1.safetensors' }) }])
    expect(calls.filter((c) => c.url.includes('old-versions')).length).toBe(2)
    wrapper.unmount()
  })

  it('Delete all older sends every older file (never the newest) in one bulk delete', async () => {
    const { wrapper, calls } = await mountView(oldVersions(), {
      'POST /api/lm/loras/bulk-delete': () => jsonResponse({ success: true, batch_id: 'a'.repeat(32), results: [] }),
    })
    await wrapper.get('[data-testid="delete-all-older"]').trigger('click')
    await flushPromises()
    expect(confirmState().value!.message).toContain('- v1.0: eldreda_v1_fp8.safetensors (chars)')
    confirmState().value!.resolve(true)
    await flushPromises()
    const body = JSON.parse(calls.find((c) => c.method === 'POST')!.body!)
    expect(body.file_paths).toEqual([
      'D:/Models/Loras/chars/eldreda_v15.safetensors',
      'D:/Models/Loras/chars/eldreda_v1.safetensors',
      'D:/Models/Loras/chars/eldreda_v1_fp8.safetensors',
    ])
    expect(body.file_paths).not.toContain('D:/Models/Loras/chars/eldreda_v2.safetensors')
    wrapper.unmount()
  })

  it('says when there are no older versions', async () => {
    const { wrapper } = await mountView({ ...oldVersions(), totals: { groups: 0, olderVersions: 0, olderFiles: 0, olderBytes: 0 }, groups: [] })
    expect(wrapper.text()).toContain('No older versions found')
    wrapper.unmount()
  })

  it('is a separate view on the Updates page with its count', async () => {
    const { wrapper, calls } = await mountUpdates([eldredaGroup()], {
      'GET /api/lm/loras/updates/old-versions': () => jsonResponse(oldVersions()),
    })
    expect(calls.some((c) => c.url.includes('old-versions'))).toBe(false)
    await wrapper.get('[data-testid="view-old"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="old-versions"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="view-old"]').text()).toContain('1')
    expect(wrapper.find('[data-testid="bulk-bar"]').exists()).toBe(false)
    await wrapper.get('[data-testid="view-updates"]').trigger('click')
    expect(wrapper.find('[data-testid="old-versions"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
