/**
 * Model management actions (phase A): request builders, pure helpers and the
 * confirm / undo / rename / move flows against a mocked backend. Written
 * before the implementation; nothing here touches a real backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, watch } from 'vue'
import { setFetch } from '@/api/http'
import { createModelApi, undoDelete } from '@/api/endpoints'
import type { ModelItem } from '@/api/types'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import { UNDO_TOAST_MS, useModelActions } from '@/composables/useModelActions'
import {
  displayPath,
  flattenFolderTree,
  groupOrganizePlan,
  invertSelection,
  isOrganizeFinished,
  joinTargetPath,
  pruneSelection,
  relativeFolder,
  summarizeBulkDelete,
  summarizeBulkMove,
  undoBatchIds,
  validateFileName,
  validateNewFolder,
} from '@/utils/modelActions'
import { setBasePathsForTesting } from '@/utils/basePath'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function item(name: string, folder = ''): ModelItem {
  const dir = folder ? `D:/loras/${folder}` : 'D:/loras'
  return {
    model_name: name.toUpperCase(),
    file_name: name,
    file_path: `${dir}/${name}.safetensors`,
    folder,
    preview_url: '',
    base_model: 'SDXL',
  }
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined }
}

/** Answer the next confirm dialog with `answer` and remember its text. */
function autoConfirm(answer: boolean) {
  const { confirmState } = useConfirm()
  const seen: { title: string; message: string; confirmLabel: string; danger: boolean }[] = []
  const stop = watch(confirmState, (state) => {
    if (!state) return
    seen.push({ title: state.title, message: state.message, confirmLabel: state.confirmLabel, danger: state.danger })
    state.resolve(answer)
  })
  return { seen, stop }
}

describe('request builders', () => {
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

  it('delete posts the file path to the prefixed endpoint', async () => {
    const api = createModelApi('loras')
    await api.deleteModel('D:/loras/a.safetensors')
    expect(lastCall(fetchMock)).toEqual({ url: '/api/lm/loras/delete', method: 'POST', body: { file_path: 'D:/loras/a.safetensors' } })
  })

  it('bulk delete, rename, move, bulk move, exclude, unexclude and add-tags', async () => {
    const api = createModelApi('checkpoints')
    await api.bulkDelete(['a', 'b'])
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/checkpoints/bulk-delete', body: { file_paths: ['a', 'b'] } })
    await api.rename('D:/c/x.safetensors', 'y')
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/checkpoints/rename', body: { file_path: 'D:/c/x.safetensors', new_file_name: 'y' } })
    await api.moveModel('D:/c/x.safetensors', 'D:/c/sub')
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/checkpoints/move_model', body: { file_path: 'D:/c/x.safetensors', target_path: 'D:/c/sub' } })
    await api.moveBulk(['a', 'b'], 'D:/c/sub')
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/checkpoints/move_models_bulk', body: { file_paths: ['a', 'b'], target_path: 'D:/c/sub' } })
    await api.exclude('a')
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/checkpoints/exclude', body: { file_path: 'a' } })
    await api.unexclude('a')
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/checkpoints/unexclude', body: { file_path: 'a' } })
    await api.addTags('a', ['x', 'y'])
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/checkpoints/add-tags', body: { file_path: 'a', tags: ['x', 'y'] } })
    // None of them may ask for default-path organisation.
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(String(init.body)).not.toContain('use_default_paths')
    }
  })

  it('auto-organize preview is a GET with dry_run=true; the real run is a POST without dry_run', async () => {
    const api = createModelApi('embeddings')
    await api.autoOrganizePreview()
    expect(lastCall(fetchMock)).toEqual({ url: '/api/lm/embeddings/auto-organize?dry_run=true', method: 'GET', body: undefined })
    await api.autoOrganizeRun()
    const run = lastCall(fetchMock)
    expect(run.url).toBe('/api/lm/embeddings/auto-organize')
    expect(run.method).toBe('POST')
    expect(run.body).toEqual({})
  })

  it('auto-organize progress maps the "nothing running" 404 to null', async () => {
    const api = createModelApi('loras')
    fetchMock.mockResolvedValueOnce(json({ success: false, error: 'No auto-organize operation in progress' }, 404))
    await expect(api.autoOrganizeProgress()).resolves.toBeNull()
    fetchMock.mockResolvedValueOnce(json({ success: true, progress: { status: 'processing', processed: 2, total: 5 } }))
    await expect(api.autoOrganizeProgress()).resolves.toMatchObject({ status: 'processing', processed: 2 })
    expect(lastCall(fetchMock).url).toBe('/api/lm/loras/auto-organize-progress')
  })

  it('undo-delete posts the batch id to the shared endpoint', async () => {
    await undoDelete('0123456789abcdef0123456789abcdef')
    expect(lastCall(fetchMock)).toEqual({
      url: '/api/lm/undo-delete',
      method: 'POST',
      body: { batch_id: '0123456789abcdef0123456789abcdef' },
    })
  })
})

