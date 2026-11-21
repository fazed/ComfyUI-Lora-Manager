/**
 * Typed wrappers around the backend endpoints. Only read-only endpoints and a
 * small set of safe mutations (metadata/notes/tags/favorite, download queue
 * management, curated settings) are exposed; everything destructive stays in
 * the classic UI for now.
 */

import { request } from './http'
import type {
  CountEntry,
  FolderTree,
  HistoryResponse,
  ModelItem,
  ModelMetadata,
  ModelPrefix,
  ModelUpdateRecord,
  PagedResponse,
  QueueItem,
  QueueResponse,
  RecipeItem,
  SettingsMap,
  TagEntry,
  WorkflowRegistry,
} from './types'
import type { UpdateLoraCodeBody } from '@/utils/workflow'

export interface ModelListQuery {
  page: number
  pageSize: number
  sortBy?: string
  search?: string
  folder?: string
  recursive?: boolean
  baseModels?: string[]
  tags?: string[]
  favoritesOnly?: boolean
  updateAvailableOnly?: boolean
}

export function modelListParams(query: ModelListQuery) {
  return {
    page: query.page,
    page_size: query.pageSize,
    sort_by: query.sortBy,
    search: query.search?.trim() || undefined,
    folder: query.folder || undefined,
    recursive: query.folder ? String(query.recursive ?? true) : undefined,
    base_model: query.baseModels ?? [],
    tag_include: query.tags ?? [],
    favorites_only: query.favoritesOnly ? 'true' : undefined,
    update_available_only: query.updateAvailableOnly ? 'true' : undefined,
  }
}

export function createModelApi(prefix: ModelPrefix) {
  return {
    prefix,
    list: (query: ModelListQuery, signal?: AbortSignal) =>
      request<PagedResponse<ModelItem>>(`${prefix}/list`, { query: modelListParams(query), signal }),
    baseModels: (limit = 50) =>
      request<{ base_models: CountEntry[] }>(`${prefix}/base-models`, { query: { limit } }).then((r) => r.base_models ?? []),
    topTags: (limit = 40) =>
      request<{ tags: TagEntry[] }>(`${prefix}/top-tags`, { query: { limit } }).then((r) => r.tags ?? []),
    roots: () => request<{ roots: string[] }>(`${prefix}/roots`).then((r) => r.roots ?? []),
    folderTree: () =>
      request<{ tree: FolderTree }>(`${prefix}/unified-folder-tree`).then((r) => r.tree ?? {}),
    metadata: (filePath: string) =>
      request<{ metadata: ModelMetadata | null }>(`${prefix}/metadata`, { query: { file_path: filePath } }).then(
        (r) => r.metadata ?? null,
      ),
    description: (filePath: string) =>
      request<{ description?: string }>(`${prefix}/model-description`, { query: { file_path: filePath } }).then(
        (r) => r.description ?? '',
      ),
    civitaiUrl: (fileName: string) =>
      request<{ civitai_url?: string }>(`${prefix}/civitai-url`, { query: { name: fileName } }).then(
        (r) => r.civitai_url ?? '',
      ),
    versions: (modelId: number) =>
      request<{ record: ModelUpdateRecord | null }>(`${prefix}/updates/versions/${modelId}`).then((r) => r.record ?? null),
    /** Partial metadata update (notes, tags, favorite, ...). */
    saveMetadata: (filePath: string, updates: Record<string, unknown>) =>
      request<{ success: boolean }>(`${prefix}/save-metadata`, {
        method: 'POST',
        body: { file_path: filePath, ...updates },
      }),
  }
}

export type ModelApi = ReturnType<typeof createModelApi>

export const downloadsApi = {
  queue: (signal?: AbortSignal) => request<QueueResponse>('downloads/queue', { signal }),
  history: (limit = 50, offset = 0, status?: string) =>
    request<HistoryResponse>('downloads/history', { query: { limit, offset, status } }),
  // The queue endpoints are GET-only by design (browser-extension convention).
  moveToTop: (downloadId: string) => request('downloads/queue/move-to-top', { query: { download_id: downloadId } }),
  moveToEnd: (downloadId: string) => request('downloads/queue/move-to-end', { query: { download_id: downloadId } }),
  remove: (downloadId: string) => request('downloads/queue/remove', { query: { download_id: downloadId } }),
  pauseAll: () => request('downloads/queue/pause-all'),
  resumeAll: () => request('downloads/queue/resume-all'),
  retry: (downloadId: string) =>
    request('downloads/history/retry', { query: { download_id: downloadId, start: 'false' } }),
  retryAllFailed: () => request<{ retry_count?: number }>('downloads/history/retry-all'),
  clearHistory: (status?: string) => request<{ cleared?: number }>('downloads/history/clear', { query: { status } }),
  deleteHistoryItem: (downloadId: string) =>
    request('downloads/history/delete', { query: { download_id: downloadId } }),
  add: (target: { modelId: number | null; versionId: number | null }) =>
    request<{ queued: boolean; duplicate: boolean; item: QueueItem | null }>('downloads/queue/add', {
      query: { model_id: target.modelId ?? undefined, model_version_id: target.versionId ?? undefined, source: 'civitai' },
    }),
}

export const settingsApi = {
  get: () => request<{ settings: SettingsMap }>('settings').then((r) => r.settings ?? {}),
  update: (changes: SettingsMap) => request<{ success: boolean }>('settings', { method: 'POST', body: changes }),
}

export interface RecipeListQuery {
  page: number
  pageSize: number
  sortBy?: string
  search?: string
}

export const recipesApi = {
  list: (query: RecipeListQuery, signal?: AbortSignal) =>
    request<PagedResponse<RecipeItem>>('recipes', {
      query: { page: query.page, page_size: query.pageSize, sort_by: query.sortBy, search: query.search?.trim() || undefined },
      signal,
    }),
}

export const themesApi = {
  list: () => request<{ themes: unknown[]; directory?: string }>('ui/themes'),
}

/** ComfyUI workflow bridge (classic "send to workflow"). */
export const workflowApi = {
  registry: () => request<{ data: WorkflowRegistry }>('get-registry').then((r) => r.data ?? { nodes: {} }),
  updateLoraCode: (body: UpdateLoraCodeBody) =>
    request<{ success: boolean; results?: unknown[] }>('update-lora-code', { method: 'POST', body }),
}
