/**
 * Pure helpers of the recipe pages (port of the classic RecipeCard /
 * RecipeModal / ImportManager logic): LoRA status, analysis normalisation,
 * save metadata, missing-LoRA download input, reconnect and import parsing.
 * No I/O.
 */

import type { AnalysisLora, RecipeAnalysis, RecipeCheckpoint, RecipeItem, RecipeLora, MatchingRecipe } from '@/api/types'

export type LoraState = 'library' | 'missing' | 'deleted' | 'excluded'

/** Same order as the classic card: excluded, deleted / hash-invalid (not downloadable), in library, missing. */
export function loraState(lora: Pick<RecipeLora, 'inLibrary' | 'isDeleted' | 'hashInvalid' | 'exclude'>): LoraState {
  if (lora.exclude) return 'excluded'
  if (lora.inLibrary) return 'library'
  if (lora.isDeleted || lora.hashInvalid) return 'deleted'
  return 'missing'
}

export interface RecipeLoraView {
  index: number
  name: string
  version: string
  fileName: string
  strength: number
  state: LoraState
  previewUrl: string
  localPath: string
  hash: string
  versionId: number | null
  /** Name of the entry before a manual reconnect (restore is possible). */
  previousName: string | null
  canReconnect: boolean
}

function finite(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN
  return Number.isFinite(number) ? number : fallback
}

export function recipeLoraViews(recipe: Pick<RecipeItem, 'loras'>): RecipeLoraView[] {
  return (recipe.loras ?? []).map((lora, index) => {
    const snapshot = lora.reconnectSnapshot
    const previous = snapshot && typeof snapshot === 'object' ? String(snapshot.file_name || snapshot.modelName || '') : ''
    return {
      index,
      name: lora.modelName || lora.file_name || `LoRA ${index + 1}`,
      version: lora.modelVersionName ?? '',
      fileName: lora.file_name ?? '',
      strength: finite(lora.strength, 1),
      state: loraState(lora),
      previewUrl: lora.preview_url ?? '',
      localPath: lora.localPath ?? '',
      hash: (lora.hash ?? '').toLowerCase(),
      versionId: typeof lora.modelVersionId === 'number' && lora.modelVersionId > 0 ? lora.modelVersionId : null,
      previousName: snapshot ? previous || '?' : null,
      // Every entry can be pointed at another library LoRA (the classic modal allows it too).
      canReconnect: true,
    }
  })
}

export interface Availability {
  total: number
  library: number
  missing: number
  deleted: number
}

/** Excluded LoRAs do not count (the backend skips them as well). */
export function availability(loras: readonly RecipeLora[]): Availability {
  const result: Availability = { total: 0, library: 0, missing: 0, deleted: 0 }
  for (const lora of loras) {
    const state = loraState(lora)
    if (state === 'excluded') continue
    result.total += 1
    result[state] += 1
  }
  return result
}

export interface MissingLoraTarget {
  versionId: number
  name: string
  /** De-duplication key (hash, else version id). */
  key: string
}

/**
 * Missing, still downloadable LoRAs of the given recipes, de-duplicated by
 * hash / version id (classic BulkMissingLoraDownloadManager.collectMissingLoras).
 * Entries without a Civitai version id cannot be resolved and are only counted.
 */
export function missingLoraTargets(recipes: readonly Pick<RecipeItem, 'loras'>[]): { targets: MissingLoraTarget[]; withoutVersion: number } {
  const targets: MissingLoraTarget[] = []
  const seen = new Set<string>()
  let withoutVersion = 0
  for (const recipe of recipes) {
    for (const lora of recipe.loras ?? []) {
      if (loraState(lora) !== 'missing') continue
      const versionId = typeof lora.modelVersionId === 'number' && lora.modelVersionId > 0 ? lora.modelVersionId : null
      const key = (lora.hash || '').toLowerCase() || (versionId ? `v${versionId}` : '')
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      if (!versionId) {
        withoutVersion += 1
        continue
      }
      targets.push({ versionId, name: lora.modelName || lora.file_name || `#${versionId}`, key })
    }
  }
  return { targets, withoutVersion }
}

/** Input for the B1 download dialog: one Civitai download link per version. */
export function missingLorasInput(targets: readonly Pick<MissingLoraTarget, 'versionId'>[]): string {
  return targets.map((target) => `https://civitai.com/api/download/models/${target.versionId}`).join('\n')
}

/** `<lora:folder/name:0.8>` or `name.safetensors` -> `folder/name` / `name` (classic RecipeModal.reconnectLora). */
export function parseReconnectInput(value: string): string {
  const trimmed = value.trim()
  const syntax = trimmed.match(/<lora:([^:>]+)(?::[^>]+)?>/)
  return (syntax ? syntax[1] : trimmed).trim().replace(/\.safetensors$/i, '')
}

/** Comma-separated tags, trimmed, de-duplicated case-insensitively (first spelling wins). */
export function parseTagInput(text: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(',')) {
    const tag = raw.trim()
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    result.push(tag)
  }
  return result
}

const IMAGE_PATH = /\.(png|jpe?g|webp|gif|bmp|avif|jxl|mp4|webm)$/i

export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

/** A local image/video path on the server (classic ImageProcessor.handleUrlInput rule). */
export function isLocalImagePath(value: string): boolean {
  return !isHttpUrl(value) && IMAGE_PATH.test(value.trim())
}

export interface BatchImportItem {
  source: string
  type: 'url' | 'local_path'
}