describe('pure helpers', () => {
  it('validates file names like the backend (and a bit stricter)', () => {
    expect(validateFileName('new-name', 'old')).toBeNull()
    expect(validateFileName('  ', 'old')).toBe('actions.rename.errorEmpty')
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(validateFileName(bad, 'old')).toBe('actions.rename.errorChars')
    }
    expect(validateFileName('old', 'old')).toBe('actions.rename.errorUnchanged')
    expect(validateFileName('name.', 'old')).toBe('actions.rename.errorTrailing')
    expect(validateFileName('x'.repeat(201), 'old')).toBe('actions.rename.errorLength')
  })

  it('collects undo batch ids from either response shape', () => {
    expect(undoBatchIds({ batch_id: 'a' })).toEqual(['a'])
    expect(undoBatchIds({ batch_id: null, batch_ids: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(undoBatchIds({ batch_id: null })).toEqual([])
    expect(undoBatchIds({})).toEqual([])
  })

  it('summarises bulk move and bulk delete responses', () => {
    const move = summarizeBulkMove({
      success: true,
      results: [
        { original_file_path: 'a', new_file_path: 'x/a', success: true, message: 'ok' },
        { original_file_path: 'b', new_file_path: null, success: false, message: 'Failed to move model' },
      ],
    })
    expect(move.moved).toEqual([{ from: 'a', to: 'x/a' }])
    expect(move.failed).toEqual([{ path: 'b', message: 'Failed to move model' }])

    const del = summarizeBulkDelete({
      success: true,
      total_deleted: 1,
      results: [
        { file_path: 'a', success: true },
        { file_path: 'b', success: false, error: 'No files deleted' },
      ],
    })
    expect(del.deleted).toEqual(['a'])
    expect(del.failed).toEqual([{ path: 'b', message: 'No files deleted' }])
  })

  it('builds target paths and relative folders with forward slashes', () => {
    expect(joinTargetPath('D:\\models\\loras\\', 'a/b/')).toBe('D:/models/loras/a/b')
    expect(joinTargetPath('D:/models/loras', '')).toBe('D:/models/loras')
    expect(relativeFolder('D:/models/loras/a/b/x.safetensors', ['D:/models/loras'])).toBe('a/b')
    expect(relativeFolder('D:/models/loras/x.safetensors', ['D:\\models\\loras'])).toBe('')
    expect(displayPath('D:/models/loras/a/x.safetensors', ['D:/models/loras'])).toBe('a/x.safetensors')
    expect(displayPath('E:/other/x.safetensors', ['D:/models/loras'])).toBe('E:/other/x.safetensors')
  })

  it('validates a new folder typed into the move dialog', () => {
    expect(validateNewFolder('')).toBeNull()
    expect(validateNewFolder('styles/anime')).toBeNull()
    expect(validateNewFolder('../escape')).toBe('actions.move.errorFolder')
    expect(validateNewFolder('C:/abs')).toBe('actions.move.errorFolder')
    expect(validateNewFolder('/abs')).toBe('actions.move.errorFolder')
    expect(validateNewFolder('bad|name')).toBe('actions.move.errorFolder')
    expect(validateNewFolder('a//b')).toBe('actions.move.errorFolder')
  })

  it('flattens a folder tree in display order', () => {
    expect(flattenFolderTree({ b: {}, a: { y: {}, x: {} } })).toEqual(['a', 'a/x', 'a/y', 'b'])
  })

  it('inverts and prunes selections', () => {
    const keys = ['a', 'b', 'c']
    expect([...invertSelection(new Set(['a']), keys)]).toEqual(['b', 'c'])
    expect([...pruneSelection(new Set(['a', 'b']), ['a'])]).toEqual(['b'])
  })

  it('groups an auto-organize dry run into moves, skipped and issues', () => {
    const plan = groupOrganizePlan({
      success: true,
      dry_run: true,
      summary: { total: 4, success: 1, skipped: 2, failures: 1, path_template: '{base_model}', organization_type: 'structured' },
      planned_moves: [{ model: 'A', from: 'D:/l/a.safetensors', to: 'D:/l/SDXL/a.safetensors', status: 'planned_move', reason: 'path_template' }],
      results: [
        { model: 'B', success: false, status: 'skipped', reason: 'already_organized', message: 'Already in the correct location' },
        { model: 'C', success: false, status: 'skipped', reason: 'missing_metadata', message: 'Skipped - insufficient metadata' },
        { model: 'D', success: false, status: 'issue', reason: 'target_exists', message: 'Target file already exists' },
      ],
    })
    expect(plan.moves).toHaveLength(1)
    expect(plan.alreadyOrganized).toBe(1)
    expect(plan.skipped.map((entry) => entry.model)).toEqual(['C'])
    expect(plan.issues.map((entry) => entry.model)).toEqual(['D'])
    expect(plan.template).toBe('{base_model}')
  })

  it('recognises finished auto-organize progress', () => {
    expect(isOrganizeFinished(null)).toBe(false)
    expect(isOrganizeFinished({ status: 'processing' })).toBe(false)
    for (const status of ['completed', 'error', 'cancelled']) expect(isOrganizeFinished({ status })).toBe(true)
  })
})

describe('useModelActions flows (mocked backend)', () => {
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
    const removed = vi.fn()
    const changed = vi.fn()
    const actions = useModelActions(createModelApi('loras'), { removed, changed })
    return { actions, removed, changed }
  }

  it('cancelling the delete confirm sends nothing', async () => {
    const confirm = autoConfirm(false)
    stopConfirm = confirm.stop
    const { actions, removed } = setup()
    await expect(actions.deleteItems([item('a')])).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(removed).not.toHaveBeenCalled()
    expect(confirm.seen[0].danger).toBe(true)
    expect(confirm.seen[0].message).toContain('A')
  })

  it('a confirmed single delete removes the card and offers Undo for the backend window', async () => {
    const confirm = autoConfirm(true)
    stopConfirm = confirm.stop
    fetchMock.mockResolvedValueOnce(json({ success: true, batch_id: 'b'.repeat(32), deleted_files: [] }))
    const { actions, removed, changed } = setup()
    await expect(actions.deleteItems([item('a')])).resolves.toBe(true)
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/delete', body: { file_path: 'D:/loras/a.safetensors' } })
    expect(removed).toHaveBeenCalledWith(['D:/loras/a.safetensors'])
    expect(confirm.seen[0].message).toMatch(/20 seconds/)

    const toast = toasts.toasts.value.at(-1)!
    expect(toast.action?.label).toBe('Undo')
    expect(UNDO_TOAST_MS).toBeLessThanOrEqual(20000)

    fetchMock.mockResolvedValueOnce(json({ success: true, restored: ['D:/loras/a.safetensors'], kind: 'model' }))
    toast.action!.run()
    await vi.waitFor(() => expect(changed).toHaveBeenCalled())
    expect(lastCall(fetchMock)).toEqual({ url: '/api/lm/undo-delete', method: 'POST', body: { batch_id: 'b'.repeat(32) } })
    expect(toasts.toasts.value.at(-1)?.kind).toBe('success')
  })

  it('a hard delete without batch id shows no Undo button', async () => {
    stopConfirm = autoConfirm(true).stop
    fetchMock.mockResolvedValueOnce(json({ success: true, batch_id: null, deleted_files: ['x'] }))
    const { actions } = setup()
    await actions.deleteItems([item('a')])
    expect(toasts.toasts.value.at(-1)?.action).toBeUndefined()
  })

  it('an expired undo reports that the window has passed', async () => {
    stopConfirm = autoConfirm(true).stop
    fetchMock.mockResolvedValueOnce(json({ success: false, error: 'Undo window expired' }, 404))
    const { actions, changed } = setup()
    await expect(actions.undo(['c'.repeat(32)])).resolves.toBe(false)
    expect(changed).not.toHaveBeenCalled()
    const toast = toasts.toasts.value.at(-1)!
    expect(toast.kind).toBe('error')
    expect(toast.message).toMatch(/expired/i)
  })

  it('bulk delete shows the count in the confirm and reports partial failures', async () => {
    const confirm = autoConfirm(true)
    stopConfirm = confirm.stop
    fetchMock.mockResolvedValueOnce(
      json({
        success: true,
        total_deleted: 2,
        total_attempted: 3,
        batch_id: 'd'.repeat(32),
        results: [
          { file_path: 'D:/loras/a.safetensors', success: true },
          { file_path: 'D:/loras/b.safetensors', success: true },
          { file_path: 'D:/loras/c.safetensors', success: false, error: 'No files deleted' },
        ],
      }),
    )
    const { actions, removed } = setup()
    await actions.deleteItems([item('a'), item('b'), item('c')])
    expect(confirm.seen[0].title).toMatch(/3/)
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/bulk-delete' })
    expect(removed).toHaveBeenCalledWith(['D:/loras/a.safetensors', 'D:/loras/b.safetensors'])
    const toast = toasts.toasts.value.at(-1)!
    expect(toast.kind).toBe('warning')
    expect(toast.message).toMatch(/2 of 3/)
    expect(toast.action?.label).toBe('Undo')
  })

  it('rename validates locally before calling the backend and surfaces backend errors', async () => {
    const { actions, changed } = setup()
    await expect(actions.renameItem(item('a'), 'bad:name')).resolves.toMatch(/not allowed/i)
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(json({ success: false, error: 'A file with this name already exists' }, 400))
    await expect(actions.renameItem(item('a'), 'taken')).resolves.toBe('A file with this name already exists')
    expect(changed).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(json({ success: true, new_file_path: 'D:/loras/b.safetensors' }))
    await expect(actions.renameItem(item('a'), 'b')).resolves.toBeNull()
    expect(changed).toHaveBeenCalled()
  })

  it('a single move refreshes the grid and reports success', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, original_file_path: 'D:/loras/a.safetensors', new_file_path: 'D:/loras/x/a.safetensors' }))
    const moved = vi.fn()
    const changed = vi.fn()
    const actions = useModelActions(createModelApi('loras'), { removed: vi.fn(), changed, moved })
    const summary = await actions.moveItems([item('a')], 'D:/loras/x')
    // An open drawer follows the model to its new path.
    expect(moved).toHaveBeenCalledWith([{ from: 'D:/loras/a.safetensors', to: 'D:/loras/x/a.safetensors' }])
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/move_model', body: { target_path: 'D:/loras/x' } })
    expect(summary.moved).toHaveLength(1)
    expect(summary.failed).toHaveLength(0)
    expect(changed).toHaveBeenCalled()
  })

  it('a bulk move with failures returns them and warns', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        success: true,
        success_count: 1,
        failure_count: 1,
        results: [
          { original_file_path: 'D:/loras/a.safetensors', new_file_path: 'D:/loras/x/a.safetensors', success: true, message: 'ok' },
          { original_file_path: 'D:/loras/b.safetensors', new_file_path: null, success: false, message: 'Failed to move model' },
        ],
      }),
    )
    const { actions, changed } = setup()
    const summary = await actions.moveItems([item('a'), item('b')], 'D:/loras/x')
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/move_models_bulk' })
    expect(summary.failed).toEqual([{ path: 'D:/loras/b.safetensors', message: 'Failed to move model' }])
    expect(changed).toHaveBeenCalled()
    expect(toasts.toasts.value.at(-1)?.kind).toBe('warning')
  })

  it('exclude asks first and offers Undo through unexclude', async () => {
    stopConfirm = autoConfirm(true).stop
    fetchMock.mockResolvedValueOnce(json({ success: true, message: 'excluded' }))
    const { actions, removed, changed } = setup()
    await expect(actions.excludeItem(item('a'))).resolves.toBe(true)
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/exclude' })
    expect(removed).toHaveBeenCalledWith(['D:/loras/a.safetensors'])
    fetchMock.mockResolvedValueOnce(json({ success: true }))
    toasts.toasts.value.at(-1)!.action!.run()
    await vi.waitFor(() => expect(changed).toHaveBeenCalled())
    expect(lastCall(fetchMock)).toMatchObject({ url: '/api/lm/loras/unexclude', body: { file_path: 'D:/loras/a.safetensors' } })
  })

  it('bulk add-tags sends one request per model and counts failures', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ success: true, tags: ['x'] }))
      .mockResolvedValueOnce(json({ success: false, error: 'Model file no longer exists' }, 409))
    const { actions, changed } = setup()
    const result = await actions.addTags([item('a'), item('b')], ['x'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ ok: 1, failed: 1 })
    expect(changed).toHaveBeenCalled()
    await nextTick()
  })
})
