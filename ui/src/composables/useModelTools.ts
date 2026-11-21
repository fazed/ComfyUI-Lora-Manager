/**
 * Phase B1 model tool flows: content rating, Civitai refresh / re-link,
 * replace preview, filename template (preview -> danger confirm -> apply),
 * folder create / rename / delete (dry-run probe -> confirm -> delete),
 * unexclude and "fetch all from Civitai".
 *
 * Hooks: `updated(item)` patches one card/drawer in place, `changed()`
 * reloads the grid and folder tree (paths changed).
 */

import type { ModelApi, TemplateScope } from '@/api/endpoints'
import { ApiError } from '@/api/http'
import type { ModelItem } from '@/api/types'
import { useConfirm, useToasts } from './useFeedback'
import { parseCivitaiInput } from '@/utils/civitai'
import { formatBytes } from '@/utils/format'
import { classifyFolderProbe, nsfwLabel, summarizeTemplatePlan, validateFolderName, type TemplatePlan } from '@/utils/modelTools'
import { joinTargetPath } from '@/utils/modelActions'
import { t } from '@/i18n'

export interface ModelToolHooks {
  changed: () => void
  updated: (item: ModelItem) => void
}

const displayName = (item: ModelItem) => item.model_name || item.file_name
const message = (error: unknown) => (error as Error)?.message || t('common.error')

/** Busts the browser cache of a replaced preview (same URL, new bytes). */
export function cacheBusted(url: string): string {
  if (!url) return url
  return `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`
}

