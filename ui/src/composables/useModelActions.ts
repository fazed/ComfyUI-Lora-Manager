/**
 * Model management flows shared by the library page, cards, drawer and the
 * selection toolbar: delete (confirm + Undo toast), rename, move, exclude
 * (with Undo through unexclude) and bulk add-tags.
 *
 * Every destructive request goes through a confirm dialog first (except
 * rename and move, whose dialogs are the explicit confirmation). The page
 * passes two hooks: `removed(paths)` drops cards at once, `changed()` reloads
 * the grid (after rename/move/undo, whose new paths come from the backend).
 */

import { undoDelete, type ModelApi } from '@/api/endpoints'
import { ApiError } from '@/api/http'
import type { ModelItem } from '@/api/types'
import { useConfirm, useToasts } from './useFeedback'
import {
  relativeFolder,
  summarizeBulkDelete,
  summarizeBulkMove,
  undoBatchIds,
  validateFileName,
  type MoveSummary,
} from '@/utils/modelActions'
import { formatBytes } from '@/utils/format'
import { t } from '@/i18n'

/** Backend undo window (PENDING_DELETE_TTL_SECONDS in py/services/pending_delete_service.py). */
export const UNDO_WINDOW_SECONDS = 20
/** The Undo button disappears a little before the backend purges, so a late click never races the purge. */
export const UNDO_TOAST_MS = (UNDO_WINDOW_SECONDS - 2) * 1000

export interface ModelActionHooks {
  /** The cards of these file paths are gone (delete, exclude). */
  removed: (paths: string[]) => void
  /** Reload the grid (rename, move, undo, tags). */
  changed: () => void
  /** Models that now live at a new path (move), so an open drawer can follow them. */
  moved?: (moves: { from: string; to: string }[]) => void
}

/** One local file of a specific version (drawer Versions tab, Old versions view). */
export interface VersionFileTarget {
  filePath: string
  fileName: string
  folder: string
  sizeBytes: number | null
  versionName: string | null
}

const displayName = (item: ModelItem) => item.model_name || item.file_name
const message = (error: unknown) => (error as Error)?.message || t('common.error')

