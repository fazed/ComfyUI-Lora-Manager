/**
 * State of the (batch) download dialog:
 *
 *   input --start(text)--> review (rows resolve 2 at a time) --submit()--> review + summary
 *
 * One entry is simply a batch of one. Resolving only uses read-only GETs
 * (civitai/versions, civitai/model/version); one versions lookup per model is
 * shared by all its rows. Submitting adds one queue row per selected row
 * (`downloads/queue/add`, sequentially); the queue worker starts them. Rows
 * that were added are locked, failed ones stay selected so pressing Add again
 * retries only those. Nothing here calls the blocking `download-model`.
 */

import { computed, ref, shallowRef } from 'vue'
import { createModelApi, downloadsApi } from '@/api/endpoints'
import type { CivitaiVersion, FolderTree, ModelPrefix, QueueItem, SettingsMap } from '@/api/types'
import {
  applyResolveError,
  applyResolved,
  applySubmitOutcome,
  chooseFile,
  chooseVersion,
  createRow,
  describeResolveError,
  parseBatchInput,
  rowIdentity,
  runLimited,
  selectedVersionOf,
  submittableRows,
  summarize,
  toggleRow,
  type BatchRow,
  type BatchSummary,
} from '@/utils/batchDownload'
import { destinationParams, filePayload, singularOf, targetPreview, versionThumbnail, weightFiles } from '@/utils/downloads'
import { flattenFolderTree, validateNewFolder } from '@/utils/modelActions'
import { readStorage, writeStorage } from '@/utils/storage'
import { t } from '@/i18n'

export type BatchStep = 'input' | 'review'

export interface BatchDownloadOptions {
  /** Current queue rows (to flag versions that are already queued). */
  queue: () => QueueItem[]
  settings: () => SettingsMap | null | undefined
  /** Lookups in flight at once (default 2, gentle on Civitai). */
  concurrency?: number
}

const message = (error: unknown) => (error as Error)?.message || t('common.error')