export function useModelTools(api: ModelApi, hooks: ModelToolHooks) {
  const toasts = useToasts()
  const { confirm } = useConfirm()

  async function setNsfwLevel(item: ModelItem, level: number): Promise<boolean> {
    try {
      await api.setNsfwLevel(item.file_path, level)
    } catch (error) {
      toasts.error(t('tools.nsfw.failed', { error: message(error) }))
      return false
    }
    hooks.updated({ ...item, preview_nsfw_level: level })
    toasts.success(t('tools.nsfw.done', { name: displayName(item), level: nsfwLabel(level) }))
    return true
  }

  async function refreshFromCivitai(item: ModelItem): Promise<boolean> {
    const ok = await confirm({
      title: t('tools.refresh.title', { name: displayName(item) }),
      message: t('tools.refresh.message'),
      confirmLabel: t('tools.refresh.confirm'),
    })
    if (!ok) return false
    try {
      const response = await api.fetchCivitai(item.file_path)
      hooks.updated({ ...item, ...(response.metadata ?? {}) } as ModelItem)
      toasts.success(t('tools.refresh.done', { name: displayName(item) }))
      return true
    } catch (error) {
      // A failed sync still returns the refreshed entry (HTTP 200, success: false).
      const metadata = error instanceof ApiError ? (error.payload as { metadata?: Partial<ModelItem> } | null)?.metadata : null
      if (metadata) hooks.updated({ ...item, ...metadata } as ModelItem)
      toasts.error(t('tools.refresh.failed', { error: message(error) }))
      return false
    }
  }

  /** Returns null on success, otherwise the message for the dialog. */
  async function relink(item: ModelItem, input: string): Promise<string | null> {
    const target = parseCivitaiInput(input)
    if (!target?.modelId) return t('tools.relink.invalid')
    try {
      const response = await api.relinkCivitai(item.file_path, target.modelId, target.versionId)
      hooks.updated({ ...item, ...(response.metadata ?? {}) } as ModelItem)
    } catch (error) {
      return message(error)
    }
    toasts.success(t('tools.relink.done', { name: displayName(item) }))
    return null
  }

  /** Returns null on success, otherwise the message for the dialog. */
  async function replacePreview(item: ModelItem, source: { file?: File | null; url?: string }, level: number): Promise<string | null> {
    try {
      const response = source.file
        ? await api.replacePreview(item.file_path, source.file, level)
        : await api.setPreviewFromUrl(item.file_path, (source.url ?? '').trim(), level)
      hooks.updated({
        ...item,
        preview_url: cacheBusted(response.preview_url || item.preview_url),
        preview_nsfw_level: response.preview_nsfw_level ?? level,
      })
    } catch (error) {
      return message(error)
    }
    toasts.success(t('tools.preview.done', { name: displayName(item) }))
    return null
  }

  async function previewTemplate(scope: TemplateScope): Promise<TemplatePlan | null> {
    try {
      return summarizeTemplatePlan(await api.filenameTemplatePreview(scope))
    } catch (error) {
      toasts.error(t('tools.template.previewFailed', { error: message(error) }))
      return null
    }
  }

  async function applyTemplate(scope: TemplateScope, plan: TemplatePlan): Promise<boolean> {
    const count = plan.renames.length
    if (!count) {
      toasts.push(t('tools.template.nothing'), 'info')
      return false
    }
    const ok = await confirm({
      title: t('tools.template.confirmTitle'),
      message: t('tools.template.confirmMessage', { count, files: count === 1 ? 'file' : 'files', template: plan.template ?? '' }),
      confirmLabel: t('tools.template.confirmLabel', { count }),
      danger: true,
    })
    if (!ok) return false
    try {
      const response = await api.filenameTemplateApply(scope)
      const summary = response.summary ?? {}
      const failed = summary.failures ?? 0
      const text = t('tools.template.done', { renamed: summary.success ?? 0, skipped: summary.skipped ?? 0, failed })
      if (failed) toasts.warning(text)
      else toasts.success(text)
      return true
    } catch (error) {
      toasts.error(t('tools.template.failed', { error: message(error) }))
      return false
    } finally {
      hooks.changed()
    }
  }

  /** Returns null on success, otherwise the message for the dialog. */
  async function createFolder(parentPath: string, name: string): Promise<string | null> {
    const invalid = validateFolderName(name)
    if (invalid) return t(invalid)
    try {
      const response = await api.createFolder(joinTargetPath(parentPath, name.trim()))
      if (response.created === false) toasts.push(t('folders.createExists', { name: name.trim() }), 'info')
      else toasts.success(t('folders.created', { name: name.trim() }))
    } catch (error) {
      return message(error)
    }
    hooks.changed()
    return null
  }

  async function renameFolder(folderPath: string, name: string): Promise<string | null> {
    const invalid = validateFolderName(name)
    if (invalid) return t(invalid)
    try {
      await api.renameFolder(folderPath, name.trim())
    } catch (error) {
      return message(error)
    }
    toasts.success(t('folders.renamed', { name: name.trim() }))
    hooks.changed()
    return null
  }

  async function deleteFolder(folderPath: string, label: string): Promise<boolean> {
    let probe
    try {
      probe = await api.deleteFolder(folderPath, true)
    } catch (error) {
      toasts.error(t('folders.deleteFailed', { error: message(error) }))
      return false
    }
    const kind = classifyFolderProbe(probe)
    if (kind === 'notEmpty') {
      const count = probe.manifest?.model_count ?? probe.model_count ?? 0
      toasts.error(t('folders.notEmpty', { name: label, count }))
      return false
    }
    if (kind !== 'empty' && kind !== 'leftovers') {
      toasts.error(t(`folders.refused.${kind}`, { name: label, error: probe.error ?? '' }))
      return false
    }
    const files = probe.file_count ?? 0
    const ok = await confirm({
      title: t('folders.deleteTitle', { name: label }),
      message:
        kind === 'empty'
          ? t('folders.deleteEmpty', { path: folderPath })
          : t('folders.deleteLeftovers', {
              path: folderPath,
              count: files,
              files: files === 1 ? 'file' : 'files',
              size: formatBytes(probe.total_bytes ?? 0),
            }),
      confirmLabel: t('folders.deleteConfirm'),
      danger: true,
    })
    if (!ok) return false
    try {
      const result = await api.deleteFolder(folderPath)
      if (!result.success) throw new Error(result.error || t('common.error'))
    } catch (error) {
      toasts.error(t('folders.deleteFailed', { error: message(error) }))
      return false
    }
    toasts.success(t('folders.deleted', { name: label }))
    hooks.changed()
    return true
  }

  async function unexclude(item: ModelItem): Promise<boolean> {
    try {
      await api.unexclude(item.file_path)
    } catch (error) {
      toasts.error(t('tools.excluded.failed', { error: message(error) }))
      return false
    }
    toasts.success(t('actions.exclude.restored', { name: displayName(item) }))
    hooks.changed()
    return true
  }

  async function fetchAll(typeLabel: string): Promise<boolean> {
    const ok = await confirm({
      title: t('tools.fetchAll.title', { type: typeLabel }),
      message: t('tools.fetchAll.message', { type: typeLabel }),
      confirmLabel: t('tools.fetchAll.confirm'),
    })
    if (!ok) return false
    toasts.push(t('tools.fetchAll.running', { type: typeLabel }), 'info', 5000)
    try {
      const result = await api.fetchAllCivitai()
      toasts.success(
        t('tools.fetchAll.done', { updated: result.updated ?? 0, processed: result.processed ?? 0, failed: result.failure_count ?? 0 }),
      )
      return true
    } catch (error) {
      toasts.error(t('tools.fetchAll.failed', { error: message(error) }))
      return false
    } finally {
      hooks.changed()
    }
  }

  return {
    setNsfwLevel,
    refreshFromCivitai,
    relink,
    replacePreview,
    previewTemplate,
    applyTemplate,
    createFolder,
    renameFolder,
    deleteFolder,
    unexclude,
    fetchAll,
  }
}

export type ModelTools = ReturnType<typeof useModelTools>
