/**
 * Typed client for the recipe endpoints (`/api/lm/recipes`, `/api/lm/recipe/...`).
 * Semantics: ui/README.md, "Phase B2a discovery". Destructive calls (delete,
 * bulk delete) are only made from useRecipeActions after a confirm.
 */

import { request } from './http'
import type {
  BatchImportProgress,
  CountEntry,
  FolderTree,
  MatchingRecipe,
  PagedResponse,
  RecipeAnalysis,
  RecipeCheckpoint,
  RecipeDuplicateGroup,
  RecipeItem,
  RecipeLora,
  ReconnectSuggestion,
  TagEntry,
  UndoHandle,
} from './types'

export type LoraAvailability = 'ready' | 'missing' | 'deleted'

export interface RecipeListQuery {
  page: number
  pageSize: number
  sortBy?: string
  search?: string
  folder?: string
  recursive?: boolean
  baseModels?: string[]
  tags?: string[]
  favoritesOnly?: boolean
  loraAvailability?: LoraAvailability[]
}

/** GET /recipes parameters: base models are comma-joined, tags repeat `tag_include`. */
export function recipeListParams(query: RecipeListQuery) {
  return {
    page: query.page,
    page_size: query.pageSize,
    sort_by: query.sortBy,
    search: query.search?.trim() || undefined,
    folder: query.folder || undefined,
    recursive: query.folder ? String(query.recursive ?? true) : undefined,
    base_models: query.baseModels?.length ? query.baseModels.join(',') : undefined,
    tag_include: query.tags ?? [],
    favorite: query.favoritesOnly ? 'true' : undefined,
    lora_availability: query.loraAvailability?.length ? query.loraAvailability.join(',') : undefined,
  }
}

/** The only keys PUT /recipe/{id}/update accepts; the backend would store any other key it is sent. */
export const RECIPE_UPDATE_KEYS = ['title', 'tags', 'favorite', 'source_path', 'preview_nsfw_level', 'gen_params', 'base_model'] as const
export type RecipeUpdate = Partial<Pick<RecipeItem, (typeof RECIPE_UPDATE_KEYS)[number]>>

export function pickRecipeUpdate(updates: Record<string, unknown>): RecipeUpdate {
  const picked: Record<string, unknown> = {}
  for (const key of RECIPE_UPDATE_KEYS) {
    if (updates[key] !== undefined) picked[key] = updates[key]
  }
  if (!Object.keys(picked).length) throw new Error('Nothing to update')
  return picked as RecipeUpdate
}

export interface SaveRecipeInput {
  /** An uploaded file (drag & drop / file picker) ... */
  image?: Blob
  /** ... or the image returned by a URL / local-path analysis. */
  imageBase64?: string
  extension?: string
  name: string
  tags: string[]
  metadata: Record<string, unknown>
}

/** Multipart body of POST /recipes/save (field names as parsed by `_parse_save_payload`). */
export function buildSaveForm(input: SaveRecipeInput): FormData {
  if (!input.image && !input.imageBase64) throw new Error('No image data available')
  const form = new FormData()
  if (input.image) form.append('image', input.image, (input.image as File).name || 'recipe.png')
  else form.append('image_base64', input.imageBase64 ?? '')
  form.append('name', input.name)
  form.append('tags', JSON.stringify(input.tags))
  form.append('metadata', JSON.stringify(input.metadata))
  if (input.extension) form.append('extension', input.extension)
  return form
}

const recipePath = (id: string) => `recipe/${encodeURIComponent(id)}`

export interface RecipeDeleteResponse extends UndoHandle {
  success: boolean
  message?: string
}

export interface RecipeBulkDeleteResponse extends UndoHandle {
  success: boolean
  deleted?: string[]
  failed?: { id: string; reason?: string }[]
}

export interface RecipeMoveResult {
  recipe_id: string
  success: boolean
  message?: string
  folder?: string
  new_file_path?: string | null
}

export interface ReconnectResponse {
  success: boolean
  updated_lora?: RecipeLora
  updated_checkpoint?: RecipeCheckpoint
  base_model_mismatch?: { recipe_base_model?: string; lora_base_model?: string; checkpoint_base_model?: string }
}

export interface RematchResponse {
  success: boolean
  matched_entries?: number
  unresolved_entries?: number
  errors?: number
  message?: string
}

