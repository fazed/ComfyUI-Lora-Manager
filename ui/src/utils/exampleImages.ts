/**
 * Local example images (phase B2b): matching the files of
 * `GET /example-image-files` to the metadata entries, request bodies and the
 * download-status normalisation. See ui/README.md ("Example images").
 */

import type { CivitaiImage } from '@/api/types'

export interface ExampleFile {
  name: string
  path: string
  extension?: string
  is_video?: boolean
}

export type ExampleSource = 'civitai' | 'custom'

export interface ExampleMedia {
  /** Stable key for v-for. */
  key: string
  source: ExampleSource
  /** Position in `civitai.images` (regular) or `civitai.customImages` (custom). */
  index: number
  /** Custom image id (`custom_<id>` file). */
  id: string | null
  /** Displayable URL: the local file when present, else the remote URL ('' when neither). */
  url: string
  local: boolean
  localName: string | null
  isVideo: boolean
  nsfwLevel: number
  image: CivitaiImage
}

/** Civitai browsing levels as the classic UI offers them. */
export const NSFW_LEVELS = [
  { value: 1, label: 'PG' },
  { value: 2, label: 'PG-13' },
  { value: 4, label: 'R' },
  { value: 8, label: 'X' },
  { value: 16, label: 'XXX' },
] as const

export function nsfwLabel(level: number | undefined): string {
  if (!level) return 'Unrated'
  const known = [...NSFW_LEVELS].reverse().find((entry) => level >= entry.value)
  return known?.label ?? 'Unrated'
}

const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i

/**
 * The classic resolver: a custom entry (string id) matches `custom_<id>*`, a
 * regular entry matches `image_<index>.` by its index in the SOURCE array
 * (not the index after filtering).
 */
export function findLocalFile(image: CivitaiImage, index: number, source: ExampleSource, files: ExampleFile[]): ExampleFile | null {
  if (!files.length) return null
  if (source === 'custom') {
    const id = typeof image.id === 'string' ? image.id : ''
    if (!id) return null
    return files.find((file) => file.name.startsWith(`custom_${id}`)) ?? null
  }
  return (
    files.find((file) => {
      const match = /^image_(\d+)\./.exec(file.name)
      return !!match && Number(match[1]) === index
    }) ?? null
  )
}

export function buildExampleMedia(images: CivitaiImage[] | undefined, customImages: CivitaiImage[] | undefined, files: ExampleFile[]): ExampleMedia[] {
  const result: ExampleMedia[] = []
  const add = (image: CivitaiImage, index: number, source: ExampleSource) => {
    if (!image || typeof image !== 'object') return
    const file = findLocalFile(image, index, source, files)
    const remote = typeof image.url === 'string' ? image.url : ''
    const url = file?.path || remote
    if (!url) return
    result.push({
      key: source === 'custom' ? `custom:${String(image.id)}` : `civitai:${index}`,
      source,
      index,
      id: source === 'custom' && typeof image.id === 'string' ? image.id : null,
      url,
      local: !!file,
      localName: file?.name ?? null,
      isVideo: !!file?.is_video || VIDEO_RE.test(remote) || String(image.type ?? '').toLowerCase() === 'video',
      nsfwLevel: Number(image.nsfwLevel ?? 0) || 0,
      image,
    })
  }
  ;(images ?? []).forEach((image, index) => add(image, index, 'civitai'))
  ;(customImages ?? []).forEach((image, index) => add(image, index, 'custom'))
  return result
}

/** Files that do not belong to any entry (e.g. downloaded before the metadata changed). */
export function unmatchedFiles(media: ExampleMedia[], files: ExampleFile[]): ExampleFile[] {
  const used = new Set(media.map((item) => item.localName).filter(Boolean))
  return files.filter((file) => !used.has(file.name))
}

export function nsfwBody(hash: string, item: Pick<ExampleMedia, 'source' | 'index' | 'id'>, level: number) {
  return item.source === 'custom'
    ? { model_hash: hash, nsfw_level: level, source: 'custom' as const, id: item.id ?? '' }
    : { model_hash: hash, nsfw_level: level, source: 'civitai' as const, index: item.index }
}

export const IMPORT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.jxl', '.mp4', '.webm']

export function isImportable(name: string): boolean {
  const lower = name.toLowerCase()
  return IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** Multipart body in the order the backend expects: model_hash, model_path, then the files. */
export function buildImportForm(hash: string, modelPath: string, files: File[]): FormData {
  const form = new FormData()
  form.append('model_hash', hash)
  if (modelPath) form.append('model_path', modelPath)
  for (const file of files) form.append('files', file, file.name)
  return form
}

/** Backend expects the lower-case hash (exact match against the cache). */
export function normaliseHash(hash: string | undefined | null): string {
  return String(hash ?? '').trim().toLowerCase()
}

// --------------------------------------------------------------------------- bulk download status

export type DownloadState = 'idle' | 'running' | 'paused' | 'stopping' | 'stopped' | 'completed' | 'error'

export interface ExampleDownloadStatus {
  downloading: boolean
  state: DownloadState
  total: number
  completed: number
  percent: number
  current: string
  errors: string[]
  lastError: string
  elapsedSeconds: number
  failed: number
  retryable: number
}

const STATES: DownloadState[] = ['idle', 'running', 'paused', 'stopping', 'stopped', 'completed', 'error']

function count(status: Record<string, unknown>, key: string): number {
  const countValue = status[`${key}_count`]
  if (typeof countValue === 'number') return countValue
  const list = status[`${key}_models`]
  return Array.isArray(list) ? list.length : 0
}

export function normaliseDownloadStatus(raw: unknown): ExampleDownloadStatus {
  const payload = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const status = (payload.status && typeof payload.status === 'object' ? payload.status : {}) as Record<string, unknown>
  const state = STATES.includes(status.status as DownloadState) ? (status.status as DownloadState) : 'idle'
  const total = Math.max(0, Number(status.total) || 0)
  const completed = Math.min(total, Math.max(0, Number(status.completed) || 0))
  const errors = Array.isArray(status.errors) ? status.errors.map(String) : []
  let elapsed = Number(status.elapsed_seconds)
  if (!Number.isFinite(elapsed)) {
    const start = Number(status.start_time)
    elapsed = Number.isFinite(start) && start > 0 ? Math.max(0, Date.now() / 1000 - start) : 0
  }
  return {
    downloading: !!payload.is_downloading,
    state,
    total,
    completed,
    percent: total ? Math.round((completed / total) * 100) : 0,
    current: String(status.current_model ?? ''),
    errors: errors.slice(-3),
    lastError: String(status.last_error ?? ''),
    elapsedSeconds: Math.round(elapsed),
    failed: count(status, 'failed'),
    retryable: count(status, 'retryable'),
  }
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = s % 60
  return h ? `${h}h ${m}m` : m ? `${m}m ${rest}s` : `${rest}s`
}

export const DOWNLOAD_MODEL_TYPES = ['lora', 'checkpoint', 'embedding'] as const

/** Singular model type for a library prefix (`loras` -> `lora`). */
export function modelTypeOf(prefix: string): string {
  return prefix === 'loras' ? 'lora' : prefix === 'checkpoints' ? 'checkpoint' : prefix === 'embeddings' ? 'embedding' : prefix
}
