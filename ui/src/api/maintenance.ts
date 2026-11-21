/**
 * Phase B2b endpoints: local example images, statistics, doctor, backups,
 * metadata archive, environment / update check and the LLM model lists.
 * Semantics (what touches the disk) are in ui/README.md, "Phase B2b discovery".
 */

import { request, requestBlob } from './http'
import type { CivitaiImage } from './types'
import type { ExampleFile } from '@/utils/exampleImages'

export interface ExampleImagesResult {
  success: boolean
  files?: ExampleFile[]
  errors?: string[]
  regular_images?: CivitaiImage[]
  custom_images?: CivitaiImage[]
  model_file_path?: string
  message?: string
}

export interface OpenFolderResult {
  success: boolean
  mode?: 'clipboard' | 'uri'
  path?: string
  uri?: string
  message?: string
}

export const exampleImagesApi = {
  files: (hash: string) => request<{ files: ExampleFile[] }>('example-image-files', { query: { model_hash: hash } }).then((r) => r.files ?? []),
  status: () => request<Record<string, unknown>>('example-images-status', { query: { compact: 1 } }),
  /** Background job over the whole library (skips models already done). */
  startAll: (body: { optimize: boolean; model_types: string[] }) =>
    request<Record<string, unknown>>('download-example-images', { method: 'POST', body }),
  pause: () => request('pause-example-images', { method: 'POST', body: {} }),
  resume: () => request('resume-example-images', { method: 'POST', body: {} }),
  stop: () => request('stop-example-images', { method: 'POST', body: {} }),
  /** Synchronous: resolves when the model's images are downloaded. */
  downloadModel: (body: { model_hashes: string[]; optimize: boolean; model_types: string[] }) =>
    request<{ result?: { total?: number; processed?: number; successful?: number; errors?: string[] }; message?: string }>(
      'force-download-example-images',
      { method: 'POST', body },
    ),
  import: (form: FormData) => request<ExampleImagesResult>('import-example-images', { method: 'POST', body: form }),
  /** Imported (custom) images only; removes the file permanently. */
  remove: (hash: string, shortId: string) =>
    request<ExampleImagesResult>('delete-example-image', { method: 'POST', body: { model_hash: hash, short_id: shortId } }),
  setNsfw: (body: { model_hash: string; nsfw_level: number; source: 'civitai' | 'custom'; index?: number; id?: string }) =>
    request<ExampleImagesResult>('example-images/set-nsfw-level', { method: 'POST', body }),
  openFolder: (hash: string) => request<OpenFolderResult>('open-example-images-folder', { method: 'POST', body: { model_hash: hash } }),
}

const stat = <T>(path: string, query?: Record<string, string | number>) =>
  request<{ data: T }>(`stats/${path}`, { query }).then((r) => r.data)

export const statsApi = {
  overview: () => stat<Record<string, unknown>>('collection-overview'),
  usage: () => stat<Record<string, unknown>>('usage-analytics'),
  usageList: (type: 'lora' | 'checkpoint' | 'embedding', offset: number, limit = 50, sort: 'desc' | 'asc' = 'desc') =>
    stat<{ items: unknown[]; total: number }>('model-usage-list', { type, sort, limit, offset }),
  baseModels: () => stat<Record<string, Record<string, number>>>('base-model-distribution'),
  tags: () => stat<{ top_tags: unknown[]; total_unique_tags: number }>('tag-analytics'),
  storage: () => stat<Record<string, unknown>>('storage-analytics'),
  insights: () => stat<Record<string, unknown>>('insights'),
}

export const doctorApi = {
  /** Read-only, but calls Civitai once when an API key is set. */
  diagnostics: (clientVersion: string) => request<Record<string, unknown>>('doctor/diagnostics', { query: { clientVersion: clientVersion || undefined } }),
  /** Full rescan + rewrite of the persistent cache (no model files touched). */
  repairCache: () =>
    request<{ success: boolean; repaired: { label: string }[]; failures: { label: string; error: string }[] }>('doctor/repair-cache', {
      method: 'POST',
      body: {},
    }),
  /** Renames duplicate model files on disk (no undo). */
  resolveConflicts: () =>
    request<{ success: boolean; count: number; renamed: { old_path: string; new_path: string; new_filename: string }[] }>(
      'doctor/resolve-filename-conflicts',
      { method: 'POST', body: {} },
    ),
  exportBundle: (body: unknown) => requestBlob('doctor/export-bundle', { body }),
  environment: () => request<Record<string, unknown>>('environment'),
}

export const backupApi = {
  status: () => request<Record<string, unknown>>('backup/status'),
  /** Download of a fresh snapshot; nothing is kept on the server. */
  export: () => requestBlob('backup/export'),
  /** Overwrites settings.json and the backed-up caches. */
  restore: (file: File) => {
    const form = new FormData()
    form.append('archive', file, file.name)
    return request<{ success: boolean; restored_files: number; snapshot_type?: string }>('backup/import', { method: 'POST', body: form })
  },
  openFolder: () => request<OpenFolderResult>('backup/open-location', { method: 'POST', body: {} }),
}

export const archiveApi = {
  status: () => request<Record<string, unknown>>('metadata-archive-status'),
  /** Blocks until the multi-GB download is extracted. */
  download: (downloadId: string) =>
    request<{ success: boolean; message?: string }>('download-metadata-archive', { method: 'POST', query: { download_id: downloadId }, body: {} }),
  remove: () => request<{ success: boolean; message?: string }>('remove-metadata-archive', { method: 'POST', body: {} }),
}

export const systemApi = {
  versionInfo: () => request<{ version: string; has_git: boolean }>('version-info'),
  /** Network: GitHub API. Errors come back as success:false with HTTP 200. */
  checkUpdates: (nightly: boolean) =>
    request<Record<string, unknown>>('check-updates', { query: { nightly: nightly ? 'true' : 'false' } }).catch((error: Error) => ({
      success: false,
      error: error.message,
    })),
  providerModels: () => request<{ models: Record<string, string[]> }>('llm/provider-models').then((r) => r.models ?? {}),
  ollamaModels: (apiBase: string) =>
    request<{ models: string[] }>('llm/models', { query: { provider: 'ollama', api_base: apiBase || undefined } }).then((r) => r.models ?? []),
  openSettingsFolder: () => request<OpenFolderResult>('settings/open-location', { method: 'POST', body: {} }),
  checkpointRoots: () => request<{ roots: string[] }>('checkpoints/checkpoints_roots').then((r) => r.roots ?? []),
  unetRoots: () => request<{ roots: string[] }>('checkpoints/unet_roots').then((r) => r.roots ?? []),
  otherRootsBySubtype: () =>
    request<{ roots_by_subtype: Record<string, string[]> }>('other/roots_by_subtype').then((r) => r.roots_by_subtype ?? {}),
}

/** Saves a blob through a temporary link. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