/** One source per line: http(s) URLs or local image paths; everything else is reported. */
export function parseBatchImportInput(text: string): { items: BatchImportItem[]; invalid: string[]; duplicates: number } {
  const items: BatchImportItem[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  let duplicates = 0
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (!line) continue
    const type = isHttpUrl(line) ? 'url' : isLocalImagePath(line) ? 'local_path' : null
    if (!type) {
      invalid.push(line)
      continue
    }
    if (seen.has(line)) {
      duplicates += 1
      continue
    }
    seen.add(line)
    items.push({ source: line, type })
  }
  return { items, invalid, duplicates }
}

// --- Import analysis ---------------------------------------------------------

export interface AnalysisLoraView {
  name: string
  version: string
  strength: number
  state: Exclude<LoraState, 'excluded'>
  thumbnailUrl: string
  baseModel: string
  versionId: number | null
  modelId: number | null
  earlyAccess: boolean
}

export interface AnalysisCheckpointView {
  name: string
  version: string
  state: Exclude<LoraState, 'excluded'>
  thumbnailUrl: string
}

export interface AnalysisView {
  error: string | null
  loras: AnalysisLoraView[]
  checkpoint: AnalysisCheckpointView | null
  baseModel: string
  genParams: Record<string, unknown>
  matching: MatchingRecipe[]
  missing: number
  deleted: number
  /** Input for the B1 download dialog (missing, downloadable LoRAs), '' when none. */
  downloadInput: string
}

function analysisState(entry: Pick<AnalysisLora, 'existsLocally' | 'inLibrary' | 'isDeleted' | 'hashInvalid'>): AnalysisLoraView['state'] {
  if (entry.existsLocally || entry.inLibrary) return 'library'
  if (entry.isDeleted || entry.hashInvalid) return 'deleted'
  return 'missing'
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function analysisCheckpoint(raw: RecipeAnalysis): RecipeCheckpoint | null {
  const entry = raw.checkpoint ?? raw.model ?? null
  return entry && typeof entry === 'object' ? entry : null
}

export function normalizeAnalysis(raw: RecipeAnalysis): AnalysisView {
  const loras = (Array.isArray(raw.loras) ? raw.loras : []).map((lora) => ({
    name: lora.name || lora.file_name || '?',
    version: lora.version ?? '',
    strength: finite(lora.weight ?? lora.strength, 1),
    state: analysisState(lora),
    thumbnailUrl: lora.thumbnailUrl ?? '',
    baseModel: lora.baseModel ?? '',
    versionId: positiveId(lora.id),
    modelId: positiveId(lora.modelId),
    earlyAccess: !!lora.isEarlyAccess,
  }))
  const checkpoint = analysisCheckpoint(raw)
  const lines: string[] = []
  const seen = new Set<number>()
  for (const lora of loras) {
    if (lora.state !== 'missing' || !lora.versionId || seen.has(lora.versionId)) continue
    seen.add(lora.versionId)
    lines.push(
      lora.modelId
        ? `https://civitai.com/models/${lora.modelId}?modelVersionId=${lora.versionId}`
        : `https://civitai.com/api/download/models/${lora.versionId}`,
    )
  }
  return {
    error: typeof raw.error === 'string' && raw.error ? raw.error : null,
    loras,
    checkpoint: checkpoint
      ? {
          name: checkpoint.name || checkpoint.modelName || checkpoint.file_name || '?',
          version: checkpoint.version || checkpoint.modelVersionName || '',
          state: analysisState({
            existsLocally: checkpoint.existsLocally,
            inLibrary: checkpoint.inLibrary,
            isDeleted: checkpoint.isDeleted,
            hashInvalid: checkpoint.hashInvalid,
          }),
          thumbnailUrl: checkpoint.thumbnailUrl || checkpoint.preview_url || '',
        }
      : null,
    baseModel: raw.base_model ?? '',
    genParams: raw.gen_params && typeof raw.gen_params === 'object' ? raw.gen_params : {},
    matching: Array.isArray(raw.matching_recipes) ? raw.matching_recipes.filter((entry) => entry && typeof entry === 'object') : [],
    missing: loras.filter((lora) => lora.state === 'missing').length,
    deleted: loras.filter((lora) => lora.state === 'deleted').length,
    downloadInput: lines.join('\n'),
  }
}

/** First 10 words of the prompt, else the file name without its extension (classic RecipeDataManager). */
export function defaultRecipeName(raw: RecipeAnalysis, fileName?: string): string {
  const prompt = raw.gen_params?.prompt
  if (typeof prompt === 'string' && prompt.trim()) return prompt.trim().split(/\s+/).slice(0, 10).join(' ')
  if (fileName) return fileName.replace(/\.[^.]+$/, '')
  return ''
}

/** The `metadata` field of POST /recipes/save (classic import DownloadManager.saveRecipe). */
export function buildSaveMetadata(raw: RecipeAnalysis, sourcePath?: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    base_model: raw.base_model || '',
    loras: raw.loras ?? [],
    gen_params: raw.gen_params ?? {},
    raw_metadata: raw.raw_metadata ?? {},
  }
  if (raw.diagnostics && typeof raw.diagnostics === 'object') metadata.diagnostics = raw.diagnostics
  if (raw.workflow) metadata.workflow = raw.workflow
  if (raw.preview_nsfw_level !== undefined && raw.preview_nsfw_level !== null) metadata.preview_nsfw_level = raw.preview_nsfw_level
  const checkpoint = analysisCheckpoint(raw) ?? (raw.gen_params?.checkpoint as RecipeCheckpoint | undefined)
  if (checkpoint && typeof checkpoint === 'object') metadata.checkpoint = checkpoint
  if (sourcePath) metadata.source_path = sourcePath
  return metadata
}
