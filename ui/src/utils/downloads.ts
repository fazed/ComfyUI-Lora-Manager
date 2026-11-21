/**
 * Pure helpers of the download dialog (port of the classic DownloadManager):
 * input parsing, per-version state, file selection, destination params and
 * the target path preview. No I/O; see composables/useDownloadFlow.
 */

import type { CivitaiFile, CivitaiVersion, DestinationParams, DownloadFileParams, ModelPrefix, QueueItem } from '@/api/types'
import { parseCivitaiInput } from './civitai'

export interface DownloadTarget {
  modelId: number | null
  versionId: number | null
  /** `fileId` of a Civitai download link (`/api/download/models/{versionId}?fileId=`). */
  fileId: number | null
}

export function parseDownloadTarget(input: string): DownloadTarget | null {
  const target = parseCivitaiInput(input)
  if (!target) return null
  let fileId: number | null = null
  const match = input.match(/[?&]fileId=(\d{1,12})/)
  if (match) fileId = Number(match[1])
  return { ...target, fileId }
}

/** Mirrors MODEL_WEIGHT_FILE_TYPES (py/utils/constants.py, static/js/utils/modelFileTypes.js). */
export const WEIGHT_FILE_TYPES = ['Model', 'Pruned Model', 'Negative', 'UNet', 'Diffusion Model', 'Enhancement LoRA']

export function isWeightFile(file: CivitaiFile): boolean {
  return WEIGHT_FILE_TYPES.includes(file.type ?? 'Model')
}

export function weightFiles(version: CivitaiVersion): CivitaiFile[] {
  return (version.files ?? []).filter(isWeightFile)
}

/** Weight files that are not in the library yet. */
export function remainingWeightFiles(version: CivitaiVersion): CivitaiFile[] {
  const local = new Set((version.downloadedFiles ?? []).map((entry) => String(entry.fileId ?? '')))
  return weightFiles(version).filter((file) => !local.has(String(file.id)))
}

const ACTIVE_QUEUE_STATUSES = new Set(['queued', 'downloading', 'paused', 'waiting'])

export interface VersionStatus {
  inLibrary: boolean
  /** In the library, but some weight files of the version are not. */
  partial: boolean
  downloadedBefore: boolean
  queued: boolean
  earlyAccess: boolean
  canQueue: boolean
}

export function versionStatus(version: CivitaiVersion, queue: QueueItem[]): VersionStatus {
  const inLibrary = !!version.existsLocally
  const remaining = remainingWeightFiles(version).length
  const partial = inLibrary && remaining > 0 && (version.downloadedFiles?.length ?? 0) > 0
  const queued = queue.some(
    (item) => String(item.model_version_id ?? '') === String(version.id) && ACTIVE_QUEUE_STATUSES.has(String(item.status)),
  )
  return {
    inLibrary,
    partial,
    downloadedBefore: !!version.hasBeenDownloaded && !inLibrary,
    queued,
    earlyAccess: version.availability === 'EarlyAccess',
    canQueue: !queued && (!inLibrary || partial),
  }
}

/** The requested version when present, otherwise the newest (first) one. */
export function defaultVersionId(versions: CivitaiVersion[], wanted: number | null): number | null {
  if (!versions.length) return null
  if (wanted != null && versions.some((version) => version.id === wanted)) return wanted
  return versions[0].id
}

export function versionThumbnail(version: CivitaiVersion): string {
  return (version.images ?? []).find((image) => image.url && !/\.(mp4|webm)(\?|$)/i.test(image.url))?.url ?? ''
}

export function versionSizeBytes(version: CivitaiVersion): number {
  if (version.modelSizeKB) return version.modelSizeKB * 1024
  const files = weightFiles(version)
  const primary = files.find((file) => file.primary) ?? files[0]
  return primary?.sizeKB ? primary.sizeKB * 1024 : 0
}

export function filePayload(file: CivitaiFile): DownloadFileParams {
  return {
    id: file.id,
    name: file.name,
    type: file.type ?? 'Model',
    format: file.metadata?.format,
    size: file.metadata?.size,
    fp: file.metadata?.fp,
  }
}

export interface Destination {
  root: string
  /** Library-relative folder (ignored with `useDefaultPath`). */
  folder: string
  /** Default path template below `root`. */
  useDefaultPath: boolean
}

const slashes = (value: string) => value.replace(/\\/g, '/')
const cleanFolder = (folder: string) =>
  slashes(folder)
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/')

/** queue/add params; `{}` means the backend default (default root + template). */
export function destinationParams(destination: Destination, defaultRoot: string): DestinationParams {
  const root = destination.root.trim()
  if (destination.useDefaultPath) {
    if (!root || slashes(root).toLowerCase() === slashes(defaultRoot).toLowerCase()) return {}
    return { model_root: root, use_default_paths: 'true' }
  }
  return { model_root: root, relative_path: cleanFolder(destination.folder), use_default_paths: 'false' }
}

/** Shown in the dialog: root + folder, or root + the raw path template. */
export function targetPreview(destination: Destination, template: string): string {
  const root = slashes(destination.root).replace(/\/+$/, '')
  const rest = destination.useDefaultPath ? template.trim() : cleanFolder(destination.folder)
  return rest ? `${root}/${rest}` : root
}

/** `loras` -> `lora` (settings keys `default_lora_root`, `download_path_templates.lora`). */
export function singularOf(prefix: ModelPrefix): 'lora' | 'checkpoint' | 'embedding' {
  return prefix === 'loras' ? 'lora' : prefix === 'checkpoints' ? 'checkpoint' : 'embedding'
}
