/**
 * Phase B1 download dialog: input parsing, version/file state, destination
 * query building and the resolve -> choose -> queue flow against a mocked
 * backend. Written before the implementation; nothing touches a real backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setFetch } from '@/api/http'
import { createModelApi, downloadsApi } from '@/api/endpoints'
import type { CivitaiVersion, QueueItem } from '@/api/types'
import { useDownloadFlow } from '@/composables/useDownloadFlow'
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

describe('useDownloadFlow (mocked backend)', () => {
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
      for (const [prefix, body] of Object.entries(handlers)) {
        if (path.startsWith(prefix)) return typeof body === 'function' ? (body as (u: string) => Response)(input) : json(body)
      }
      return json({ success: false, error: `unexpected ${path}` }, 500)
    })
  }

  const settings = { default_lora_root: 'D:/loras', download_path_templates: { lora: '{base_model}' } }

  it('rejects unusable input without any request', async () => {
    const flow = useDownloadFlow('loras', { queue: () => [], settings: () => settings })
    await flow.resolve('not a url')
    expect(flow.error.value).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves a download link via the version lookup, preselects version and file, then queues with the destination', async () => {
    route({
      '/api/lm/loras/civitai/model/version/20': { id: 20, modelId: 10 },
      '/api/lm/loras/civitai/versions/10': [version(21), version(20, { files: [file(1), file(2)] })],
      '/api/lm/loras/roots': { roots: ['D:/loras', 'E:/more'] },
      '/api/lm/loras/folder-tree': { tree: { style: { anime: {} } } },
      '/api/lm/downloads/queue/add': { success: true, queued: true, duplicate: false, item: { download_id: 'x' } },
    })
    const flow = useDownloadFlow('loras', { queue: () => [], settings: () => settings })
    await flow.resolve('https://civitai.com/api/download/models/20?fileId=2')
    expect(flow.step.value).toBe('version')
    expect(flow.selectedVersionId.value).toBe(20)
    expect([...flow.selectedFileIds.value]).toEqual([2])

    await flow.toLocation()
    expect(flow.step.value).toBe('location')
    expect(flow.roots.value).toEqual(['D:/loras', 'E:/more'])
    expect(flow.root.value).toBe('D:/loras')
    expect(flow.useDefaultPath.value).toBe(false)

    flow.folder.value = 'style/anime'
    const result = await flow.submit()
    expect(result).toMatchObject({ queued: 1, duplicates: 0, failed: 0 })
    expect(flow.step.value).toBe('done')
    const add = (fetchMock.mock.calls as [string][]).map(([u]) => new URL(u, 'http://host')).find((u) => u.pathname.endsWith('/queue/add'))!
    expect(add.searchParams.get('model_version_id')).toBe('20')
    expect(JSON.parse(add.searchParams.get('file_params')!)).toMatchObject({ id: 2 })
    expect(add.searchParams.get('model_root')).toBe('D:/loras')
    expect(add.searchParams.get('relative_path')).toBe('style/anime')
    expect(add.searchParams.get('use_default_paths')).toBe('false')
  })

  it('queues one row per selected file and reports duplicates', async () => {
    let n = 0
    route({
      '/api/lm/loras/civitai/versions/10': [version(20, { files: [file(1), file(2)] })],
      '/api/lm/loras/roots': { roots: ['D:/loras'] },
      '/api/lm/loras/folder-tree': { tree: {} },
      '/api/lm/downloads/queue/add': () =>
        json({ success: true, queued: n === 0, duplicate: n++ > 0, reason: n > 1 ? 'already_queued' : null, item: {} }),
    })
    const flow = useDownloadFlow('loras', { queue: () => [], settings: () => settings })
    await flow.resolve('10')
    flow.toggleFile(1)
    flow.toggleFile(2)
    await flow.toLocation()
    flow.useDefaultPath.value = true
    const result = await flow.submit()
    expect(result).toMatchObject({ queued: 1, duplicates: 1 })
    const adds = (fetchMock.mock.calls as [string][]).map(([u]) => new URL(u, 'http://host')).filter((u) => u.pathname.endsWith('/queue/add'))
    expect(adds).toHaveLength(2)
    // Default root + template: no destination params at all.
    for (const add of adds) expect(add.searchParams.has('model_root')).toBe(false)
  })

  it('refuses to continue with a version that is fully in the library or already queued', async () => {
    route({
      '/api/lm/loras/civitai/versions/10': [
        version(20, { existsLocally: true, downloadedFiles: [{ fileId: 1, fileName: 'f1', filePath: 'x' }] }),
        version(21),
      ],
    })
    const flow = useDownloadFlow('loras', {
      queue: () => [{ download_id: 'q', model_version_id: 21, status: 'downloading' }],
      settings: () => settings,
    })
    await flow.resolve('https://civitai.com/models/10?modelVersionId=20')
    expect(flow.canContinue.value).toBe(false)
    flow.selectVersion(21)
    expect(flow.canContinue.value).toBe(false)
  })

  it('shows the backend error for a model of another type', async () => {
    route({ '/api/lm/loras/civitai/versions/10': () => json({ error: 'Model type mismatch. Expected LORA, got Checkpoint' }, 400) })
    const flow = useDownloadFlow('loras', { queue: () => [], settings: () => settings })
    await flow.resolve('10')
    expect(flow.step.value).toBe('input')
    expect(flow.error.value).toMatch(/mismatch/i)
  })

  it('validates the typed folder before queueing', async () => {
    route({
      '/api/lm/loras/civitai/versions/10': [version(20)],
      '/api/lm/loras/roots': { roots: ['D:/loras'] },
      '/api/lm/loras/folder-tree': { tree: {} },
    })
    const flow = useDownloadFlow('loras', { queue: () => [], settings: () => settings })
    await flow.resolve('10')
    await flow.toLocation()
    flow.folder.value = '../escape'
    expect(flow.folderError.value).toBeTruthy()
    await expect(flow.submit()).resolves.toBeNull()
    expect(calls(fetchMock).some((c) => c.url.includes('queue/add'))).toBe(false)
  })
})
