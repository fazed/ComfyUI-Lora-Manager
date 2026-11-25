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
  /** Imported example images (`custom_<id>` files in the example folder). */
  customImages?: CivitaiImage[]
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
  earlyAccessEndsAt?: string | null
  isPaid?: boolean
  /** Civitai paidAccess DTO (`{permanent, endsAt}`), null when not gated. */
  paidAccess?: { permanent?: boolean; endsAt?: string | null } | null
  /** "Download", "Generation", "InternalGeneration"; null when unknown. */
  usageControl?: string | null
  /** Number of downloadable weight files (null when unknown). */
  fileCount?: number | null
  fileName?: string | null
  /** Local file of an in-library version (from the scanner at read time). */
  filePath?: string | null
}

export interface ModelUpdateRecord {
  modelId: number
  hasUpdate: boolean
  shouldIgnore?: boolean
  lastCheckedAt?: number
  versions: ModelVersionInfo[]
}

// --- Updates overview (GET /api/lm/{prefix}/updates/overview) --------------

/** How sure the classifier is that a candidate is a real successor. */
export type UpdateConfidence = 'likely' | 'possible' | 'variant'
/** Which filter a model line appears under (its best visible candidate). */
export type UpdateTier = 'likely' | 'possible' | 'hidden'
/** Classification reason codes (py/services/update_classifier.py REASON_CODES). */
export type UpdateReason =
  | 'next_version_same_base'
  | 'looks_like_format_variant'
  | 'same_release_variant'
  | 'sibling_variant'
  | 'same_day_as_owned'
  | 'parallel_line'
  | 'lower_version_number'
  | 'same_version_number'
  | 'new_label'
  | 'variant_tokens'
  | 'unknown_release_date'
  | 'unknown_base'
  | 'other_base'
/** Gates that keep a candidate out of the default view (HIDDEN_CODES). */
export type UpdateHiddenReason =
  | 'ignored'
  | 'other_base'
  | 'not_downloadable'
  | 'no_files'
  | 'early_access'
  | 'paid'
  | 'already_downloaded'

export interface UpdateCandidate {
  versionId: number
  name: string | null
  baseModel: string | null
  releasedAt: string | null
  sizeBytes: number | null
  fileCount: number | null
  usageControl: string | null
  isEarlyAccess: boolean
  earlyAccessEndsAt: string | null
  isPaid: boolean
  previewUrl: string | null
  hasBeenDownloaded: boolean
  isIgnored: boolean
  confidence: UpdateConfidence
  reason: UpdateReason
  hiddenBecause: UpdateHiddenReason[]
  /** Changelog as plain text (capped by the backend); null until the next Check now. Phase 2. */
  description?: string | null
  /** Format / precision of the primary weight file ("SafeTensor", "fp16"); null when unknown. */
  fileFormat?: string | null
  precision?: string | null
  /** Weight files of the version (primary first); [] when unknown. */
  files?: UpdateFileInfo[]
}

export interface UpdateFileInfo {
  type: string | null
  format: string | null
  precision: string | null
  /** Civitai's size label ("full" / "pruned"). */
  size: string | null
  sizeBytes: number | null
  primary: boolean
}

/** `POST /api/lm/{prefix}/updates/ignore(-version)` answer (only the parts the UI reads). */
export interface UpdateIgnoreResponse {
  success: boolean
  record?: unknown
}

export interface UpdateLocalCard {
  filePath: string
  fileName: string | null
  folder: string
  baseModel: string | null
  versionId: number
  versionName: string | null
  releasedAt: string | null
  sizeBytes: number | null
  previewUrl: string | null
  previewNsfwLevel: number
}

