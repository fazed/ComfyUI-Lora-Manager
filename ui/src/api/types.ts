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
  type?: string
  nsfwLevel?: number
  width?: number
  height?: number
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
