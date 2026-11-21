/**
 * Typed wrappers around the backend endpoints: read-only endpoints, safe
 * mutations (metadata/notes/tags/favorite, download queue management, curated
 * settings) and the model management actions (delete with undo, rename, move,
 * exclude, add tags, auto-organize). The destructive ones are only called
 * from useModelActions / OrganizeDialog after an explicit confirm.
 */

import { ApiError, request } from './http'
import type {
  CivitaiVersion,
  DeleteFolderResponse,
  DestinationParams,
  DownloadFileParams,
  DuplicateGroup,
  FetchCivitaiResponse,
  FilenameConflict,
  FolderCandidate,
  PreviewResponse,
  VerifyDuplicatesResponse,
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
      // Empty folders included: a folder created in the panel must be visible to rename or delete it.
      request<{ tree: FolderTree }>(`${prefix}/unified-folder-tree`, { query: { include_empty: 'true' } }).then(
        (r) => r.tree ?? {},
      ),
    /** Folders of one root, including empty ones (move targets). */
    rootFolderTree: (modelRoot: string) =>
      request<{ tree: FolderTree }>(`${prefix}/folder-tree`, { query: { model_root: modelRoot, include_empty: 'true' } }).then(
        (r) => r.tree ?? {},
      ),
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
    /**
     * `targetPath` is an absolute directory inside a library root (created when
     * missing). With `useDefaultPaths` it must be a root: the backend appends
     * the download path template of each model.
     */
    moveModel: (filePath: string, targetPath: string, useDefaultPaths = false) =>
      request<MoveResponse>(`${prefix}/move_model`, {
        method: 'POST',
        body: { file_path: filePath, target_path: targetPath, ...(useDefaultPaths ? { use_default_paths: true } : {}) },
      }),
    moveBulk: (filePaths: string[], targetPath: string, useDefaultPaths = false) =>
      request<BulkMoveResponse>(`${prefix}/move_models_bulk`, {
        method: 'POST',
        body: { file_paths: filePaths, target_path: targetPath, ...(useDefaultPaths ? { use_default_paths: true } : {}) },
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

    // --- Phase B1: downloads (read-only lookups) ----------------------------
    /** Civitai versions of a model, with local state (existsLocally, downloadedFiles, ...). */
    civitaiVersions: (modelId: number, signal?: AbortSignal) =>
      request<CivitaiVersion[]>(`${prefix}/civitai/versions/${modelId}`, { signal }),
    /** Civitai version info (model id and model name of a version / download link). */
    civitaiVersionInfo: (versionId: number, signal?: AbortSignal) =>
      request<CivitaiVersion & { modelId?: number }>(`${prefix}/civitai/model/version/${versionId}`, { signal }),

    // --- Phase B1: model tools ----------------------------------------------
    /** Excluded models (paged). Note: the backend may create a missing default .metadata.json. */
    excluded: (page = 1, pageSize = 50, search = '') =>
      request<PagedResponse<ModelItem>>(`${prefix}/excluded`, {
        query: { page, page_size: pageSize, search: search.trim() || undefined },
      }),
    /** Read-only: groups of the in-memory hash index. */
    findDuplicates: () =>
      request<{ duplicates?: DuplicateGroup[] }>(`${prefix}/find-duplicates`).then((r) => r.duplicates ?? []),
    /** Re-hashes the files; a wrong stored sha256 is corrected in the sidecar. */
    verifyDuplicates: (filePaths: string[]) =>
      request<VerifyDuplicatesResponse>(`${prefix}/verify-duplicates`, { method: 'POST', body: { file_paths: filePaths } }),
    filenameConflicts: () =>
      request<{ conflicts?: FilenameConflict[] }>(`${prefix}/find-filename-conflicts`).then((r) => r.conflicts ?? []),
    /** Re-fetches the Civitai metadata by hash (overwrites model name and base model). */
    fetchCivitai: (filePath: string) =>
      request<FetchCivitaiResponse>(`${prefix}/fetch-civitai`, { method: 'POST', body: { file_path: filePath } }),
    relinkCivitai: (filePath: string, modelId: number, versionId: number | null) =>
      request<FetchCivitaiResponse>(`${prefix}/relink-civitai`, {
        method: 'POST',
        body: { file_path: filePath, model_id: modelId, ...(versionId ? { model_version_id: versionId } : {}) },
      }),
    /** Whole library type, blocks until done. Only after a confirm. */
    fetchAllCivitai: () =>
      request<{ success: boolean; processed?: number; updated?: number; total?: number; failure_count?: number; skipped_count?: number; message?: string }>(
        `${prefix}/fetch-all-civitai`,
        { method: 'POST', body: {} },
      ),
    /** Replaces every existing preview of the model (multipart; field order matters to the backend). */
    replacePreview: (filePath: string, file: Blob, nsfwLevel: number) => {
      const form = new FormData()
      form.append('preview_file', file, (file as File).name || 'preview')
      form.append('model_path', filePath)
      form.append('nsfw_level', String(nsfwLevel))
      return request<PreviewResponse>(`${prefix}/replace-preview`, { method: 'POST', body: form })
    },
    setPreviewFromUrl: (filePath: string, imageUrl: string, nsfwLevel: number) =>
      request<PreviewResponse>(`${prefix}/set-preview-from-url`, {
        method: 'POST',
        body: { model_path: filePath, image_url: imageUrl, nsfw_level: nsfwLevel },
      }),
    setNsfwLevel: (filePath: string, level: number) =>
      request<{ success: boolean }>(`${prefix}/save-metadata`, {
        method: 'POST',
        body: { file_path: filePath, preview_nsfw_level: level },
      }),
    /** Dry run of the filename template: always a POST with dry_run=true and an explicit scope. */
    filenameTemplatePreview: (scope: TemplateScope) =>
      request<OrganizeResponse>(`${prefix}/apply-filename-template`, {
        method: 'POST',
        body: { dry_run: true, ...templateScopeBody(scope) },
      }),
    /** REAL rename of the scoped files. Only after the preview and a danger confirm. */
    filenameTemplateApply: (scope: TemplateScope) =>
      request<OrganizeResponse>(`${prefix}/apply-filename-template`, {
        method: 'POST',
        body: { dry_run: false, ...templateScopeBody(scope) },
      }),
    createFolder: (folderPath: string) =>
      request<{ success: boolean; folder?: string; created?: boolean }>(`${prefix}/create-folder`, {
        method: 'POST',
        body: { folder_path: folderPath },
      }),
    renameFolder: (folderPath: string, newName: string) =>
      request<{ success: boolean; renamed?: boolean; folder?: string }>(`${prefix}/rename-folder`, {
        method: 'POST',
        body: { folder_path: folderPath, new_name: newName },
      }),
    /** Dry run or real delete. A refusal (409/400 with `code`) is returned, not thrown. */
    deleteFolder: async (folderPath: string, dryRun = false): Promise<DeleteFolderResponse> => {
      try {
        return await request<DeleteFolderResponse>(`${prefix}/delete-folder`, {
          method: 'POST',
          body: dryRun ? { folder_path: folderPath, dry_run: true } : { folder_path: folderPath },
        })
      } catch (error) {
        if (error instanceof ApiError && error.payload && typeof error.payload === 'object' && error.status >= 400 && error.status < 500) {
          return { success: false, ...(error.payload as object), error: error.message } as DeleteFolderResponse
        }
        throw error
      }
    },
    /** Absolute folder(s) behind a library-relative folder of the unified tree. */
    resolveFolder: (folder: string) =>
      request<{ candidates?: FolderCandidate[] }>(`${prefix}/resolve-folder`, { query: { folder } }).then(
        (r) => r.candidates ?? [],
      ),
  }
}

export interface TemplateScope {
  filePaths?: string[]
  folderPaths?: string[]
}

/** Refuses an empty scope: without one the backend renames the whole library type. */
function templateScopeBody(scope: TemplateScope): Record<string, string[]> {
  const body: Record<string, string[]> = {}
  if (scope.filePaths?.length) body.file_paths = scope.filePaths
  if (scope.folderPaths?.length) body.folder_paths = scope.folderPaths
  if (!Object.keys(body).length) throw new Error('A filename template run needs selected files or a folder')
  return body
}

/** Restores a staged delete batch (POST /api/lm/undo-delete; 404 = unknown, expired or occupied). */
export function undoDelete(batchId: string) {
  return request<{ success: boolean; restored?: string[]; kind?: string }>('undo-delete', {
    method: 'POST',
    body: { batch_id: batchId },
  })
}

export type ModelApi = ReturnType<typeof createModelApi>

export interface QueueAddTarget {
  modelId: number | null
  versionId: number | null
  fileParams?: DownloadFileParams | null
  destination?: DestinationParams | null
  modelName?: string
  versionName?: string
  thumbnailUrl?: string
}

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
  /**
   * Adds a row to the backend queue (the worker starts it). Optional file
   * selection and destination (root/folder); without a destination the
   * default root and path template are used.
   */
  add: (target: QueueAddTarget) =>
    request<{ queued: boolean; duplicate: boolean; reason?: string | null; item: QueueItem | null }>('downloads/queue/add', {
      query: {
        model_id: target.modelId ?? undefined,
        model_version_id: target.versionId ?? undefined,
        source: 'civitai',
        file_params: target.fileParams ? JSON.stringify(target.fileParams) : undefined,
        ...(target.destination ?? {}),
        model_name: target.modelName || undefined,
        version_name: target.versionName || undefined,
        thumbnail_url: target.thumbnailUrl || undefined,
      },
    }),
}

export const settingsApi = {
  get: () => request<{ settings: SettingsMap }>('settings').then((r) => r.settings ?? {}),
  update: (changes: SettingsMap) => request<{ success: boolean }>('settings', { method: 'POST', body: changes }),
}

// Recipes live in ./recipes (phase B2a); re-exported for existing imports.
export { recipesApi, type RecipeListQuery } from './recipes'

export const themesApi = {
  list: () => request<{ themes: unknown[]; directory?: string }>('ui/themes'),
}

/** ComfyUI workflow bridge (classic "send to workflow"). */
export const workflowApi = {
  registry: () => request<{ data: WorkflowRegistry }>('get-registry').then((r) => r.data ?? { nodes: {} }),
  updateLoraCode: (body: UpdateLoraCodeBody) =>
    request<{ success: boolean; results?: unknown[] }>('update-lora-code', { method: 'POST', body }),
}
