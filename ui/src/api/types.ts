/** Response shapes of the backend endpoints used by this UI (subset). */

export type ModelPrefix = 'loras' | 'checkpoints' | 'embeddings'

export interface CivitaiCreator {
  username?: string
  image?: string
}

export interface ModelCivitaiSummary {
  id?: number
  modelId?: number
  name?: string
  creator?: CivitaiCreator
  trainedWords?: string[]
}

export interface ModelItem {
  model_name: string
  file_name: string
  file_path: string
  folder: string
  preview_url: string
  preview_nsfw_level?: number
  base_model: string
  sha256?: string
  file_size?: number
  modified?: number
  tags?: string[]
  auto_tags?: string[]
  from_civitai?: boolean
  usage_count?: number
  notes?: string
  /** JSON string such as '{"strength": 0.8}' (LoRAs). */
  usage_tips?: string
  favorite?: boolean
  update_available?: boolean
  sub_type?: string
  civitai?: ModelCivitaiSummary | null
  version_count?: number | null
}

export interface PagedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface CountEntry {
  name: string
  count: number
}

export interface TagEntry {
  tag: string
  count: number
}

/** Nested folder tree: every key is a folder name, value its children. */
export interface FolderTree {
  [name: string]: FolderTree
}

export interface CivitaiImage {
  url: string
  id?: number | string
  type?: string
  nsfwLevel?: number
  width?: number
  height?: number
  /** Free-form generation data (prompt, sampler, resources, ...); see utils/generation.ts. */
  meta?: Record<string, unknown> | null
}

export interface ModelMetadata {
  id?: number
  modelId?: number
  name?: string
  baseModel?: string
  trainedWords?: string[]
  description?: string | null
  publishedAt?: string
  model?: {
    name?: string
    type?: string
    description?: string
    tags?: string[]
  }
  images?: CivitaiImage[]
}

export interface ModelVersionInfo {
  versionId: number
  name: string
  baseModel?: string
  releasedAt?: string
  sizeBytes?: number
  previewUrl?: string
  isInLibrary?: boolean
  hasBeenDownloaded?: boolean
  shouldIgnore?: boolean
  isEarlyAccess?: boolean
  isPaid?: boolean
  fileName?: string | null
}

export interface ModelUpdateRecord {
  modelId: number
  hasUpdate: boolean
  shouldIgnore?: boolean
  lastCheckedAt?: number
  versions: ModelVersionInfo[]
}

export type QueueStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'canceled' | string

export interface QueueItem {
  id?: number
  download_id: string
  model_id?: number | null
  model_version_id?: number | null
  model_name?: string
  version_name?: string
  thumbnail_url?: string
  status: QueueStatus
  progress?: number | null
  error?: string | null
  bytes_downloaded?: number | null
  total_bytes?: number | null
  bytes_per_second?: number | null
  priority?: number
  added_at?: number
  started_at?: number | null
  completed_at?: number | null
}

export interface QueueStats {
  queued?: number
  downloading?: number
  paused?: number
  completed?: number
  failed?: number
  canceled?: number
}

export interface QueueWorkerState {
  loop_running?: boolean
  paused?: boolean
  max_concurrent?: number
  active?: number
  rate_limited?: boolean
  rate_limited_until?: number | null
  retry_after?: number
  rate_limit_error?: string | null
}

export interface QueueResponse {
  success: boolean
  queue: QueueItem[]
  stats: QueueStats
  queue_worker?: boolean
  worker?: QueueWorkerState
}

export interface HistoryResponse {
  success: boolean
  items: QueueItem[]
  total: number
  limit: number
  offset: number
}

export type SettingsMap = Record<string, unknown>

export interface RecipeItem {
  id: string
  title?: string
  file_url?: string
  base_model?: string
  tags?: string[]
  favorite?: boolean
  loras?: unknown[]
  created_date?: number
  modified?: number
}

/** Undo handles of a staged (pending) delete: one merged batch, or several on a merge failure. */
export interface UndoHandle {
  batch_id?: string | null
  batch_ids?: string[] | null
}

/** POST /{prefix}/delete. `batch_id` is null when the backend fell back to a hard delete (no undo). */
export interface DeleteResponse extends UndoHandle {
  success: boolean
  deleted_files?: string[]
}

export interface BulkDeleteEntry {
  file_path: string
  success: boolean
  error?: string
  already_missing?: boolean
}

/** POST /{prefix}/bulk-delete (success is false only when nothing was deleted). */
export interface BulkDeleteResponse extends UndoHandle {
  success: boolean
  status?: string
  total_deleted?: number
  total_attempted?: number
  results?: BulkDeleteEntry[]
  error?: string
}

export interface RenameResponse {
  success: boolean
  new_file_path: string
  new_preview_path?: string | null
}

/** POST /{prefix}/move_model. The backend auto-renames on a name conflict, so read `new_file_path`. */
export interface MoveResponse {
  success: boolean
  original_file_path?: string
  new_file_path?: string | null
  message?: string
  error?: string
}

export interface BulkMoveEntry {
  original_file_path: string
  new_file_path: string | null
  success: boolean
  message?: string
}

export interface BulkMoveResponse {
  success: boolean
  message?: string
  results?: BulkMoveEntry[]
  success_count?: number
  failure_count?: number
}

export interface OrganizePlannedMove {
  model: string
  from: string
  to: string
  status?: string
  reason?: string
}

export interface OrganizeResultEntry {
  model: string
  success: boolean
  status?: 'skipped' | 'issue' | string
  reason?: string | null
  message?: string
  from?: string
  to?: string
}

export interface OrganizeSummary {
  total?: number
  success?: number
  skipped?: number
  failures?: number
  organization_type?: string
  path_template?: string | null
  cleaned_dirs?: Record<string, number>
  operation_type?: string
}

/** GET/POST /{prefix}/auto-organize (dry run or real run). */
export interface OrganizeResponse {
  success: boolean
  status?: string
  message?: string
  dry_run?: boolean
  summary?: OrganizeSummary
  planned_moves?: OrganizePlannedMove[]
  results?: OrganizeResultEntry[]
  results_truncated?: boolean
  sample_results?: OrganizeResultEntry[]
}

/** Snapshot of a running auto-organize (GET /{prefix}/auto-organize-progress). */
export interface OrganizeProgress {
  status?: string
  total?: number
  processed?: number
  success?: number
  failures?: number
  skipped?: number
  message?: string
  error?: string
  operation_type?: string
}

export interface WorkflowRegistry {
  nodes: Record<string, import('@/utils/workflow').RegistryNode>
  node_count?: number
  tab_count?: number
}
