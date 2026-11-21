/**
 * State machine of the download dialog (port of the classic DownloadManager):
 *
 *   input --resolve()--> version --toLocation()--> location --submit()--> done
 *
 * Resolving only uses read-only GETs (civitai/versions, civitai/model/version).
 * Submitting adds one row per chosen file to the backend queue
 * (`downloads/queue/add`); the queue worker starts them. Nothing here calls
 * the blocking `download-model` endpoint.
 */

import { computed, ref } from 'vue'
import { createModelApi, downloadsApi } from '@/api/endpoints'
import type { CivitaiFile, CivitaiVersion, FolderTree, ModelPrefix, QueueItem, SettingsMap } from '@/api/types'
import {
  defaultVersionId,
  destinationParams,
  filePayload,
  parseDownloadTarget,
  remainingWeightFiles,
  singularOf,
  targetPreview,
  versionStatus,
  versionThumbnail,
  weightFiles,
} from '@/utils/downloads'
import { flattenFolderTree, validateNewFolder } from '@/utils/modelActions'
import { readStorage, writeStorage } from '@/utils/storage'
import { t } from '@/i18n'

export type DownloadStep = 'input' | 'version' | 'location' | 'done'

export interface DownloadResult {
  queued: number
  duplicates: number
  failed: number
  errors: string[]
}

export interface DownloadFlowOptions {
  /** Current queue rows (to flag versions that are already queued). */
  queue: () => QueueItem[]
  settings: () => SettingsMap | null | undefined
}

const message = (error: unknown) => (error as Error)?.message || t('common.error')

export function useDownloadFlow(prefix: ModelPrefix, options: DownloadFlowOptions) {
  const api = createModelApi(prefix)
  const singular = singularOf(prefix)
  const storageKey = `lm-ui.download.useDefaultPath.${prefix}`

  const step = ref<DownloadStep>('input')
  const busy = ref(false)
  const error = ref<string | null>(null)
  const modelId = ref<number | null>(null)
  const versions = ref<CivitaiVersion[]>([])
  const selectedVersionId = ref<number | null>(null)
  const selectedFileIds = ref<Set<number>>(new Set())
  const roots = ref<string[]>([])
  const root = ref('')
  const tree = ref<FolderTree>({})
  const folder = ref('')
  const useDefaultPath = ref(readStorage(storageKey) === 'true')
  const result = ref<DownloadResult | null>(null)

  const selectedVersion = computed(() => versions.value.find((entry) => entry.id === selectedVersionId.value) ?? null)
  const status = computed(() => (selectedVersion.value ? versionStatus(selectedVersion.value, options.queue()) : null))
  const files = computed<CivitaiFile[]>(() => (selectedVersion.value ? weightFiles(selectedVersion.value) : []))
  const localFileIds = computed(
    () => new Set((selectedVersion.value?.downloadedFiles ?? []).map((entry) => String(entry.fileId ?? ''))),
  )
  const canContinue = computed(() => !!status.value?.canQueue && !busy.value)
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

  function reset(): void {
    step.value = 'input'
    error.value = null
    versions.value = []
    selectedVersionId.value = null
    selectedFileIds.value = new Set()
    result.value = null
  }

  function selectVersion(id: number, linkedFileId: number | null = null): void {
    selectedVersionId.value = id
    const version = versions.value.find((entry) => entry.id === id)
    const next = new Set<number>()
    if (version && linkedFileId != null && weightFiles(version).some((file) => file.id === linkedFileId)) next.add(linkedFileId)
    selectedFileIds.value = next
  }

  function toggleFile(id: number): void {
    if (localFileIds.value.has(String(id))) return
    const next = new Set(selectedFileIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedFileIds.value = next
  }

  async function resolve(input: string): Promise<void> {
    reset()
    const target = parseDownloadTarget(input)
    if (!target) {
      error.value = t('download.invalid')
      return
    }
    busy.value = true
    try {
      let id = target.modelId
      if (id == null && target.versionId != null) {
        const info = await api.civitaiVersionInfo(target.versionId)
        id = info.modelId ?? null
      }
      if (id == null) {
        error.value = t('download.notFound')
        return
      }
      const list = await api.civitaiVersions(id)
      if (!Array.isArray(list) || !list.length) {
        error.value = t('download.noVersions')
        return
      }
      if (target.versionId != null && !list.some((entry) => entry.id === target.versionId)) {
        error.value = t('download.versionMissing', { id: target.versionId })
        return
      }
      modelId.value = id
      versions.value = list
      const chosen = defaultVersionId(list, target.versionId)
      if (chosen != null) selectVersion(chosen, target.fileId)
      step.value = 'version'
    } catch (failure) {
      error.value = message(failure)
    } finally {
      busy.value = false
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

  async function setRoot(value: string): Promise<void> {
    root.value = value
    folder.value = ''
    await loadTree()
  }

  async function toLocation(): Promise<void> {
    if (!canContinue.value) return
    error.value = null
    busy.value = true
    try {
      roots.value = await api.roots()
      root.value = roots.value.includes(defaultRoot.value) ? defaultRoot.value : (roots.value[0] ?? '')
      folder.value = ''
      await loadTree()
      step.value = 'location'
    } catch (failure) {
      error.value = message(failure)
    } finally {
      busy.value = false
    }
  }

  /** The files to queue: the chosen ones, the missing ones of a partial version, or none (= primary file). */
  function filesToQueue(): (CivitaiFile | null)[] {
    const version = selectedVersion.value
    if (!version) return []
    const chosen = files.value.filter((file) => selectedFileIds.value.has(file.id))
    if (chosen.length) return chosen
    if (status.value?.partial) return remainingWeightFiles(version)
    return [null]
  }

  async function submit(): Promise<DownloadResult | null> {
    const version = selectedVersion.value
    if (!version || !root.value || folderError.value || busy.value) return null
    busy.value = true
    error.value = null
    const destination = destinationParams(
      { root: root.value, folder: folder.value, useDefaultPath: useDefaultPath.value },
      defaultRoot.value,
    )
    const outcome: DownloadResult = { queued: 0, duplicates: 0, failed: 0, errors: [] }
    try {
      for (const file of filesToQueue()) {
        try {
          const response = await downloadsApi.add({
            modelId: modelId.value,
            versionId: version.id,
            fileParams: file ? filePayload(file) : null,
            destination,
            versionName: version.name,
            thumbnailUrl: versionThumbnail(version),
          })
          if (response.duplicate) outcome.duplicates += 1
          else if (response.queued) outcome.queued += 1
          else {
            outcome.failed += 1
            outcome.errors.push(t('download.notQueued'))
          }
        } catch (failure) {
          outcome.failed += 1
          outcome.errors.push(message(failure))
        }
      }
      writeStorage(storageKey, String(useDefaultPath.value))
      result.value = outcome
      step.value = 'done'
      return outcome
    } finally {
      busy.value = false
    }
  }

  function back(): void {
    error.value = null
    if (step.value === 'location') step.value = 'version'
    else if (step.value === 'version') step.value = 'input'
  }

  return {
    step,
    busy,
    error,
    modelId,
    versions,
    selectedVersionId,
    selectedVersion,
    selectedFileIds,
    localFileIds,
    files,
    status,
    canContinue,
    roots,
    root,
    folder,
    folders,
    useDefaultPath,
    defaultRoot,
    template,
    folderError,
    preview,
    result,
    resolve,
    selectVersion,
    toggleFile,
    toLocation,
    setRoot,
    submit,
    back,
    reset,
  }
}

export type DownloadFlow = ReturnType<typeof useDownloadFlow>