export interface UpdateGroup {
  /** `<modelId>:<lowercased base>` - stable row key. */
  key: string
  modelId: number
  modelName: string | null
  baseModel: string | null
  tier: UpdateTier
  isIgnored: boolean
  /** ISO time of the last Civitai check of this model, null = never. */
  lastCheckedAt: string | null
  /** Versions of this line owned right now (scanner, not the persisted flag). */
  ownedVersionIds: number[]
  newestOwned: { versionId: number; name: string | null; releasedAt: string | null; sizeBytes: number | null }
  previewNsfwLevel: number
  localCards: UpdateLocalCard[]
  /** Best first: visible before hidden, likely before possible before variant, newest first. */
  candidates: UpdateCandidate[]
}

export interface UpdatesOverview {
  success: boolean
  modelType: string
  settings: { hideEarlyAccessUpdates: boolean; hidePaidUpdates: boolean }
  totals: { likely: number; possible: number; hidden: number; groups: number; upToDate: number }
  models: { local: number; tracked: number; checked: number; untracked: number; neverChecked: number }
  /** Local models with a Civitai id that were never checked (no record, or never refreshed). */
  unchecked: number
  oldestCheckedAt: string | null
  newestCheckedAt: string | null
  groups: UpdateGroup[]
}

/** `POST /api/lm/{prefix}/updates/refresh` answer (only the parts the UI reads). */
export interface UpdatesRefreshResponse {
  success: boolean
  records?: unknown[]
  status?: string
  message?: string
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
  /** JSON `{model_root, relative_path, use_default_paths}`; null = default root + template. */
  destination?: string | null
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

/** One LoRA of a stored recipe (`<id>.recipe.json`), enriched on read with inLibrary/localPath/preview_url. */
export interface RecipeLora {
  file_name?: string
  hash?: string
  strength?: number
  modelVersionId?: number | null
  modelName?: string
  modelVersionName?: string
  isDeleted?: boolean
  hashInvalid?: boolean
  exclude?: boolean
  inLibrary?: boolean
  localPath?: string | null
  preview_url?: string
  folder?: string
  reconnectSnapshot?: Record<string, unknown> | null
}

export interface RecipeCheckpoint {
  type?: string
  name?: string
  file_name?: string
  hash?: string
  id?: number | null
  modelId?: number | null
  modelVersionId?: number | null
  modelName?: string
  modelVersionName?: string
  version?: string
  baseModel?: string
  inLibrary?: boolean
  existsLocally?: boolean
  isDeleted?: boolean
  hashInvalid?: boolean
  localPath?: string | null
  preview_url?: string
  thumbnailUrl?: string
  reconnectSnapshot?: Record<string, unknown> | null
}

export interface RecipeItem {
  id: string
  title?: string
  file_url?: string
  file_path?: string
  folder?: string
  base_model?: string
  tags?: string[]
  favorite?: boolean
  loras?: RecipeLora[]
  checkpoint?: RecipeCheckpoint | null
  gen_params?: Record<string, unknown>
  source_path?: string
  fingerprint?: string
  has_workflow?: boolean
  preview_nsfw_level?: number
  width?: number
  height?: number
  recipe_json_path?: string
  created_date?: number
  modified?: number
}

/** A LoRA detected by the analyze endpoints (parser output). */
export interface AnalysisLora {
  name?: string
  version?: string
  file_name?: string
  hash?: string
  weight?: number
  strength?: number
  id?: number | null
  modelId?: number | null
  existsLocally?: boolean
  inLibrary?: boolean
  localPath?: string | null
  thumbnailUrl?: string
  baseModel?: string
  isDeleted?: boolean
  hashInvalid?: boolean
  isEarlyAccess?: boolean
  size?: number
  type?: string
}

export interface MatchingRecipe {
  id: string
  title?: string
  file_url?: string
  modified?: number
  created_date?: number
  lora_count?: number
}

/** POST /recipes/analyze-image | analyze-local-image. `error` with HTTP 200 = no usable metadata. */
export interface RecipeAnalysis {
  error?: string
  loras?: AnalysisLora[]
  checkpoint?: RecipeCheckpoint | null
  model?: RecipeCheckpoint | null
  gen_params?: Record<string, unknown>
  base_model?: string
  raw_metadata?: Record<string, unknown>
  image_base64?: string
  extension?: string
  is_video?: boolean
  fingerprint?: string
  matching_recipes?: MatchingRecipe[]
  diagnostics?: Record<string, unknown>
  workflow?: unknown
  preview_nsfw_level?: number
  parser?: string
}

export interface ReconnectSuggestion {
  file_name: string
  file_path?: string
  model_name?: string
  base_model?: string
  preview_url?: string
  hash?: string
  score?: number
  match_reason?: string
  target_name: string
}

export interface RecipeDuplicateGroup {
  type?: string
  key: string
  fingerprint?: string
  count?: number
  recipes: MatchingRecipe[]
}

export interface BatchImportItemProgress {
  id?: string
  source: string
  item_type?: string
  status: string
  error_message?: string | null
  recipe_name?: string | null
  recipe_id?: string | null
}

export interface BatchImportProgress {
  operation_id?: string
  total: number
  completed: number
  success: number
  failed: number
  skipped: number
  current_item?: string
  status: string
  progress_percent?: number
  items?: BatchImportItemProgress[]
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

// --- Phase B1: downloads ------------------------------------------------------

export interface CivitaiFile {
  id: number
  name?: string
  type?: string
  sizeKB?: number
  primary?: boolean
  metadata?: { format?: string; size?: string; fp?: string } | null
}

export interface CivitaiDownloadedFile {
  fileId?: number | null
  fileName?: string
  filePath?: string
}

/** One entry of GET /{prefix}/civitai/versions/{model_id} (Civitai modelVersions[] + local state). */
export interface CivitaiVersion {
  id: number
  modelId?: number
  name?: string
  baseModel?: string
  createdAt?: string
  availability?: string
  images?: { url: string; type?: string; nsfwLevel?: number }[]
  files?: CivitaiFile[]
  existsLocally?: boolean
  localPath?: string
  hasBeenDownloaded?: boolean
  downloadedFiles?: CivitaiDownloadedFile[]
  modelSizeKB?: number
  modelTags?: string[]
  model?: { name?: string; type?: string } | null
}

/** file_params of queue/add (classic DownloadManager shape). */
export interface DownloadFileParams {
  id: number
  name?: string
  type?: string
  format?: string
  size?: string
  fp?: string
}

/** Destination params of queue/add (empty = default root + path template). */
export interface DestinationParams {
  model_root?: string
  relative_path?: string
  use_default_paths?: 'true' | 'false'
}

// --- Phase B1: model tools ----------------------------------------------------

export interface PreviewResponse {
  success: boolean
  preview_url?: string
  preview_nsfw_level?: number
}

export interface DuplicateGroup {
  hash: string
  models: ModelItem[]
}

export interface FilenameConflict {
  filename: string
  models: ModelItem[]
}

export interface VerifyDuplicatesResponse {
  success: boolean
  verified_as_duplicates: boolean
  mismatched_files: string[]
  new_hash_map: Record<string, string>
}

/** POST /{prefix}/delete-folder (dry run or real); refusals come back with `code`. */
export interface DeleteFolderResponse {
  success: boolean
  dry_run?: boolean
  folder?: string
  folder_path?: string
  code?: string
  error?: string
  already_missing?: boolean
  model_count?: number
  excluded_model_count?: number
  file_count?: number
  dir_count?: number
  total_bytes?: number
  restorable?: boolean
  manifest?: { model_count?: number; excluded_model_count?: number; file_count?: number } | null
}

export interface FolderCandidate {
  folder_path: string
  root: string
  is_symlink?: boolean
}

export interface FetchCivitaiResponse {
  success: boolean
  metadata?: Partial<ModelItem> | null
  error?: string
}

export interface WorkflowRegistry {
  nodes: Record<string, import('@/utils/workflow').RegistryNode>
  node_count?: number
  tab_count?: number
}