export function useBatchDownload(prefix: ModelPrefix, options: BatchDownloadOptions) {
  const api = createModelApi(prefix)
  const singular = singularOf(prefix)
  const storageKey = `lm-ui.download.useDefaultPath.${prefix}`
  const concurrency = options.concurrency ?? 2

  const step = ref<BatchStep>('input')
  const error = ref<string | null>(null)
  const rows = shallowRef<BatchRow[]>([])
  const invalid = ref<string[]>([])
  const duplicatesDropped = ref(0)
  const running = ref(false)
  const submitting = ref(false)
  const progress = ref({ done: 0, total: 0 })
  const summary = ref<BatchSummary | null>(null)

  const roots = ref<string[]>([])
  const root = ref('')
  const tree = ref<FolderTree>({})
  const folder = ref('')
  const useDefaultPath = ref(readStorage(storageKey) === 'true')

  let controller: AbortController | null = null
  const versionsCache = new Map<number, Promise<CivitaiVersion[]>>()
  const nameCache = new Map<number, Promise<string>>()

  const resolving = computed(() => running.value)
  const resolvedCount = computed(() => rows.value.filter((row) => row.phase === 'ready' || row.phase === 'error').length)
  const readyCount = computed(() => rows.value.filter((row) => row.phase === 'ready').length)
  const errorCount = computed(() => rows.value.filter((row) => row.phase === 'error').length)
  const selectedCount = computed(() => submittableRows(rows.value).length)
  const defaultRoot = computed(() => String(options.settings()?.[`default_${singular}_root`] ?? ''))
  const template = computed(() => {
    const templates = options.settings()?.download_path_templates
    return templates && typeof templates === 'object' ? String((templates as Record<string, unknown>)[singular] ?? '') : ''
  })
  const folders = computed(() => flattenFolderTree(tree.value))
  const folderError = computed(() => {
    if (useDefaultPath.value) return null
    const key = validateNewFolder(folder.value)
    return key ? t(key) : null
  })
  const preview = computed(() =>
    root.value ? targetPreview({ root: root.value, folder: folder.value, useDefaultPath: useDefaultPath.value }, template.value) : '',
  )

  function update(key: string, change: (row: BatchRow) => BatchRow): void {
    rows.value = rows.value.map((row) => (row.key === key ? change(row) : row))
  }
  function find(key: string): BatchRow | undefined {
    return rows.value.find((row) => row.key === key)
  }
  /** Version + file already claimed by another selected row. */
  function takenBy(key: string): Set<string> {
    return new Set(rows.value.filter((row) => row.key !== key && row.phase === 'ready' && row.selected).map(rowIdentity))
  }

  function versionsOf(modelId: number, signal: AbortSignal): Promise<CivitaiVersion[]> {
    let pending = versionsCache.get(modelId)
    if (!pending) {
      pending = api.civitaiVersions(modelId, signal)
      versionsCache.set(modelId, pending)
      pending.catch(() => versionsCache.delete(modelId))
    }
    return pending
  }
  function nameOf(modelId: number, versionId: number, signal: AbortSignal): Promise<string> {
    let pending = nameCache.get(modelId)
    if (!pending) {
      // Model name only; a failure just leaves the fallback label.
      pending = api
        .civitaiVersionInfo(versionId, signal)
        .then((info) => info.model?.name ?? '')
        .catch(() => '')
      nameCache.set(modelId, pending)
    }
    return pending
  }

  async function resolveRow(key: string, signal: AbortSignal): Promise<void> {
    const row = find(key)
    if (!row || signal.aborted) return
    update(key, (current) => ({ ...current, phase: 'resolving', error: null }))
    const check = () => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    }
    try {
      const target = row.target
      let modelId = target.modelId
      let modelName = ''
      if (modelId == null && target.versionId != null) {
        const info = await api.civitaiVersionInfo(target.versionId, signal)
        check()
        modelId = info.modelId ?? null
        modelName = info.model?.name ?? ''
        if (modelId != null && modelName && !nameCache.has(modelId)) nameCache.set(modelId, Promise.resolve(modelName))
      }
      if (modelId == null) throw new Error(t('download.notFound'))
      const versions = await versionsOf(modelId, signal)
      check()
      if (!Array.isArray(versions) || !versions.length) throw new Error(t('download.noVersions'))
      if (target.versionId != null && !versions.some((entry) => entry.id === target.versionId)) {
        throw new Error(t('download.versionMissing', { id: target.versionId }))
      }
      if (!modelName) modelName = await nameOf(modelId, target.versionId ?? versions[0].id, signal)
      check()
      const resolvedId = modelId
      update(key, (current) =>
        applyResolved(current, { modelId: resolvedId, modelName, versions }, { queue: options.queue(), taken: takenBy(key) }),
      )
    } catch (failure) {
      update(key, (current) => applyResolveError(current, describeResolveError(failure)))
    }
  }

  async function resolvePending(): Promise<void> {
    controller?.abort()
    const own = new AbortController()
    controller = own
    running.value = true
    try {
      const keys = rows.value.filter((row) => row.phase === 'pending').map((row) => row.key)
      await runLimited(keys, concurrency, (key) => resolveRow(key, own.signal), own.signal)
    } finally {
      if (own.signal.aborted) {
        // Rows that never started become retryable.
        for (const row of rows.value) {
          if (row.phase === 'pending' || row.phase === 'resolving') update(row.key, (current) => applyResolveError(current, t('download.batch.err.stopped')))
        }
      }
      if (controller === own) {
        controller = null
        running.value = false
      }
    }
  }

  async function loadTree(): Promise<void> {
    if (!root.value) return
    try {
      tree.value = await api.rootFolderTree(root.value)
    } catch {
      tree.value = {}
    }
  }

  async function loadLocation(): Promise<void> {
    if (roots.value.length) return
    try {
      roots.value = await api.roots()
      root.value = roots.value.includes(defaultRoot.value) ? defaultRoot.value : (roots.value[0] ?? '')
      folder.value = ''
      await loadTree()
    } catch (failure) {
      error.value = message(failure)
    }
  }

  async function setRoot(value: string): Promise<void> {
    root.value = value
    folder.value = ''
    await loadTree()
  }

  /** Parses the text and resolves every entry. Stays on the input step when nothing is usable. */
  async function start(text: string): Promise<void> {
    stop()
    error.value = null
    summary.value = null
    progress.value = { done: 0, total: 0 }
    const parsed = parseBatchInput(text)
    invalid.value = parsed.invalid
    duplicatesDropped.value = parsed.duplicates
    if (!parsed.entries.length) {
      error.value = t('download.invalid')
      rows.value = []
      return
    }
    rows.value = parsed.entries.map(createRow)
    step.value = 'review'
    await Promise.all([loadLocation(), resolvePending()])
  }

  function stop(): void {
    controller?.abort()
  }

  async function retryRow(key: string): Promise<void> {
    const row = find(key)
    if (!row || row.phase !== 'error') return
    update(key, (current) => ({ ...createRow({ key: current.key, raw: current.raw, target: current.target }) }))
    if (!running.value) await resolvePending()
    else void resolveRow(key, controller!.signal)
  }

  async function retryErrors(): Promise<void> {
    if (running.value) return
    rows.value = rows.value.map((row) => (row.phase === 'error' ? createRow({ key: row.key, raw: row.raw, target: row.target }) : row))
    await resolvePending()
  }

  function removeRow(key: string): void {
    if (submitting.value) return
    rows.value = rows.value.filter((row) => row.key !== key)
  }

  function clearInvalid(): void {
    invalid.value = []
  }

  function toggle(key: string, selected?: boolean): void {
    if (submitting.value) return
    update(key, (row) => toggleRow(row, selected))
  }

  function selectAll(selected: boolean): void {
    if (submitting.value) return
    rows.value = rows.value.map((row) => toggleRow(row, selected))
  }

  function setVersion(key: string, versionId: number): void {
    if (submitting.value) return
    update(key, (row) => chooseVersion(row, versionId, options.queue(), takenBy(key)))
  }

  function setFile(key: string, fileId: number): void {
    if (submitting.value) return
    update(key, (row) => chooseFile(row, fileId, options.queue(), takenBy(key)))
  }

  async function submit(): Promise<BatchSummary | null> {
    if (submitting.value || !root.value || folderError.value) return null
    const plan = submittableRows(rows.value)
    if (!plan.length) return null
    submitting.value = true
    error.value = null
    progress.value = { done: 0, total: plan.length }
    const destination = destinationParams(
      { root: root.value, folder: folder.value, useDefaultPath: useDefaultPath.value },
      defaultRoot.value,
    )
    try {
      for (const row of plan) {
        update(row.key, (current) => ({ ...current, submit: 'submitting', submitError: null }))
        const version = selectedVersionOf(row)
        const file = version && row.fileId != null ? weightFiles(version).find((entry) => entry.id === row.fileId) : null
        try {
          const response = await downloadsApi.add({
            modelId: row.modelId,
            versionId: row.versionId,
            fileParams: file ? filePayload(file) : null,
            destination,
            modelName: row.modelName,
            versionName: version?.name,
            thumbnailUrl: version ? versionThumbnail(version) : '',
          })
          update(row.key, (current) => applySubmitOutcome(current, { queued: !!response.queued, duplicate: !!response.duplicate }))
        } catch (failure) {
          update(row.key, (current) => applySubmitOutcome(current, { error: message(failure) }))
        }
        progress.value = { done: progress.value.done + 1, total: plan.length }
      }
      writeStorage(storageKey, String(useDefaultPath.value))
      summary.value = summarize(rows.value)
      return summary.value
    } finally {
      submitting.value = false
    }
  }

  /** Back to the text input (lookups stop; the rows are dropped). */
  function back(): void {
    if (submitting.value) return
    stop()
    rows.value = []
    invalid.value = []
    summary.value = null
    error.value = null
    step.value = 'input'
  }

  return {
    step,
    error,
    rows,
    invalid,
    duplicatesDropped,
    resolving,
    resolvedCount,
    readyCount,
    errorCount,
    selectedCount,
    submitting,
    progress,
    summary,
    roots,
    root,
    folder,
    folders,
    useDefaultPath,
    defaultRoot,
    template,
    folderError,
    preview,
    start,
    stop,
    retryRow,
    retryErrors,
    removeRow,
    clearInvalid,
    toggle,
    selectAll,
    setVersion,
    setFile,
    setRoot,
    submit,
    back,
  }
}

export type BatchDownload = ReturnType<typeof useBatchDownload>
