/**
 * Phase B1 model tools: request builders (preview replace, NSFW level,
 * Civitai refresh/relink, filename template, folders, duplicates, excluded),
 * pure helpers and the confirm flows against a mocked backend. Written before
 * the implementation; nothing touches a real backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { setFetch } from '@/api/http'
import { createModelApi } from '@/api/endpoints'
import type { ModelItem } from '@/api/types'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import { useModelTools } from '@/composables/useModelTools'
import {
  NSFW_LEVELS,
  classifyFolderProbe,
  duplicateDeleteError,
  nsfwLabel,
  pruneDuplicateGroups,
  runSequential,
  summarizeTemplatePlan,
  validateFolderName,
} from '@/utils/modelTools'
import { setBasePathsForTesting } from '@/utils/basePath'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function item(name: string, folder = ''): ModelItem {
  const dir = folder ? `D:/loras/${folder}` : 'D:/loras'
  return { model_name: name.toUpperCase(), file_name: name, file_path: `${dir}/${name}.safetensors`, folder, preview_url: '', base_model: 'SDXL' }
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  const body = init?.body
  return {
    url,
    method: init?.method ?? 'GET',
    body: body instanceof FormData ? body : body ? JSON.parse(String(body)) : undefined,
  }
}

function autoConfirm(answer: boolean) {
  const { confirmState } = useConfirm()
  const seen: { title: string; message: string; danger: boolean }[] = []
  const stop = watch(confirmState, (state) => {
    if (!state) return
    seen.push({ title: state.title, message: state.message, danger: state.danger })
    state.resolve(answer)
  })
  return { seen, stop }
}

describe('model tool helpers', () => {
  it('offers the five classic NSFW levels with labels', () => {
    expect(NSFW_LEVELS.map((level) => level.value)).toEqual([1, 2, 4, 8, 16])
    expect(nsfwLabel(4)).toBe('R')
    expect(nsfwLabel(0)).toBe('Unrated')
  })

  it('validates a single folder name', () => {
    expect(validateFolderName('ok name')).toBeNull()
    for (const bad of ['', '  ', 'a/b', 'a\\b', '..', '.', 'x*', 'trail.', 'trail ']) expect(validateFolderName(bad)).not.toBeNull()
  })

  it('classifies a delete-folder dry run', () => {
    expect(classifyFolderProbe({ success: true, model_count: 0, file_count: 0, restorable: true })).toBe('empty')
    expect(classifyFolderProbe({ success: true, model_count: 0, file_count: 3, restorable: false })).toBe('leftovers')
    expect(classifyFolderProbe({ success: false, code: 'not_empty', manifest: { model_count: 2 } })).toBe('notEmpty')
    expect(classifyFolderProbe({ success: false, code: 'busy' })).toBe('busy')
    expect(classifyFolderProbe({ success: false, code: 'protected' })).toBe('protected')
    expect(classifyFolderProbe({ success: false, code: 'missing' })).toBe('missing')
    expect(classifyFolderProbe({ success: false, error: 'Cannot delete a library root' })).toBe('refused')
  })

  it('summarizes a filename template dry run', () => {
    const plan = summarizeTemplatePlan({
      success: true,
      dry_run: true,
      summary: { total: 3, success: 1, skipped: 1, failures: 1, path_template: '{model_name}' },
      planned_moves: [{ model: 'A', from: 'D:/l/a.safetensors', to: 'D:/l/Alpha.safetensors' }],
      results: [{ model: 'C', success: false, message: 'Target exists' }],
    })
    expect(plan.renames).toEqual([{ model: 'A', from: 'a.safetensors', to: 'Alpha.safetensors', dir: 'D:/l' }])
    expect(plan.failures).toEqual([{ model: 'C', message: 'Target exists' }])
    expect(plan.skipped).toBe(1)
    expect(plan.template).toBe('{model_name}')
  })

  it('never lets a duplicate delete remove every copy of a group', () => {
    const group = { hash: 'h', models: [item('a'), item('b', 'x'), item('c', 'y')] }
    expect(duplicateDeleteError([group], new Set())).toBe('none')
    expect(duplicateDeleteError([group], new Set([group.models[1].file_path]))).toBeNull()
    expect(duplicateDeleteError([group], new Set(group.models.map((m) => m.file_path)))).toBe('keepOne')
    // A file "Verify" proved different is not a copy: the other two may not both go.
    const different = new Set([group.models[2].file_path])
    expect(duplicateDeleteError([group], new Set([group.models[0].file_path, group.models[1].file_path]), different)).toBe('keepOne')
    expect(duplicateDeleteError([group], new Set([group.models[1].file_path]), different)).toBeNull()
  })

  it('drops deleted models and groups that are no longer duplicates', () => {
    const groups = [
      { hash: 'h1', models: [item('a'), item('b', 'x')] },
      { hash: 'h2', models: [item('c'), item('d', 'x'), item('e', 'y')] },
    ]
    const next = pruneDuplicateGroups(groups, [groups[0].models[1].file_path, groups[1].models[0].file_path])
    expect(next.map((g) => g.hash)).toEqual(['h2'])
    expect(next[0].models.map((m) => m.file_name)).toEqual(['d', 'e'])
  })

  it('runs a sequential job with progress, failures and cancel', async () => {
    const progress: number[] = []
    let cancel = false
    const result = await runSequential(
      ['a', 'b', 'c', 'd'],
      async (value) => {
        if (value === 'b') throw new Error('nope')
        if (value === 'c') cancel = true
      },
      { onProgress: (done) => progress.push(done), isCancelled: () => cancel },
    )
    expect(result).toEqual({ ok: 2, failed: [{ item: 'b', message: 'nope' }], cancelled: true })
    expect(progress).toEqual([1, 2, 3])
  })
})

describe('model tool request builders', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    setBasePathsForTesting({ appBase: 'http://host/lm-ui/', appPath: '/lm-ui/', mountPrefix: '' })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => json({ success: true }))
    setFetch(fetchMock)
  })
  afterEach(() => {
    setFetch(null)
    setBasePathsForTesting(null)
  })

  it('replace preview posts multipart fields in the order the backend requires', async () => {
    const api = createModelApi('loras')
    const blob = new File(['x'], 'p.png', { type: 'image/png' })
    await api.replacePreview('D:/loras/a.safetensors', blob, 4)
    const call = lastCall(fetchMock)
    expect(call.url).toBe('/api/lm/loras/replace-preview')
    expect(call.method).toBe('POST')
    const form = call.body as FormData
    expect([...form.keys()]).toEqual(['preview_file', 'model_path', 'nsfw_level'])
    expect(form.get('model_path')).toBe('D:/loras/a.safetensors')
    expect(form.get('nsfw_level')).toBe('4')
    // No JSON content type: the browser sets the multipart boundary.
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('preview from URL, NSFW level, refresh and relink', async () => {
    const api = createModelApi('checkpoints')
    await api.setPreviewFromUrl('D:/c/a.safetensors', 'https://img/x.jpeg', 2)
    expect(lastCall(fetchMock)).toMatchObject({
      url: '/api/lm/checkpoints/set-preview-from-url',
      body: { model_path: 'D:/c/a.safetensors', image_url: 'https://img/x.jpeg', nsfw_level: 2 },
    })
    await api.setNsfwLevel('D:/c/a.safetensors', 8)
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/checkpoints/save-metadata', body: { file_path: 'D:/c/a.safetensors', preview_nsfw_level: 8 } })
    await api.fetchCivitai('D:/c/a.safetensors')
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/checkpoints/fetch-civitai', body: { file_path: 'D:/c/a.safetensors' } })
    await api.relinkCivitai('D:/c/a.safetensors', 10, 20)
    expect(lastCall(fetchMock)).toMatchObject({
      url: '/api/lm/checkpoints/relink-civitai',
      body: { file_path: 'D:/c/a.safetensors', model_id: 10, model_version_id: 20 },
    })
    await api.relinkCivitai('D:/c/a.safetensors', 10, null)
    expect(lastCall(fetchMock).body).toEqual({ file_path: 'D:/c/a.safetensors', model_id: 10 })
  })

  it('filename template: the preview is always a dry-run POST; apply needs an explicit scope', async () => {
    const api = createModelApi('loras')
    await api.filenameTemplatePreview({ filePaths: ['a', 'b'] })
    expect(lastCall(fetchMock)).toEqual({
      url: '/api/lm/loras/apply-filename-template',
      method: 'POST',
      body: { dry_run: true, file_paths: ['a', 'b'] },
    })
    await api.filenameTemplatePreview({ folderPaths: ['D:/loras/x'] })
    expect(lastCall(fetchMock).body).toEqual({ dry_run: true, folder_paths: ['D:/loras/x'] })
    await api.filenameTemplateApply({ filePaths: ['a'] })
    expect(lastCall(fetchMock)).toEqual({ url: '/api/lm/loras/apply-filename-template', method: 'POST', body: { dry_run: false, file_paths: ['a'] } })
    // No scope = whole library: refused client-side, nothing sent.
    const before = fetchMock.mock.calls.length
    expect(() => api.filenameTemplateApply({})).toThrow()
    expect(() => api.filenameTemplatePreview({ filePaths: [] })).toThrow()
    expect(fetchMock.mock.calls.length).toBe(before)
    // Never a GET (a GET without dry_run renames for real).
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) expect(init.method).toBe('POST')
  })

  it('folder endpoints', async () => {
    const api = createModelApi('loras')
    await api.createFolder('D:/loras/new')
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/create-folder', body: { folder_path: 'D:/loras/new' } })
    await api.renameFolder('D:/loras/new', 'newer')
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/rename-folder', body: { folder_path: 'D:/loras/new', new_name: 'newer' } })
    await api.deleteFolder('D:/loras/newer', true)
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/delete-folder', body: { folder_path: 'D:/loras/newer', dry_run: true } })
    fetchMock.mockResolvedValueOnce(json({ success: true, folder: 'x', candidates: [{ folder_path: 'D:/loras/x', root: 'D:/loras', is_symlink: false }] }))
    await expect(api.resolveFolder('x')).resolves.toHaveLength(1)
    expect(lastCall(fetchMock).url).toBe('/api/lm/loras/resolve-folder?folder=x')
  })

  it('a refused delete-folder probe returns its payload instead of throwing', async () => {
    const api = createModelApi('loras')
    fetchMock.mockResolvedValueOnce(json({ success: false, code: 'not_empty', error: 'has models', manifest: { model_count: 1 } }, 409))
    await expect(api.deleteFolder('D:/loras/x', true)).resolves.toMatchObject({ success: false, code: 'not_empty' })
  })

  it('move with default path sends the root and use_default_paths', async () => {
    const api = createModelApi('loras')
    await api.moveModel('D:/loras/x/a.safetensors', 'D:/loras', true)
    expect(lastCall(fetchMock).body).toEqual({ file_path: 'D:/loras/x/a.safetensors', target_path: 'D:/loras', use_default_paths: true })
    await api.moveBulk(['a', 'b'], 'D:/loras', true)
    expect(lastCall(fetchMock).body).toEqual({ file_paths: ['a', 'b'], target_path: 'D:/loras', use_default_paths: true })
  })

  it('duplicates, filename conflicts and excluded models', async () => {
    const api = createModelApi('loras')
    fetchMock.mockResolvedValueOnce(json({ success: true, duplicates: [{ hash: 'h', models: [] }], count: 1 }))
    await expect(api.findDuplicates()).resolves.toHaveLength(1)
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/find-duplicates', method: 'GET' })
    fetchMock.mockResolvedValueOnce(json({ success: true, verified_as_duplicates: false, mismatched_files: ['b'], new_hash_map: { b: 'x' } }))
    await expect(api.verifyDuplicates(['a', 'b'])).resolves.toMatchObject({ mismatched_files: ['b'] })
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/verify-duplicates', body: { file_paths: ['a', 'b'] } })
    fetchMock.mockResolvedValueOnce(json({ success: true, conflicts: [{ filename: 'a', models: [] }], count: 1 }))
    await expect(api.filenameConflicts()).resolves.toHaveLength(1)
    fetchMock.mockResolvedValueOnce(json({ items: [], total: 0, page: 1, page_size: 50, total_pages: 0 }))
    await api.excluded(1, 50, 'abc')
    expect(lastCall(fetchMock).url).toBe('/api/lm/loras/excluded?page=1&page_size=50&search=abc')
  })
})

describe('useModelTools flows (mocked backend)', () => {
  const fetchMock = vi.fn()
  const toasts = useToasts()
  let stopConfirm: (() => void) | null = null

  beforeEach(() => {
    setBasePathsForTesting({ appBase: 'http://host/lm-ui/', appPath: '/lm-ui/', mountPrefix: '' })
    fetchMock.mockReset()
    setFetch(fetchMock)
    toasts.toasts.value = []
  })
  afterEach(() => {
    stopConfirm?.()
    stopConfirm = null
    setFetch(null)
    setBasePathsForTesting(null)
    useConfirm().confirmState.value = null
  })

  function setup() {
    const changed = vi.fn()
    const updated = vi.fn()
    const tools = useModelTools(createModelApi('loras'), { changed, updated })
    return { tools, changed, updated }
  }

  it('setting the NSFW level saves only that key and patches the card', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true }))
    const { tools, updated } = setup()
    await expect(tools.setNsfwLevel(item('a'), 8)).resolves.toBe(true)
    expect(lastCall(fetchMock).body).toEqual({ file_path: 'D:/loras/a.safetensors', preview_nsfw_level: 8 })
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ file_path: 'D:/loras/a.safetensors', preview_nsfw_level: 8 }))
  })

  it('refresh from Civitai asks first and patches the card with the returned metadata', async () => {
    const confirm = autoConfirm(true)
    stopConfirm = confirm.stop
    fetchMock.mockResolvedValueOnce(json({ success: true, metadata: { ...item('a'), model_name: 'Fresh' } }))
    const { tools, updated } = setup()
    await expect(tools.refreshFromCivitai(item('a'))).resolves.toBe(true)
    expect(confirm.seen[0].message).toMatch(/model name and base model/i)
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ model_name: 'Fresh' }))
  })

  it('a cancelled refresh sends nothing', async () => {
    stopConfirm = autoConfirm(false).stop
    const { tools } = setup()
    await expect(tools.refreshFromCivitai(item('a'))).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('relink parses the Civitai URL and refuses input without a model id', async () => {
    const { tools } = setup()
    await expect(tools.relink(item('a'), 'https://example.com/x')).resolves.toMatch(/Civitai/)
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(json({ success: true, metadata: item('a') }))
    await expect(tools.relink(item('a'), 'https://civitai.com/models/10?modelVersionId=20')).resolves.toBeNull()
    expect(lastCall(fetchMock).body).toEqual({ file_path: 'D:/loras/a.safetensors', model_id: 10, model_version_id: 20 })
  })

  it('applying the filename template previews first and renames only after a danger confirm', async () => {
    const confirm = autoConfirm(true)
    stopConfirm = confirm.stop
    fetchMock
      .mockResolvedValueOnce(
        json({
          success: true,
          dry_run: true,
          summary: { total: 1, success: 1, skipped: 0, failures: 0, path_template: '{model_name}' },
          planned_moves: [{ model: 'A', from: 'D:/loras/a.safetensors', to: 'D:/loras/Alpha.safetensors' }],
          results: [],
        }),
      )
      .mockResolvedValueOnce(json({ success: true, summary: { total: 1, success: 1, skipped: 0, failures: 0 } }))
    const { tools, changed } = setup()
    const plan = await tools.previewTemplate({ filePaths: ['D:/loras/a.safetensors'] })
    expect(plan?.renames).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(tools.applyTemplate({ filePaths: ['D:/loras/a.safetensors'] }, plan!)).resolves.toBe(true)
    expect(confirm.seen[0].danger).toBe(true)
    expect(confirm.seen[0].message).toMatch(/1 file/)
    expect(lastCall(fetchMock).body).toEqual({ dry_run: false, file_paths: ['D:/loras/a.safetensors'] })
    expect(changed).toHaveBeenCalled()
  })

  it('nothing to rename means no apply request', async () => {
    const { tools } = setup()
    const plan = summarizeTemplatePlan({ success: true, dry_run: true, summary: { total: 1, success: 0 }, planned_moves: [], results: [] })
    await expect(tools.applyTemplate({ filePaths: ['a'] }, plan)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deleting a folder probes first, explains leftovers, and deletes only after confirm', async () => {
    const confirm = autoConfirm(true)
    stopConfirm = confirm.stop
    fetchMock
      .mockResolvedValueOnce(json({ success: true, dry_run: true, model_count: 0, file_count: 2, dir_count: 1, total_bytes: 10, restorable: false }))
      .mockResolvedValueOnce(json({ success: true, folder: 'x' }))
    const { tools, changed } = setup()
    await expect(tools.deleteFolder('D:/loras/x', 'x')).resolves.toBe(true)
    expect(fetchMock.mock.calls).toHaveLength(2)
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ folder_path: 'D:/loras/x', dry_run: true })
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ folder_path: 'D:/loras/x' })
    expect(confirm.seen[0].danger).toBe(true)
    expect(confirm.seen[0].message).toMatch(/2 files/)
    expect(changed).toHaveBeenCalled()
  })

  it('a folder with models is refused without a confirm or a real delete', async () => {
    const confirm = autoConfirm(true)
    stopConfirm = confirm.stop
    fetchMock.mockResolvedValueOnce(json({ success: false, code: 'not_empty', error: 'x', manifest: { model_count: 3 } }, 409))
    const { tools } = setup()
    await expect(tools.deleteFolder('D:/loras/x', 'x')).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(confirm.seen).toHaveLength(0)
    expect(toasts.toasts.value.at(-1)?.message).toMatch(/3 models/)
  })

  it('a cancelled folder delete sends only the probe', async () => {
    stopConfirm = autoConfirm(false).stop
    fetchMock.mockResolvedValueOnce(json({ success: true, dry_run: true, model_count: 0, file_count: 0, dir_count: 0, restorable: true }))
    const { tools } = setup()
    await expect(tools.deleteFolder('D:/loras/x', 'x')).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('create and rename folder validate the name locally', async () => {
    const { tools } = setup()
    await expect(tools.createFolder('D:/loras', 'a/b')).resolves.not.toBeNull()
    await expect(tools.renameFolder('D:/loras/x', '..')).resolves.not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(json({ success: true, folder: 'new', created: true }))
    await expect(tools.createFolder('D:/loras/', 'new')).resolves.toBeNull()
    expect(lastCall(fetchMock).body).toEqual({ folder_path: 'D:/loras/new' })
  })

  it('unexclude restores a model and reports it', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, message: 'restored' }))
    const { tools, changed } = setup()
    await expect(tools.unexclude(item('a'))).resolves.toBe(true)
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/unexclude', body: { file_path: 'D:/loras/a.safetensors' } })
    expect(changed).toHaveBeenCalled()
  })
})