export const recipesApi = {
  /** Recipe rescan (the classic UI's Refresh): re-reads every recipe file; answers no counts. */
  scan: () => request<{ success?: boolean; message?: string; status?: string }>('recipes/scan'),
  list: (query: RecipeListQuery, signal?: AbortSignal) =>
    request<PagedResponse<RecipeItem>>('recipes', { query: recipeListParams(query), signal }),
  detail: (id: string, signal?: AbortSignal) => request<RecipeItem>(recipePath(id), { signal }),
  searchTags: (q: string, limit = 8, signal?: AbortSignal) =>
    request<{ tags: TagEntry[] }>('recipes/search-tags', { query: { q, limit }, signal }).then((r) => r.tags ?? []),
  topTags: (limit = 40) => request<{ tags: TagEntry[] }>('recipes/top-tags', { query: { limit } }).then((r) => r.tags ?? []),
  /** Includes a synthetic "Unknown" bucket (`value` = filter marker); callers may drop it. */
  baseModels: (limit = 50) =>
    request<{ base_models: (CountEntry & { value?: string })[] }>('recipes/base-models', { query: { limit } }).then(
      (r) => r.base_models ?? [],
    ),
  roots: () => request<{ roots: string[] }>('recipes/roots').then((r) => r.roots ?? []),
  folderTree: () => request<{ tree: FolderTree }>('recipes/unified-folder-tree').then((r) => r.tree ?? {}),

  // --- Edits ----------------------------------------------------------------
  update: (id: string, updates: RecipeUpdate) =>
    request<{ success: boolean }>(`${recipePath(id)}/update`, { method: 'PUT', body: pickRecipeUpdate(updates) }),
  /** Staged delete (20 s undo through POST /undo-delete); `batch_id: null` = hard delete. */
  remove: (id: string) => request<RecipeDeleteResponse>(recipePath(id), { method: 'DELETE' }),
  bulkDelete: (ids: string[]) =>
    request<RecipeBulkDeleteResponse>('recipes/bulk-delete', { method: 'POST', body: { recipe_ids: ids } }),
  /** `targetPath`: absolute, or relative to the recipes root; created when missing. */
  move: (id: string, targetPath: string) =>
    request<RecipeMoveResult>('recipe/move', { method: 'POST', body: { recipe_id: id, target_path: targetPath } }),
  moveBulk: (ids: string[], targetPath: string) =>
    request<{ success: boolean; results?: RecipeMoveResult[] }>('recipes/move-bulk', {
      method: 'POST',
      body: { recipe_ids: ids, target_path: targetPath },
    }),

  // --- Reconnect / rematch -------------------------------------------------
  reconnectSuggestions: (id: string, index: number, query?: string, signal?: AbortSignal) =>
    request<{ suggestions?: ReconnectSuggestion[] }>(`${recipePath(id)}/lora/${index}/reconnect-suggestions`, {
      query: { query: query?.trim() || undefined },
      signal,
    }).then((r) => r.suggestions ?? []),
  reconnect: (id: string, index: number, targetName: string) =>
    request<ReconnectResponse>('recipe/lora/reconnect', {
      method: 'POST',
      body: { recipe_id: id, lora_index: index, target_name: targetName },
    }),
  restore: (id: string, index: number) =>
    request<ReconnectResponse>('recipe/lora/restore', { method: 'POST', body: { recipe_id: id, lora_index: index } }),
  checkpointSuggestions: (id: string, query?: string, signal?: AbortSignal) =>
    request<{ suggestions?: ReconnectSuggestion[] }>(`${recipePath(id)}/checkpoint/reconnect-suggestions`, {
      query: { query: query?.trim() || undefined },
      signal,
    }).then((r) => r.suggestions ?? []),
  reconnectCheckpoint: (id: string, targetName: string) =>
    request<ReconnectResponse>('recipe/checkpoint/reconnect', { method: 'POST', body: { recipe_id: id, target_name: targetName } }),
  restoreCheckpoint: (id: string) => request<ReconnectResponse>('recipe/checkpoint/restore', { method: 'POST', body: { recipe_id: id } }),
  rematch: (id: string, relaxed = false) =>
    request<RematchResponse>(`${recipePath(id)}/rematch`, { method: 'POST', body: { relaxed } }),

  // --- Use ------------------------------------------------------------------
  syntax: (id: string) => request<{ syntax?: string }>(`${recipePath(id)}/syntax`).then((r) => r.syntax ?? ''),
  sendWorkflow: (id: string) => request<{ success: boolean; sent?: boolean }>(`${recipePath(id)}/send-workflow`, { method: 'POST' }),
  /** Fire-and-forget "recently opened" stamp (writes the open-stats file only). */
  markOpened: (id: string) => request<{ success: boolean }>(`${recipePath(id)}/opened`, { method: 'POST' }),

  // --- Import ---------------------------------------------------------------
  analyzeFile: (file: Blob, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('image', file, (file as File).name || 'image.png')
    return request<RecipeAnalysis>('recipes/analyze-image', { method: 'POST', body: form, signal })
  },
  analyzeUrl: (url: string, signal?: AbortSignal) =>
    request<RecipeAnalysis>('recipes/analyze-image', { method: 'POST', body: { url }, signal }),
  analyzeLocal: (path: string, signal?: AbortSignal) =>
    request<RecipeAnalysis>('recipes/analyze-local-image', { method: 'POST', body: { path }, signal }),
  save: (input: SaveRecipeInput) =>
    request<{ success: boolean; recipe_id?: string; matching_recipes?: MatchingRecipe[] }>('recipes/save', {
      method: 'POST',
      body: buildSaveForm(input),
    }),
  findDuplicates: (includePrompt = false) =>
    request<{ duplicate_groups?: RecipeDuplicateGroup[] }>('recipes/find-duplicates', {
      query: { include_prompt: includePrompt ? '1' : undefined },
    }).then((r) => r.duplicate_groups ?? []),
  batchImportStart: (items: { source: string; type: 'url' | 'local_path' }[], tags: string[], skipNoMetadata: boolean) =>
    request<{ operation_id?: string }>('recipes/batch-import/start', {
      method: 'POST',
      body: { items, tags, skip_no_metadata: skipNoMetadata },
    }).then((r) => r.operation_id ?? ''),
  batchImportProgress: (operationId: string) =>
    request<{ progress?: BatchImportProgress }>('recipes/batch-import/progress', { query: { operation_id: operationId } }).then(
      (r) => r.progress ?? null,
    ),
  batchImportCancel: (operationId: string) =>
    request<{ success: boolean }>('recipes/batch-import/cancel', { method: 'POST', body: { operation_id: operationId } }),
}

export type RecipesApi = typeof recipesApi
