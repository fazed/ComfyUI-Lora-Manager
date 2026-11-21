/**
 * Local example images of one model (drawer + management dialog) and the
 * library-wide example-image download (Settings). See ui/README.md.
 */

import { computed, ref, shallowRef } from 'vue'
import { exampleImagesApi, type OpenFolderResult } from '@/api/maintenance'
import type { CivitaiImage } from '@/api/types'
import { copyText, useConfirm, useToasts } from '@/composables/useFeedback'
import { createPoller } from '@/composables/usePolling'
import {
  DOWNLOAD_MODEL_TYPES,
  buildExampleMedia,
  buildImportForm,
  isImportable,
  normaliseDownloadStatus,
  normaliseHash,
  nsfwBody,
  nsfwLabel,
  type ExampleDownloadStatus,
  type ExampleFile,
  type ExampleMedia,
} from '@/utils/exampleImages'
import { t } from '@/i18n'

export interface ExampleModelRef {
  sha256?: string | null
  file_path: string
  model_name?: string
  file_name?: string
}

/** "No example images path configured" etc.: the feature is simply off. */
export function isNotConfigured(error: unknown): boolean {
  return /path (is )?not configured|No example images path/i.test((error as Error)?.message ?? '')
}

export function useExampleImages(model: () => ExampleModelRef, options: { modelType: () => string; optimize?: () => boolean } = { modelType: () => 'lora' }) {
  const toasts = useToasts()
  const { confirm } = useConfirm()
  const files = shallowRef<ExampleFile[]>([])
  const images = shallowRef<CivitaiImage[]>([])
  const customImages = shallowRef<CivitaiImage[]>([])
  const configured = ref(true)
  const loading = ref(false)
  const busy = ref<string | null>(null)
  const error = ref<string | null>(null)

  const hash = computed(() => normaliseHash(model().sha256))
  const media = computed<ExampleMedia[]>(() => buildExampleMedia(images.value, customImages.value, files.value))
  const localCount = computed(() => media.value.filter((item) => item.local).length)

  function setMetadata(regular: CivitaiImage[] | undefined, custom: CivitaiImage[] | undefined): void {
    images.value = Array.isArray(regular) ? regular : []
    customImages.value = Array.isArray(custom) ? custom : []
  }

  async function loadFiles(): Promise<void> {
    if (!hash.value) {
      files.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      files.value = await exampleImagesApi.files(hash.value)
      configured.value = true
    } catch (err) {
      files.value = []
      if (isNotConfigured(err)) configured.value = false
      else error.value = (err as Error).message
    } finally {
      loading.value = false
    }
  }

  function applyResult(result: { regular_images?: CivitaiImage[]; custom_images?: CivitaiImage[] }): void {
    if (result.regular_images || result.custom_images) setMetadata(result.regular_images ?? images.value, result.custom_images ?? customImages.value)
  }

  /** Copies the chosen files into the model's example folder. */
  async function importFiles(list: File[]): Promise<boolean> {
    const accepted = list.filter((file) => isImportable(file.name))
    const rejected = list.length - accepted.length
    if (rejected) toasts.warning(t('examples.unsupported', { count: rejected }))
    if (!accepted.length || !hash.value) return false
    busy.value = 'import'
    try {
      const result = await exampleImagesApi.import(buildImportForm(hash.value, model().file_path, accepted))
      applyResult(result)
      await loadFiles()
      const errors = result.errors ?? []
      if (errors.length) toasts.warning(t('examples.importPartial', { count: result.files?.length ?? 0, errors: errors.length }))
      else toasts.success(t('examples.imported', { count: result.files?.length ?? accepted.length }))
      return true
    } catch (err) {
      toasts.error(t('examples.importFailed', { error: (err as Error).message }))
      return false
    } finally {
      busy.value = null
    }
  }

  /** Imported images only; asks first because the file is deleted permanently. */
  async function remove(item: ExampleMedia): Promise<boolean> {
    if (item.source !== 'custom' || !item.id) return false
    const ok = await confirm({
      title: t('examples.deleteTitle'),
      message: t('examples.deleteMessage', { name: item.localName ?? `custom_${item.id}` }),
      confirmLabel: t('examples.deleteConfirm'),
      danger: true,
    })
    if (!ok) return false
    busy.value = item.key
    try {
      applyResult(await exampleImagesApi.remove(hash.value, item.id))
      await loadFiles()
      toasts.success(t('examples.deleted'))
      return true
    } catch (err) {
      toasts.error(t('examples.deleteFailed', { error: (err as Error).message }))
      return false
    } finally {
      busy.value = null
    }
  }

  async function setNsfw(item: ExampleMedia, level: number): Promise<boolean> {
    if (item.nsfwLevel === level) return true
    busy.value = item.key
    try {
      applyResult(await exampleImagesApi.setNsfw(nsfwBody(hash.value, item, level)))
      toasts.success(t('examples.nsfwSet', { level: nsfwLabel(level) }))
      return true
    } catch (err) {
      toasts.error(t('examples.nsfwFailed', { error: (err as Error).message }))
      return false
    } finally {
      busy.value = null
    }
  }

  /** Downloads the Civitai example images of this model (request stays open until done). */
  async function downloadThis(): Promise<boolean> {
    if (!hash.value) return false
    busy.value = 'download'
    try {
      const response = await exampleImagesApi.downloadModel({
        model_hashes: [hash.value],
        optimize: options.optimize?.() ?? true,
        model_types: [options.modelType()],
      })
      await loadFiles()
      const errors = response.result?.errors ?? []
      if (errors.length) toasts.warning(t('examples.downloadPartial', { count: errors.length, error: errors[0] }))
      else toasts.success(t('examples.downloaded'))
      return true
    } catch (err) {
      toasts.error(t('examples.downloadFailed', { error: (err as Error).message }))
      return false
    } finally {
      busy.value = null
    }
  }

  async function openFolder(): Promise<OpenFolderResult | null> {
    try {
      const result = await exampleImagesApi.openFolder(hash.value)
      if (result.mode === 'clipboard' && result.path) {
        const copied = await copyText(result.path)
        toasts.push(copied ? t('examples.pathCopied') : t('examples.pathIs', { path: result.path }))
      } else if (result.mode === 'uri' && result.uri && /^[a-z][a-z0-9+.-]*:/i.test(result.uri)) {
        window.open(result.uri, '_blank', 'noopener')
      } else {
        toasts.push(t('examples.folderOpened'))
      }
      return result
    } catch (err) {
      toasts.error(t('examples.openFailed', { error: (err as Error).message }))
      return null
    }
  }

  return { files, images, customImages, media, localCount, configured, loading, busy, error, hash, setMetadata, loadFiles, importFiles, remove, setNsfw, downloadThis, openFolder }
}

