/**
 * Typed wrappers around the backend endpoints: read-only endpoints, safe
 * mutations (metadata/notes/tags/favorite, download queue management, curated
 * settings) and the model management actions (delete with undo, rename, move,
 * exclude, add tags, auto-organize). The destructive ones are only called
 * from useModelActions / OrganizeDialog after an explicit confirm.
 */

import { ApiError, request } from './http'
import type {
  BulkDeleteResponse,
  BulkMoveResponse,
  CountEntry,
  DeleteResponse,
  MoveResponse,
  OrganizeProgress,
  OrganizeResponse,
  RenameResponse,
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
    /** Tag autocomplete: case-insensitive substring match, sorted by count. */
    searchTags: (q: string, limit = 8, signal?: AbortSignal) =>
      request<{ tags: TagEntry[] }>(`${prefix}/search-tags`, { query: { q, limit }, signal }).then((r) => r.tags ?? []),
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

    // --- Model management (destructive: call only after a confirm) ---------
    /** Stages the model + sidecars into a pending-delete folder (undo window) or hard-deletes as a fallback. */
    deleteModel: (filePath: string) =>
      request<DeleteResponse>(`${prefix}/delete`, { method: 'POST', body: { file_path: filePath } }),
    bulkDelete: (filePaths: string[]) =>
      request<BulkDeleteResponse>(`${prefix}/bulk-delete`, { method: 'POST', body: { file_paths: filePaths } }),
    /** `newFileName` is the new stem; the extension is kept by the backend. */
    rename: (filePath: string, newFileName: string) =>
      request<RenameResponse>(`${prefix}/rename`, {
        method: 'POST',
        body: { file_path: filePath, new_file_name: newFileName },
      }),
    /** `targetPath` is an absolute directory inside a library root (created when missing). */
    moveModel: (filePath: string, targetPath: string) =>
      request<MoveResponse>(`${prefix}/move_model`, {
        method: 'POST',
        body: { file_path: filePath, target_path: targetPath },
      }),
    moveBulk: (filePaths: string[], targetPath: string) =>
      request<BulkMoveResponse>(`${prefix}/move_models_bulk`, {
        method: 'POST',
        body: { file_paths: filePaths, target_path: targetPath },
      }),
    exclude: (filePath: string) =>
      request<{ success: boolean; message?: string }>(`${prefix}/exclude`, { method: 'POST', body: { file_path: filePath } }),
    unexclude: (filePath: string) =>
      request<{ success: boolean; message?: string }>(`${prefix}/unexclude`, { method: 'POST', body: { file_path: filePath } }),
    addTags: (filePath: string, tags: string[]) =>
      request<{ success: boolean; tags?: string[] }>(`${prefix}/add-tags`, { method: 'POST', body: { file_path: filePath, tags } }),
    /** Dry run: the plan only, nothing moves. Always sends dry_run=true. */
    autoOrganizePreview: () =>
      request<OrganizeResponse>(`${prefix}/auto-organize`, { query: { dry_run: 'true' } }),
    /** REAL run: moves files of the whole library type. Only after an explicit confirm. */
    autoOrganizeRun: () => request<OrganizeResponse>(`${prefix}/auto-organize`, { method: 'POST', body: {} }),
    /** Latest progress snapshot, or null when no run is in progress (404). */
    autoOrganizeProgress: async (): Promise<OrganizeProgress | null> => {
      try {
        const response = await request<{ progress?: OrganizeProgress }>(`${prefix}/auto-organize-progress`)
        return response.progress ?? null
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    },
  }
}

/** Restores a staged delete batch (POST /api/lm/undo-delete; 404 = unknown, expired or occupied). */
export function undoDelete(batchId: string) {
  return request<{ success: boolean; restored?: string[]; kind?: string }>('undo-delete', {
    method: 'POST',
    body: { batch_id: batchId },
  })
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
  searchTags: (q: string, limit = 8, signal?: AbortSignal) =>
    request<{ tags: TagEntry[] }>('recipes/search-tags', { query: { q, limit }, signal }).then((r) => r.tags ?? []),
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
