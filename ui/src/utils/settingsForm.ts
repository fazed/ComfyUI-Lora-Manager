/** Pure helpers for the curated Settings form. */

import type { SettingsMap } from '@/api/types'

export const MIN_CONCURRENCY = 1
export const MAX_CONCURRENCY = 5
export const TEMPLATE_TYPES = ['lora', 'checkpoint', 'embedding'] as const
export type TemplateType = (typeof TEMPLATE_TYPES)[number]

export const ROOT_KEYS = [
  { key: 'default_lora_root', prefix: 'loras' },
  { key: 'default_checkpoint_root', prefix: 'checkpoints' },
  { key: 'default_unet_root', prefix: 'checkpoints' },
  { key: 'default_embedding_root', prefix: 'embeddings' },
] as const

export const TOGGLE_KEYS = ['skip_previously_downloaded_model_versions', 'show_only_sfw', 'blur_mature_content'] as const

export interface SettingsDraft {
  roots: Record<string, string>
  filenameTemplates: Record<TemplateType, string>
  pathTemplates: Record<TemplateType, string>
  /** v-model on a number input may hand back a number. */
  concurrency: string | number
  toggles: Record<string, boolean>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function draftFromSettings(settings: SettingsMap): SettingsDraft {
  const filename = asRecord(settings.download_filename_templates)
  const path = asRecord(settings.download_path_templates)
  return {
    roots: Object.fromEntries(ROOT_KEYS.map(({ key }) => [key, String(settings[key] ?? '')])),
    filenameTemplates: Object.fromEntries(TEMPLATE_TYPES.map((type) => [type, String(filename[type] ?? '')])) as Record<TemplateType, string>,
    pathTemplates: Object.fromEntries(TEMPLATE_TYPES.map((type) => [type, String(path[type] ?? '')])) as Record<TemplateType, string>,
    concurrency: String(settings.download_queue_max_concurrent ?? MAX_CONCURRENCY),
    toggles: Object.fromEntries(TOGGLE_KEYS.map((key) => [key, !!settings[key]])),
  }
}

/** Returns an error message key-friendly string or null when valid. */
export function validateConcurrency(value: string | number): string | null {
  const trimmed = String(value ?? '').trim()
  if (!/^\d+$/.test(trimmed)) return 'integerRange'
  const number = Number(trimmed)
  return number >= MIN_CONCURRENCY && number <= MAX_CONCURRENCY ? null : 'integerRange'
}

/**
 * Merge template edits into the original object: keeps keys this form does
 * not manage, drops keys the user emptied (empty = use the backend default).
 */
function mergeTemplates(original: unknown, edits: Record<string, string>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...asRecord(original) }
  for (const [type, value] of Object.entries(edits)) {
    const trimmed = value.trim()
    if (trimmed) merged[type] = trimmed
    else delete merged[type]
  }
  return merged
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Only the keys whose value actually changed. */
export function buildSettingsPatch(settings: SettingsMap, draft: SettingsDraft): SettingsMap {
  const patch: SettingsMap = {}
  for (const { key } of ROOT_KEYS) {
    const value = draft.roots[key] ?? ''
    if (!same(String(settings[key] ?? ''), value)) patch[key] = value
  }
  const filename = mergeTemplates(settings.download_filename_templates, draft.filenameTemplates)
  if (!same(asRecord(settings.download_filename_templates), filename)) patch.download_filename_templates = filename
  const path = mergeTemplates(settings.download_path_templates, draft.pathTemplates)
  if (!same(asRecord(settings.download_path_templates), path)) patch.download_path_templates = path
  if (validateConcurrency(draft.concurrency) === null) {
    const concurrency = Number(String(draft.concurrency).trim())
    if (concurrency !== Number(settings.download_queue_max_concurrent)) patch.download_queue_max_concurrent = concurrency
  }
  for (const key of TOGGLE_KEYS) {
    if (!!settings[key] !== draft.toggles[key]) patch[key] = draft.toggles[key]
  }
  return patch
}
