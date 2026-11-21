/**
 * Download dialog: input parsing, version/file state, destination query
 * building, the batch parser / row state machine / submit summary, and the
 * batch resolve -> choose -> queue flow against a mocked backend. Written
 * before the implementation; nothing touches a real backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, setFetch } from '@/api/http'
import { createModelApi, downloadsApi } from '@/api/endpoints'
import type { CivitaiVersion, QueueItem } from '@/api/types'
import { useBatchDownload } from '@/composables/useBatchDownload'
import {
  applyResolveError,
  applyResolved,
  applySubmitOutcome,
  chooseFile,
  chooseVersion,
  createRow,
  describeResolveError,
  parseBatchInput,
  rowStatus,
  runLimited,
  submittableRows,
  summarize,
  toggleRow,
  type BatchRow,
} from '@/utils/batchDownload'
import {
  defaultVersionId,
  destinationParams,
  filePayload,
  parseDownloadTarget,
  remainingWeightFiles,
  targetPreview,
  versionSizeBytes,
  versionStatus,
  versionThumbnail,
  weightFiles,
} from '@/utils/downloads'
import { setBasePathsForTesting } from '@/utils/basePath'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function calls(fetchMock: ReturnType<typeof vi.fn>) {
  return (fetchMock.mock.calls as [string, RequestInit][]).map(([url, init]) => ({ url, method: init?.method ?? 'GET' }))
}

const file = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: `f${id}.safetensors`,
  type: 'Model',
  sizeKB: 1024,
  primary: id === 1,
  metadata: { format: 'SafeTensor', size: 'pruned', fp: 'fp16' },
  ...extra,
})

function version(id: number, extra: Partial<CivitaiVersion> = {}): CivitaiVersion {
  return {
    id,
    name: `v${id}`,
    baseModel: 'Illustrious',
    createdAt: '2025-01-01T00:00:00Z',
    images: [{ url: `https://img/${id}.mp4` }, { url: `https://img/${id}.jpeg` }],
    files: [file(1)],
    ...extra,
  }
}

describe('download helpers', () => {
  it('parses model URLs, version URLs, download links with fileId and bare ids', () => {
    expect(parseDownloadTarget('123')).toEqual({ modelId: 123, versionId: null, fileId: null })
    expect(parseDownloadTarget('https://civitai.com/models/123/name?modelVersionId=456')).toEqual({
      modelId: 123,
      versionId: 456,
      fileId: null,
    })
    expect(parseDownloadTarget('https://civitai.com/api/download/models/456?fileId=9')).toEqual({
      modelId: null,
      versionId: 456,
      fileId: 9,
    })
    expect(parseDownloadTarget('https://civitai.com/api/v1/model-versions/77')).toEqual({ modelId: null, versionId: 77, fileId: null })
    expect(parseDownloadTarget('https://civitai.red/models/5')).toEqual({ modelId: 5, versionId: null, fileId: null })
    expect(parseDownloadTarget('https://example.com/models/1')).toBeNull()
    expect(parseDownloadTarget('   ')).toBeNull()
  })

  it('lists weight files and the ones still missing locally', () => {
    const v = version(1, {
      files: [file(1), file(2, { type: 'Training Data' }), file(3, { type: 'Pruned Model' })],
      downloadedFiles: [{ fileId: 1, fileName: 'f1', filePath: 'D:/l/f1.safetensors' }],
    })
    expect(weightFiles(v).map((f) => f.id)).toEqual([1, 3])
    expect(remainingWeightFiles(v).map((f) => f.id)).toEqual([3])
  })

  it('derives the per-version state', () => {
    const queue: QueueItem[] = [{ download_id: 'q', model_version_id: 7, status: 'queued' }]
    expect(versionStatus(version(1, { existsLocally: true, downloadedFiles: [{ fileId: 1, fileName: 'f1', filePath: 'x' }] }), queue)).toMatchObject({
      inLibrary: true,
      partial: false,
      canQueue: false,
    })
    expect(
      versionStatus(
        version(2, { existsLocally: true, files: [file(1), file(3)], downloadedFiles: [{ fileId: 1, fileName: 'f1', filePath: 'x' }] }),
        queue,
      ),
    ).toMatchObject({ inLibrary: true, partial: true, canQueue: true })
    expect(versionStatus(version(3, { hasBeenDownloaded: true }), queue)).toMatchObject({ downloadedBefore: true, canQueue: true })
    expect(versionStatus(version(7), queue)).toMatchObject({ queued: true, canQueue: false })
    expect(versionStatus(version(8, { availability: 'EarlyAccess' }), queue)).toMatchObject({ earlyAccess: true })
    // Finished queue rows do not count as queued.
    expect(versionStatus(version(9), [{ download_id: 'c', model_version_id: 9, status: 'completed' }]).queued).toBe(false)
  })

  it('picks the requested version, else the newest', () => {
    const list = [version(3), version(2), version(1)]
    expect(defaultVersionId(list, 2)).toBe(2)
    expect(defaultVersionId(list, 99)).toBe(3)
    expect(defaultVersionId(list, null)).toBe(3)
    expect(defaultVersionId([], null)).toBeNull()
  })

  it('uses the first image thumbnail and the model size', () => {
    expect(versionThumbnail(version(4))).toBe('https://img/4.jpeg')
    expect(versionThumbnail(version(4, { images: [] }))).toBe('')
    expect(versionSizeBytes(version(4, { modelSizeKB: 2 }))).toBe(2048)
    expect(versionSizeBytes(version(4))).toBe(1024 * 1024)
  })

  it('builds file_params like the classic dialog', () => {
    expect(filePayload(file(3))).toEqual({ id: 3, name: 'f3.safetensors', type: 'Model', format: 'SafeTensor', size: 'pruned', fp: 'fp16' })
  })

  it('maps the destination to queue/add params', () => {
    // Default root + template: nothing extra (legacy queue behaviour).
    expect(destinationParams({ root: 'D:/loras', folder: '', useDefaultPath: true }, 'D:/loras')).toEqual({})
    expect(destinationParams({ root: '', folder: '', useDefaultPath: true }, '')).toEqual({})
    // Template below another root.
    expect(destinationParams({ root: 'E:/more', folder: 'x', useDefaultPath: true }, 'D:/loras')).toEqual({
      model_root: 'E:/more',
      use_default_paths: 'true',
    })
    // Explicit folder.
    expect(destinationParams({ root: 'D:/loras', folder: '/style\\anime/', useDefaultPath: false }, 'D:/loras')).toEqual({
      model_root: 'D:/loras',
      relative_path: 'style/anime',
      use_default_paths: 'false',
    })
  })

  it('previews the target path', () => {
    expect(targetPreview({ root: 'D:/loras/', folder: 'a/b', useDefaultPath: false }, '{base_model}')).toBe('D:/loras/a/b')
    expect(targetPreview({ root: 'D:/loras', folder: 'a', useDefaultPath: true }, '{base_model}/{first_tag}')).toBe(
      'D:/loras/{base_model}/{first_tag}',
    )
    expect(targetPreview({ root: 'D:/loras', folder: 'a', useDefaultPath: true }, '')).toBe('D:/loras')
  })
})

describe('download request builders', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    setBasePathsForTesting({ appBase: 'http://host/lm-ui/', appPath: '/lm-ui/', mountPrefix: '' })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => json({ success: true, queued: true, duplicate: false, item: null }))
    setFetch(fetchMock)
  })
  afterEach(() => {
    setFetch(null)
    setBasePathsForTesting(null)
  })

  it('resolves versions and a version id with read-only GETs', async () => {
    const api = createModelApi('loras')
    fetchMock.mockResolvedValueOnce(json([version(1)]))
    await expect(api.civitaiVersions(12)).resolves.toHaveLength(1)
    fetchMock.mockResolvedValueOnce(json({ id: 5, modelId: 12 }))
    await expect(api.civitaiVersionInfo(5)).resolves.toMatchObject({ modelId: 12 })
    expect(calls(fetchMock)).toEqual([
      { url: '/api/lm/loras/civitai/versions/12', method: 'GET' },
      { url: '/api/lm/loras/civitai/model/version/5', method: 'GET' },
    ])
  })

  it('queue/add carries the file and the destination', async () => {
    await downloadsApi.add({
      modelId: 1,
      versionId: 2,
      fileParams: { id: 3, name: 'f.safetensors', type: 'Model' },
      destination: { model_root: 'D:/loras', relative_path: 'a b', use_default_paths: 'false' },
      modelName: 'M',
      versionName: 'V',
      thumbnailUrl: 'https://img/x.jpeg',
    })
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://host')
    expect(url.pathname).toBe('/api/lm/downloads/queue/add')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model_id: '1',
      model_version_id: '2',
      source: 'civitai',
      file_params: JSON.stringify({ id: 3, name: 'f.safetensors', type: 'Model' }),
      model_root: 'D:/loras',
      relative_path: 'a b',
      use_default_paths: 'false',
      model_name: 'M',
      version_name: 'V',
      thumbnail_url: 'https://img/x.jpeg',
    })
    // Never the blocking download-model endpoint.
    expect(calls(fetchMock).some((c) => c.url.includes('download-model'))).toBe(false)
  })

  it('the old simple form call still works (ids only)', async () => {
    await downloadsApi.add({ modelId: 1, versionId: null })
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://host')
    expect(Object.fromEntries(url.searchParams)).toEqual({ model_id: '1', source: 'civitai' })
  })
})

describe('batch input parser', () => {
  const targets = (text: string) => parseBatchInput(text).entries.map((entry) => entry.target)

  it.each([
    ['newlines (Unix)', '1\n2\n3', [1, 2, 3]],
    ['newlines (Windows)', '1\r\n2\r\n3\r\n', [1, 2, 3]],
    ['old Mac line endings', '1\r2', [1, 2]],
    ['spaces and tabs', '1 2\t3', [1, 2, 3]],
    ['commas and semicolons', '1,2;3 , 4', [1, 2, 3, 4]],
    ['blank lines and padding', '\n\n  1  \n\n\t2\n', [1, 2]],
  ])('splits on %s', (_name, text, ids) => {
    expect(targets(text).map((target) => target.modelId)).toEqual(ids)
  })

  it('recognises model URLs on every civitai host, version and download URLs', () => {
    const parsed = parseBatchInput(
      [
        'https://civitai.com/models/10/some-name',
        'https://civitai.red/models/11?modelVersionId=111',
        'https://www.civitai.green/models/12',
        'civitai.com/models/13',
        'https://civitai.com/api/download/models/140?fileId=9&type=Model',
        'https://civitai.com/api/v1/model-versions/150',
        'https://civitai.com/model-versions/160',
      ].join('\n'),
    )
    expect(parsed.invalid).toEqual([])
    expect(parsed.entries.map((entry) => entry.target)).toEqual([
      { modelId: 10, versionId: null, fileId: null },
      { modelId: 11, versionId: 111, fileId: null },
      { modelId: 12, versionId: null, fileId: null },
      { modelId: 13, versionId: null, fileId: null },
      { modelId: null, versionId: 140, fileId: 9 },
      { modelId: null, versionId: 150, fileId: null },
      { modelId: null, versionId: 160, fileId: null },
    ])
  })

  it('extracts URLs from free text and ignores the prose around them', () => {
    const parsed = parseBatchInput(
      'Check these out: https://civitai.com/models/1, and (https://civitai.red/models/2?modelVersionId=3).\n' +
        '<https://civitai.com/models/4> - [link](https://civitai.com/models/5) "https://civitai.com/models/6".',
    )
    expect(parsed.invalid).toEqual([])
    expect(parsed.entries.map((entry) => [entry.target.modelId, entry.target.versionId])).toEqual([
      [1, null],
      [2, 3],
      [4, null],
      [5, null],
      [6, null],
    ])
  })

  it('keeps bare ids next to URLs on the same line', () => {
    expect(targets('7 https://civitai.com/models/8 9').map((target) => target.modelId)).toEqual([8, 7, 9])
  })

  it('de-duplicates identical entries (same model / version / file), keeping the first spelling', () => {
    const parsed = parseBatchInput(
      '1\nhttps://civitai.com/models/1\nhttps://civitai.red/models/1/name\n1, 1\nhttps://civitai.com/models/1?modelVersionId=2',
    )
    expect(parsed.entries.map((entry) => entry.raw)).toEqual(['1', 'https://civitai.com/models/1?modelVersionId=2'])
    expect(parsed.duplicates).toBe(4)
  })

  it('flags garbage: whole lines without any entry, foreign hosts, bad tokens', () => {
    const parsed = parseBatchInput('hello world\nhttps://example.com/models/1\n12 abc\n0x10\n-5\n1.5\nhttps://civitai.com/user/foo')
    expect(parsed.entries.map((entry) => entry.target.modelId)).toEqual([12])
    expect(parsed.invalid).toEqual(['hello world', 'https://example.com/models/1', 'abc', '0x10', '-5', '1.5', 'https://civitai.com/user/foo'])
  })

  it('de-duplicates the invalid list and handles empty input', () => {
    expect(parseBatchInput('foo\nfoo')).toMatchObject({ invalid: ['foo'] })
    expect(parseBatchInput('')).toEqual({ entries: [], invalid: [], duplicates: 0 })
    expect(parseBatchInput(' \r\n \t ,,, ')).toEqual({ entries: [], invalid: [], duplicates: 0 })
  })
})

describe('batch rows: resolve, version/file choice and selection defaults', () => {
  const entry = (raw: string) => parseBatchInput(raw).entries[0]
  const multi = () => version(20, { files: [file(1), file(2), file(3, { type: 'Training Data' })] })
  const ctx = { queue: [] as QueueItem[], taken: new Set<string>() }

  it('starts pending and becomes ready with the URL version, else the newest', () => {
    const row = createRow(entry('https://civitai.com/models/10?modelVersionId=20'))
    expect(row).toMatchObject({ phase: 'pending', selected: false, submit: 'idle' })
    const ready = applyResolved(row, { modelId: 10, modelName: 'Model', versions: [version(21), version(20)] }, ctx)
    expect(ready).toMatchObject({ phase: 'ready', versionId: 20, selected: true, reason: null, modelName: 'Model' })
    const newest = applyResolved(createRow(entry('10')), { modelId: 10, modelName: '', versions: [version(21), version(20)] }, ctx)
    expect(newest.versionId).toBe(21)
  })

  it('defaults to the primary file only when a version has several weight files, or the linked file', () => {
    const plain = applyResolved(createRow(entry('10')), { modelId: 10, modelName: '', versions: [version(20)] }, ctx)
    expect(plain.fileId).toBeNull()
    const several = applyResolved(createRow(entry('10')), { modelId: 10, modelName: '', versions: [multi()] }, ctx)
    expect(several.fileId).toBe(1)
    const linked = applyResolved(createRow(entry('https://civitai.com/api/download/models/20?fileId=2')), { modelId: 10, modelName: '', versions: [multi()] }, ctx)
    expect(linked.fileId).toBe(2)
    // A linked file that is not a weight file falls back to the primary.
    const training = applyResolved(createRow(entry('https://civitai.com/api/download/models/20?fileId=3')), { modelId: 10, modelName: '', versions: [multi()] }, ctx)
    expect(training.fileId).toBe(1)
  })

  it('deselects versions in the library or queued, with the reason; the user can override', () => {
    const inLib = version(20, { existsLocally: true, downloadedFiles: [{ fileId: 1, fileName: 'f1', filePath: 'x' }] })
    const row = applyResolved(createRow(entry('10')), { modelId: 10, modelName: '', versions: [inLib] }, ctx)
    expect(row).toMatchObject({ selected: false, reason: 'inLibrary' })
    expect(toggleRow(row)).toMatchObject({ selected: true })

    const queued = applyResolved(
      createRow(entry('10')),
      { modelId: 10, modelName: '', versions: [version(20)] },
      { queue: [{ download_id: 'q', model_version_id: 20, status: 'queued' }], taken: new Set() },
    )
    expect(queued).toMatchObject({ selected: false, reason: 'queued' })

    const before = applyResolved(createRow(entry('10')), { modelId: 10, modelName: '', versions: [version(20, { hasBeenDownloaded: true })] }, ctx)
    expect(before).toMatchObject({ selected: true, reason: null })
    expect(rowStatus(before, [])).toMatchObject({ downloadedBefore: true })
  })

  it('a partial version stays selected and defaults to the missing file', () => {
    const partial = version(20, {
      existsLocally: true,
      files: [file(1), file(2)],
      downloadedFiles: [{ fileId: 1, fileName: 'f1', filePath: 'x' }],
    })
    const row = applyResolved(createRow(entry('10')), { modelId: 10, modelName: '', versions: [partial] }, ctx)
    expect(row).toMatchObject({ selected: true, fileId: 2 })
    expect(rowStatus(row, [])).toMatchObject({ partial: true, fileInLibrary: false })
    expect(rowStatus(chooseFile(row, 1), [])).toMatchObject({ fileInLibrary: true })
  })

  it('deselects a row that resolves to the same version + file as an earlier one', () => {
    const row = applyResolved(createRow(entry('https://civitai.com/api/download/models/20')), { modelId: 10, modelName: '', versions: [version(20)] }, {
      queue: [],
      taken: new Set(['20:']),
    })
    expect(row).toMatchObject({ selected: false, reason: 'duplicate' })
  })

  it('choosing another version resets the file and recomputes the default selection', () => {
    const inLib = version(21, { existsLocally: true, downloadedFiles: [{ fileId: 1, fileName: 'f1', filePath: 'x' }] })
    let row = applyResolved(createRow(entry('10')), { modelId: 10, modelName: '', versions: [inLib, multi()] }, ctx)
    expect(row).toMatchObject({ versionId: 21, selected: false })
    row = chooseVersion(row, 20, [])
    expect(row).toMatchObject({ versionId: 20, fileId: 1, selected: true, reason: null })
    expect(chooseVersion(row, 999, []).versionId).toBe(20)
  })

  it('an error row is never selectable and keeps its message for the retry', () => {
    const row = applyResolveError(createRow(entry('10')), 'Not found')
    expect(row).toMatchObject({ phase: 'error', error: 'Not found', selected: false })
    expect(toggleRow(row).selected).toBe(false)
  })

  it('describes resolve errors by status', () => {
    expect(describeResolveError(new ApiError('x', 404))).toMatch(/not found/i)
    expect(describeResolveError(new ApiError('x', 429))).toMatch(/rate/i)
    expect(describeResolveError(new ApiError('x', 401))).toMatch(/api key|private/i)
    expect(describeResolveError(new ApiError('Model type mismatch. Expected LORA, got Checkpoint', 400))).toMatch(/mismatch/)
    expect(describeResolveError(new Error('boom'))).toBe('boom')
  })
})

describe('batch submit: plan, outcome, summary and retry-failed-only', () => {
  function readyRow(id: number, extra: Partial<BatchRow> = {}): BatchRow {
    const row = applyResolved(createRow(parseBatchInput(String(id)).entries[0]), { modelId: id, modelName: `M${id}`, versions: [version(id * 10)] }, {
      queue: [],
      taken: new Set(),
    })
    return { ...row, ...extra }
  }

  it('plans only ready, selected rows that were not added yet', () => {
    const rows = [
      readyRow(1),
      readyRow(2, { selected: false }),
      applyResolveError(createRow(parseBatchInput('3').entries[0]), 'x'),
      readyRow(4, { submit: 'added' }),
      readyRow(5, { submit: 'duplicate' }),
      readyRow(6, { submit: 'failed', submitError: 'boom' }),
      readyRow(7, { submit: 'submitting' }),
    ]
    expect(submittableRows(rows).map((row) => row.modelId)).toEqual([1, 6])
  })

  it('records outcomes and summarises added / duplicates / failed with reasons', () => {
    const rows = [
      applySubmitOutcome(readyRow(1), { queued: true, duplicate: false }),
      applySubmitOutcome(readyRow(2), { queued: false, duplicate: true }),
      applySubmitOutcome(readyRow(3), { error: 'Network error' }),
      applySubmitOutcome(readyRow(4), { queued: false, duplicate: false }),
      readyRow(5, { selected: false }),
    ]
    expect(rows.map((row) => row.submit)).toEqual(['added', 'duplicate', 'failed', 'failed', 'idle'])
    const summary = summarize(rows)
    expect(summary).toMatchObject({ added: 1, duplicates: 1, failed: 2 })
    expect(summary.failures.map((entry) => entry.reason)).toEqual(['Network error', expect.stringMatching(/not added/i)])
    expect(summary.failures[0].label).toContain('M3')
    // Retry: only the failed rows are submitted again; added/duplicate rows are locked.
    expect(submittableRows(rows).map((row) => row.modelId)).toEqual([3, 4])
    expect(toggleRow(rows[0]).selected).toBe(rows[0].selected)
  })
})

describe('runLimited', () => {
  it('never runs more than the limit at once and processes every item', async () => {
    let active = 0
    let peak = 0
    const done: number[] = []
    await runLimited([1, 2, 3, 4, 5, 6, 7], 2, async (item) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      done.push(item)
      active -= 1
    })
    expect(peak).toBe(2)
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('stops starting new items once aborted', async () => {
    const controller = new AbortController()
    const started: number[] = []
    await runLimited(
      [1, 2, 3, 4, 5],
      1,
      async (item) => {
        started.push(item)
        if (item === 2) controller.abort()
      },
      controller.signal,
    )
    expect(started).toEqual([1, 2])
  })
})

describe('useBatchDownload (mocked backend)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    setBasePathsForTesting({ appBase: 'http://host/lm-ui/', appPath: '/lm-ui/', mountPrefix: '' })
    fetchMock.mockReset()
    setFetch(fetchMock)
  })
  afterEach(() => {
    setFetch(null)
    setBasePathsForTesting(null)
  })

  function route(handlers: Record<string, unknown>) {
    fetchMock.mockImplementation(async (input: string) => {
      const path = new URL(input, 'http://host').pathname
      const body = handlers[path]
      if (body === undefined) return json({ success: false, error: `unexpected ${path}` }, 500)
      return typeof body === 'function' ? (body as (u: string) => Response | Promise<Response>)(input) : json(body)
    })
  }
  const adds = () =>
    (fetchMock.mock.calls as [string][]).map(([u]) => new URL(u, 'http://host')).filter((u) => u.pathname.endsWith('/queue/add'))
  const paths = () => (fetchMock.mock.calls as [string][]).map(([u]) => new URL(u, 'http://host').pathname)

  const settings = { default_lora_root: 'D:/loras', download_path_templates: { lora: '{base_model}' } }
  const base = {
    '/api/lm/loras/roots': { roots: ['D:/loras', 'E:/more'] },
    '/api/lm/loras/folder-tree': { tree: { style: { anime: {} } } },
  }

  it('rejects input without any entry and sends no request', async () => {
    const batch = useBatchDownload('loras', { queue: () => [], settings: () => settings })
    await batch.start('not a url')
    expect(batch.step.value).toBe('input')
    expect(batch.error.value).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a single entry is a batch of one: resolve (download link), choose, queue with the destination', async () => {
    route({
      ...base,
      '/api/lm/loras/civitai/model/version/20': { id: 20, modelId: 10, model: { name: 'Cool LoRA' } },
      '/api/lm/loras/civitai/versions/10': [version(21), version(20, { files: [file(1), file(2)] })],
      '/api/lm/downloads/queue/add': { success: true, queued: true, duplicate: false, item: { download_id: 'x' } },
    })
    const batch = useBatchDownload('loras', { queue: () => [], settings: () => settings })
    await batch.start('https://civitai.com/api/download/models/20?fileId=2')
    expect(batch.step.value).toBe('review')
    expect(batch.rows.value).toHaveLength(1)
    expect(batch.rows.value[0]).toMatchObject({ phase: 'ready', modelName: 'Cool LoRA', versionId: 20, fileId: 2, selected: true })
    expect(batch.root.value).toBe('D:/loras')
    // The version info was fetched once (model id + name), not again for the name.
    expect(paths().filter((p) => p.includes('/model/version/'))).toHaveLength(1)

    batch.useDefaultPath.value = false
    batch.folder.value = 'style/anime'
    const summary = await batch.submit()
    expect(summary).toMatchObject({ added: 1, duplicates: 0, failed: 0 })
    const [add] = adds()
    expect(add.searchParams.get('model_id')).toBe('10')
    expect(add.searchParams.get('model_version_id')).toBe('20')
    expect(JSON.parse(add.searchParams.get('file_params')!)).toMatchObject({ id: 2 })
    expect(add.searchParams.get('model_name')).toBe('Cool LoRA')
    expect(add.searchParams.get('model_root')).toBe('D:/loras')
    expect(add.searchParams.get('relative_path')).toBe('style/anime')
    expect(add.searchParams.get('use_default_paths')).toBe('false')
    // Never the blocking download-model endpoint.
    expect(paths().some((p) => p.includes('download-model'))).toBe(false)
  })

  it('resolves many entries with limited concurrency, one versions lookup per model, flags errors', async () => {
    let active = 0
    let peak = 0
    const slow = (body: unknown, status = 200) => async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 3))
      active -= 1
      return json(body, status)
    }
    route({
      ...base,
      '/api/lm/loras/civitai/versions/1': slow([version(10)]),
      '/api/lm/loras/civitai/versions/2': slow([version(20, { existsLocally: true, downloadedFiles: [{ fileId: 1, fileName: 'f', filePath: 'x' }] })]),
      '/api/lm/loras/civitai/versions/3': slow({ error: 'Civitai model 3 was not found' }, 404),
      '/api/lm/loras/civitai/versions/4': slow([version(40)]),
      '/api/lm/loras/civitai/versions/5': slow([version(50)]),
      '/api/lm/loras/civitai/model/version/10': { id: 10, model: { name: 'One' } },
      '/api/lm/loras/civitai/model/version/20': { id: 20, model: { name: 'Two' } },
      '/api/lm/loras/civitai/model/version/40': { id: 40, model: { name: 'Four' } },
      '/api/lm/loras/civitai/model/version/50': { id: 50, model: { name: 'Five' } },
    })
    const batch = useBatchDownload('loras', { queue: () => [], settings: () => settings, concurrency: 2 })
    await batch.start('1\n2 3\ngarbage\n4\nhttps://civitai.com/models/4?modelVersionId=40\n5')
    expect(peak).toBeLessThanOrEqual(2)
    expect(batch.invalid.value).toEqual(['garbage'])
    const byRaw = Object.fromEntries(batch.rows.value.map((row) => [row.raw, row]))
    expect(byRaw['1']).toMatchObject({ phase: 'ready', selected: true, modelName: 'One' })
    expect(byRaw['2']).toMatchObject({ phase: 'ready', selected: false, reason: 'inLibrary' })
    expect(byRaw['3']).toMatchObject({ phase: 'error', selected: false })
    expect(byRaw['3'].error).toMatch(/not found/i)
    // Same model twice: one versions request; the later row resolves to the same version and is deselected.
    expect(paths().filter((p) => p === '/api/lm/loras/civitai/versions/4')).toHaveLength(1)
    expect(byRaw['4']).toMatchObject({ selected: true })
    expect(byRaw['https://civitai.com/models/4?modelVersionId=40']).toMatchObject({ selected: false, reason: 'duplicate' })
    expect(batch.selectedCount.value).toBe(3)

    batch.clearInvalid()
    expect(batch.invalid.value).toEqual([])
    batch.removeRow(byRaw['5'].key)
    expect(batch.rows.value.some((row) => row.raw === '5')).toBe(false)
    expect(batch.selectedCount.value).toBe(2)
  })

  it('retries one failed lookup', async () => {
    let attempts = 0
    route({
      ...base,
      '/api/lm/loras/civitai/versions/7': () => (++attempts === 1 ? json({ error: 'Rate limited' }, 429) : json([version(70)])),
      '/api/lm/loras/civitai/model/version/70': { id: 70, model: { name: 'Seven' } },
    })
    const batch = useBatchDownload('loras', { queue: () => [], settings: () => settings })
    await batch.start('7')
    expect(batch.rows.value[0]).toMatchObject({ phase: 'error' })
    expect(batch.rows.value[0].error).toMatch(/rate/i)
    await batch.retryRow(batch.rows.value[0].key)
    expect(batch.rows.value[0]).toMatchObject({ phase: 'ready', selected: true, modelName: 'Seven' })
  })

  it('stopping aborts the lookups; stopped rows become retryable errors', async () => {
    route({
      ...base,
      '/api/lm/loras/civitai/versions/1': async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return json([version(10)])
      },
      '/api/lm/loras/civitai/versions/2': [version(20)],
      '/api/lm/loras/civitai/model/version/10': { id: 10 },
      '/api/lm/loras/civitai/model/version/20': { id: 20 },
    })
    const batch = useBatchDownload('loras', { queue: () => [], settings: () => settings, concurrency: 1 })
    const running = batch.start('1\n2')
    await new Promise((resolve) => setTimeout(resolve, 0))
    batch.stop()
    await running
    expect(batch.resolving.value).toBe(false)
    expect(paths().includes('/api/lm/loras/civitai/versions/2')).toBe(false)
    expect(batch.rows.value.find((row) => row.raw === '2')).toMatchObject({ phase: 'error' })
  })

  it('submits sequentially with progress, then retries only the failed rows; no double submit', async () => {
    let failThirty = true
    const seen: string[] = []
    route({
      ...base,
      '/api/lm/loras/civitai/versions/1': [version(10)],
      '/api/lm/loras/civitai/versions/2': [version(20)],
      '/api/lm/loras/civitai/versions/3': [version(30)],
      '/api/lm/loras/civitai/model/version/10': { id: 10 },
      '/api/lm/loras/civitai/model/version/20': { id: 20 },
      '/api/lm/loras/civitai/model/version/30': { id: 30 },
      '/api/lm/downloads/queue/add': (u: string) => {
        const vid = new URL(u, 'http://host').searchParams.get('model_version_id')!
        seen.push(vid)
        if (vid === '20') return json({ success: true, queued: false, duplicate: true, reason: 'already_queued', item: null })
        if (vid === '30' && failThirty) return json({ error: 'boom' }, 500)
        return json({ success: true, queued: true, duplicate: false, item: {} })
      },
    })
    const batch = useBatchDownload('loras', { queue: () => [], settings: () => settings })
    await batch.start('1 2 3')
    batch.useDefaultPath.value = true
    const first = batch.submit()
    // A second click while submitting does nothing.
    await expect(batch.submit()).resolves.toBeNull()
    const summary = await first
    expect(summary).toMatchObject({ added: 1, duplicates: 1, failed: 1 })
    expect(summary!.failures[0].reason).toBe('boom')
    expect(batch.progress.value).toEqual({ done: 3, total: 3 })
    expect(seen).toEqual(['10', '20', '30'])
    // Default root + template: no destination params.
    for (const add of adds()) expect(add.searchParams.has('model_root')).toBe(false)
    expect(batch.selectedCount.value).toBe(1)

    failThirty = false
    const retry = await batch.submit()
    expect(seen).toEqual(['10', '20', '30', '30'])
    expect(retry).toMatchObject({ added: 2, duplicates: 1, failed: 0 })
    expect(batch.progress.value).toEqual({ done: 1, total: 1 })
    // Nothing left to send.
    await expect(batch.submit()).resolves.toBeNull()
    expect(seen).toHaveLength(4)
  })

  it('validates the typed folder before queueing anything', async () => {
    route({ ...base, '/api/lm/loras/civitai/versions/10': [version(20)], '/api/lm/loras/civitai/model/version/20': { id: 20 } })
    const batch = useBatchDownload('loras', { queue: () => [], settings: () => settings })
    await batch.start('10')
    batch.useDefaultPath.value = false
    batch.folder.value = '../escape'
    expect(batch.folderError.value).toBeTruthy()
    await expect(batch.submit()).resolves.toBeNull()
    expect(adds()).toHaveLength(0)
  })

  it('shows the backend error for a model of another type on its row', async () => {
    route({ ...base, '/api/lm/loras/civitai/versions/10': () => json({ error: 'Model type mismatch. Expected LORA, got Checkpoint' }, 400) })
    const batch = useBatchDownload('loras', { queue: () => [], settings: () => settings })
    await batch.start('10')
    expect(batch.rows.value[0].phase).toBe('error')
    expect(batch.rows.value[0].error).toMatch(/mismatch/i)
  })

  it('a version id that is not part of the model is an error on that row', async () => {
    route({ ...base, '/api/lm/loras/civitai/versions/10': [version(21)], '/api/lm/loras/civitai/model/version/21': { id: 21 } })
    const batch = useBatchDownload('loras', { queue: () => [], settings: () => settings })
    await batch.start('https://civitai.com/models/10?modelVersionId=99')
    expect(batch.rows.value[0]).toMatchObject({ phase: 'error' })
    expect(batch.rows.value[0].error).toMatch(/99/)
  })
})