// --------------------------------------------------------------------------- library-wide download

const status = ref<ExampleDownloadStatus>(normaliseDownloadStatus(null))
const actionBusy = ref(false)
let poller: ReturnType<typeof createPoller> | null = null

export const EXAMPLE_POLL_MS = 2000

export function useExampleDownload() {
  const toasts = useToasts()
  const { confirm } = useConfirm()

  async function refresh(): Promise<void> {
    try {
      status.value = normaliseDownloadStatus(await exampleImagesApi.status())
    } catch {
      /* keep the last status */
    }
    if (!status.value.downloading) poller?.stop()
  }

  function watchProgress(): void {
    poller ??= createPoller(refresh, EXAMPLE_POLL_MS)
    poller.start()
  }

  async function start(optimize: boolean): Promise<boolean> {
    const ok = await confirm({
      title: t('examples.allTitle'),
      message: t('examples.allMessage'),
      confirmLabel: t('examples.allConfirm'),
    })
    if (!ok) return false
    actionBusy.value = true
    try {
      const result = await exampleImagesApi.startAll({ optimize, model_types: [...DOWNLOAD_MODEL_TYPES] })
      status.value = normaliseDownloadStatus({ is_downloading: true, ...result })
      watchProgress()
      return true
    } catch (err) {
      toasts.error(t('examples.allFailed', { error: (err as Error).message }))
      return false
    } finally {
      actionBusy.value = false
    }
  }

  async function control(action: 'pause' | 'resume' | 'stop'): Promise<void> {
    actionBusy.value = true
    try {
      await exampleImagesApi[action]()
      await refresh()
      if (status.value.downloading) watchProgress()
    } catch (err) {
      toasts.error((err as Error).message)
    } finally {
      actionBusy.value = false
    }
  }

  async function init(): Promise<void> {
    await refresh()
    if (status.value.downloading) watchProgress()
  }

  return { status, actionBusy, init, refresh, start, pause: () => control('pause'), resume: () => control('resume'), stop: () => control('stop'), dispose: () => poller?.stop() }
}