export function useModelActions(api: ModelApi, hooks: ModelActionHooks) {
  const toasts = useToasts()
  const { confirm } = useConfirm()

  async function undo(batchIds: string[]): Promise<boolean> {
    let restored = 0
    try {
      for (const id of batchIds) {
        await undoDelete(id)
        restored += 1
      }
      toasts.success(t('actions.undoRestored'))
      return true
    } catch (error) {
      const text = message(error)
      if (error instanceof ApiError && error.status === 404 && /expired/i.test(text)) toasts.error(t('actions.undoExpired'))
      else toasts.error(t('actions.undoFailed', { error: text }))
      return false
    } finally {
      // A partly failed multi-batch undo still restored the earlier batches.
      if (restored) hooks.changed()
    }
  }

  function undoAction(batchIds: string[]) {
    return batchIds.length ? { label: t('actions.undo'), run: () => void undo(batchIds) } : undefined
  }

  async function deleteItems(items: ModelItem[]): Promise<boolean> {
    if (!items.length) return false
    const single = items.length === 1
    const ok = await confirm({
      title: single
        ? t('actions.delete.title', { name: displayName(items[0]) })
        : t('actions.delete.bulkTitle', { count: items.length }),
      message: single
        ? t('actions.delete.message', { seconds: UNDO_WINDOW_SECONDS })
        : t('actions.delete.bulkMessage', { count: items.length, seconds: UNDO_WINDOW_SECONDS }),
      confirmLabel: single ? t('actions.delete.confirm') : t('actions.delete.bulkConfirm', { count: items.length }),
      danger: true,
    })
    if (!ok) return false

    try {
      if (single) {
        const result = await api.deleteModel(items[0].file_path)
        hooks.removed([items[0].file_path])
        const ids = undoBatchIds(result)
        const name = displayName(items[0])
        toasts.push(
          t(ids.length ? 'actions.delete.done' : 'actions.delete.donePermanent', { name }),
          'success',
          ids.length ? UNDO_TOAST_MS : 5000,
          undoAction(ids),
        )
        return true
      }
      const result = await api.bulkDelete(items.map((item) => item.file_path))
      const summary = summarizeBulkDelete(result)
      hooks.removed(summary.deleted)
      const ids = undoBatchIds(result)
      const text = summary.failed.length
        ? t('actions.delete.bulkPartial', {
            ok: summary.deleted.length,
            total: items.length,
            failed: summary.failed.length,
            error: summary.failed[0].message,
          })
        : t('actions.delete.bulkDone', { count: summary.deleted.length })
      toasts.push(text, summary.failed.length ? 'warning' : 'success', ids.length ? UNDO_TOAST_MS : 7000, undoAction(ids))
      return true
    } catch (error) {
      toasts.error(t('actions.delete.failed', { error: message(error) }))
      hooks.changed()
      return false
    }
  }

  /**
   * Delete one local file of a specific version (drawer Versions tab, Old
   * versions view). Same endpoint and staging as the card delete
   * (`POST {prefix}/delete {file_path}` -> pending-delete batch + Undo); only
   * the confirm names the version, the file, its folder and size.
   */
  async function deleteVersionFile(file: VersionFileTarget, options: { onUndone?: () => void } = {}): Promise<boolean> {
    const version = file.versionName || t('updates.unknownVersion')
    const ok = await confirm({
      title: t('versions.delete.title', { version }),
      message: [
        t('versions.delete.message', {
          file: file.fileName,
          size: file.sizeBytes ? formatBytes(file.sizeBytes) : t('versions.delete.sizeUnknown'),
          folder: file.folder || t('versions.rootFolder'),
          seconds: UNDO_WINDOW_SECONDS,
        }),
        '',
        t('versions.delete.otherFiles'),
      ].join('\n'),
      confirmLabel: t('versions.delete.confirm'),
      danger: true,
    })
    if (!ok) return false
    try {
      const result = await api.deleteModel(file.filePath)
      hooks.removed([file.filePath])
      const ids = undoBatchIds(result)
      toasts.push(
        t(ids.length ? 'versions.delete.done' : 'versions.delete.donePermanent', { version, file: file.fileName }),
        'success',
        ids.length ? UNDO_TOAST_MS : 5000,
        ids.length
          ? { label: t('actions.undo'), run: () => void undo(ids).then((restored) => restored && options.onUndone?.()) }
          : undefined,
      )
      return true
    } catch (error) {
      toasts.error(t('versions.delete.failed', { file: file.fileName, error: message(error) }))
      hooks.changed()
      return false
    }
  }

  /**
   * "Delete all older" of one model line (Old versions view): one summary
   * confirm listing every file, then the existing bulk delete
   * (`POST {prefix}/bulk-delete`, one merged undo batch).
   */
  async function deleteVersionFiles(
    files: VersionFileTarget[],
    context: { modelName: string; keptName: string },
  ): Promise<boolean> {
    if (!files.length) return false
    const filesWord = files.length === 1 ? t('replace.bulk.file') : t('replace.bulk.files')
    const total = files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0)
    const ok = await confirm({
      title: t('oldVersions.deleteAll.title', { count: files.length, files: filesWord, name: context.modelName }),
      message: t('oldVersions.deleteAll.message', {
        count: files.length,
        files: filesWord,
        size: formatBytes(total),
        list: files
          .map((file) => `- ${file.versionName || t('updates.unknownVersion')}: ${file.fileName}${file.folder ? ` (${file.folder})` : ''}`)
          .join('\n'),
        newest: context.keptName,
        seconds: UNDO_WINDOW_SECONDS,
      }),
      confirmLabel: t('oldVersions.deleteAll.confirm', { count: files.length, files: filesWord }),
      danger: true,
    })
    if (!ok) return false
    try {
      const result = await api.bulkDelete(files.map((file) => file.filePath))
      const summary = summarizeBulkDelete(result)
      hooks.removed(summary.deleted)
      const ids = undoBatchIds(result)
      const text = summary.failed.length
        ? t('oldVersions.deleteAll.partial', {
            ok: summary.deleted.length,
            total: files.length,
            failed: summary.failed.length,
            error: summary.failed[0].message,
          })
        : t('oldVersions.deleteAll.done', { count: summary.deleted.length, files: filesWord, name: context.modelName })
      toasts.push(text, summary.failed.length ? 'warning' : 'success', ids.length ? UNDO_TOAST_MS : 7000, undoAction(ids))
      return true
    } catch (error) {
      toasts.error(t('actions.delete.failed', { error: message(error) }))
      hooks.changed()
      return false
    }
  }

  /** Returns null on success, otherwise the message to show in the rename dialog. */
  async function renameItem(item: ModelItem, newName: string): Promise<string | null> {
    const name = newName.trim()
    const invalid = validateFileName(name, item.file_name)
    if (invalid) return t(invalid)
    try {
      await api.rename(item.file_path, name)
    } catch (error) {
      return message(error)
    }
    toasts.success(t('actions.rename.done', { name }))
    hooks.changed()
    return null
  }

  /** With `useDefaultPaths`, `targetPath` is a library root and the backend appends each model's template folder. */
  async function moveItems(items: ModelItem[], targetPath: string, roots: string[] = [], useDefaultPaths = false): Promise<MoveSummary> {
    let summary: MoveSummary
    try {
      if (items.length === 1) {
        const result = await api.moveModel(items[0].file_path, targetPath, useDefaultPaths)
        summary = { moved: [{ from: items[0].file_path, to: result.new_file_path || items[0].file_path }], failed: [] }
      } else {
        summary = summarizeBulkMove(await api.moveBulk(items.map((item) => item.file_path), targetPath, useDefaultPaths))
      }
    } catch (error) {
      summary = { moved: [], failed: items.map((item) => ({ path: item.file_path, message: message(error) })) }
    }

    const folder = relativeFolder(`${targetPath}/x`, roots) || targetPath
    if (summary.failed.length && summary.moved.length) {
      toasts.warning(t('actions.move.partial', { ok: summary.moved.length, total: items.length, failed: summary.failed.length }))
    } else if (summary.failed.length) {
      toasts.error(t('actions.move.failed', { error: summary.failed[0].message }))
    } else if (items.length === 1) {
      toasts.success(t('actions.move.done', { name: displayName(items[0]), folder }))
    } else {
      toasts.success(t('actions.move.bulkDone', { count: summary.moved.length, folder }))
    }
    if (summary.moved.length) {
      hooks.moved?.(summary.moved)
      hooks.changed()
    }
    return summary
  }

  async function excludeItem(item: ModelItem): Promise<boolean> {
    const name = displayName(item)
    const ok = await confirm({
      title: t('actions.exclude.title', { name }),
      message: t('actions.exclude.message'),
      confirmLabel: t('actions.exclude.confirm'),
      danger: true,
    })
    if (!ok) return false
    try {
      await api.exclude(item.file_path)
    } catch (error) {
      toasts.error(t('actions.exclude.failed', { error: message(error) }))
      return false
    }
    hooks.removed([item.file_path])
    toasts.push(t('actions.exclude.done', { name }), 'success', 10000, {
      label: t('actions.undo'),
      run: () =>
        void api
          .unexclude(item.file_path)
          .then(() => toasts.success(t('actions.exclude.restored', { name })))
          .catch((error) => toasts.error(t('actions.undoFailed', { error: message(error) })))
          .finally(() => hooks.changed()),
    })
    return true
  }

  async function addTags(items: ModelItem[], tags: string[]): Promise<{ ok: number; failed: number }> {
    let okCount = 0
    let failed = 0
    for (const item of items) {
      try {
        await api.addTags(item.file_path, tags)
        okCount += 1
      } catch {
        failed += 1
      }
    }
    if (failed) toasts.warning(t('actions.tags.partial', { ok: okCount, failed }))
    else toasts.success(t('actions.tags.done', { count: okCount }))
    hooks.changed()
    return { ok: okCount, failed }
  }

  return { deleteItems, deleteVersionFile, deleteVersionFiles, undo, renameItem, moveItems, excludeItem, addTags }
}
