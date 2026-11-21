/**
 * Settings form model (phase B2b): a schema-driven draft of the backend
 * settings with validation, dirty tracking, secret handling and the patch
 * that is sent to `POST /api/lm/settings`.
 *
 * Backend facts this relies on (ui/README.md, "Phase B2b discovery"):
 * - POST handles keys in order and writes each one immediately, so keys
 *   before a failing key are saved. `orderPatch` puts the server-validated
 *   keys first: a rejected value then saves nothing.
 * - GET returns the three API keys only as `*_set` flags but returns
 *   `proxy_password` in clear; `sanitizeSettings` drops it.
 * - `"__DELETE__"` removes `proxy_username` / `proxy_password`.
 */

import type { SettingsMap } from '@/api/types'
import type { MessageKey } from '@/i18n'

export type FieldType =
  | 'toggle'
  | 'select'
  | 'number'
  | 'text'
  | 'path'
  | 'textarea'
  | 'list'
  | 'secret'
  | 'root'
  | 'checkboxes'
  | 'map'
  | 'pathTemplate'
  | 'filenameTemplate'

export interface FieldOption {
  value: string
  label: string
}

/** What a change does beyond storing the value (shown next to the field and in the save confirm). */
export type FieldEffect = 'restart' | 'moves-files' | 'relocates-settings' | 'rebuilds-roots' | 'classic-only'

export interface FieldDef {
  /** Settings key; a dotted key (`download_path_templates.lora`) edits one entry of an object setting. */
  key: string
  type: FieldType
  label: MessageKey
  hint?: MessageKey
  options?: FieldOption[]
  min?: number
  max?: number
  step?: number
  /** number fields: whole numbers only. */
  integer?: boolean
  /** Backend default, used by "Reset to default". */
  default?: unknown
  /** secret fields: the `*_set` flag of GET and whether clearing sends `__DELETE__`. */
  secretFlag?: string
  deleteMarker?: boolean
  /** root fields: where the options come from (see SettingsPage). */
  rootsSource?: string
  effect?: FieldEffect
  /** Extra confirm text when this field changes (destructive side effects). */
  confirm?: MessageKey
  placeholder?: string
  visibleWhen?: (draft: Draft) => boolean
  validate?: (value: DraftValue, draft: Draft) => ValidationError | null
}

export interface ValidationError {
  key: MessageKey
  params?: Record<string, string | number>
}

export interface SecretDraft {
  mode: 'keep' | 'set' | 'clear'
  value: string
}

export type DraftValue = string | boolean | string[] | SecretDraft
export type Draft = Record<string, DraftValue>

export const SECRET_KEYS = ['civitai_api_key', 'huggingface_api_key', 'llm_api_key', 'proxy_password'] as const
export const DELETE_MARKER = '__DELETE__'

/** Keys the backend validates (or may reject with a ValueError); sent first. */
export const VALIDATED_FIRST = [
  'example_images_path',
  'download_queue_max_concurrent',
  'update_channel',
  'extra_folder_paths',
  'default_other_roots',
  'recipes_path',
] as const

// --------------------------------------------------------------------------- read

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Drop secret values a GET may carry (proxy_password comes back in clear) and keep a `*_set` flag. */
export function sanitizeSettings(raw: SettingsMap): SettingsMap {
  const clean: SettingsMap = { ...raw }
  for (const key of SECRET_KEYS) {
    if (key in clean) {
      const value = clean[key]
      delete clean[key]
      if (clean[`${key}_set`] === undefined) clean[`${key}_set`] = typeof value === 'string' ? value.length > 0 : !!value
    }
  }
  return clean
}

export function readSetting(settings: SettingsMap, key: string): unknown {
  const [top, sub] = splitKey(key)
  const value = settings[top]
  return sub === null ? value : asRecord(value)[sub]
}

function splitKey(key: string): [string, string | null] {
  const dot = key.indexOf('.')
  return dot < 0 ? [key, null] : [key.slice(0, dot), key.slice(dot + 1)]
}

export function splitList(text: string): string[] {
  const seen = new Set<string>()
  for (const part of text.split(/[,;\n\r]+/)) {
    const value = part.trim()
    if (value) seen.add(value)
  }
  return [...seen]
}

/** `Base = folder` per line <-> object. */
export function parseMap(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index < 0) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (key && value) result[key] = value
  }
  return result
}

export function formatMap(value: unknown): string {
  return Object.entries(asRecord(value))
    .map(([key, folder]) => `${key} = ${String(folder ?? '')}`)
    .join('\n')
}

export function toDraftValue(field: FieldDef, raw: unknown): DraftValue {
  switch (field.type) {
    case 'toggle':
      return raw === undefined || raw === null ? !!field.default : !!raw
    case 'secret':
      return { mode: 'keep', value: '' }
    case 'list':
      return Array.isArray(raw) ? raw.map(String).join('\n') : ''
    case 'checkboxes':
      return Array.isArray(raw) ? raw.map(String) : []
    case 'map':
      return formatMap(raw)
    case 'number':
      return raw === undefined || raw === null || raw === '' ? String(field.default ?? '') : String(raw)
    default:
      return raw === undefined || raw === null ? String(field.default ?? '') : String(raw)
  }
}

export function draftFromSettings(settings: SettingsMap, fields: FieldDef[]): Draft {
  const draft: Draft = {}
  for (const field of fields) draft[field.key] = toDraftValue(field, readSetting(settings, field.key))
  return draft
}

// --------------------------------------------------------------------------- validate

const PATH_TEMPLATE_PLACEHOLDERS = ['base_model', 'author', 'first_tag', 'model_name', 'version_name']
const FILENAME_TEMPLATE_PLACEHOLDERS = [...PATH_TEMPLATE_PLACEHOLDERS, 'hash_short', 'original_name']

function invalidPlaceholder(template: string, allowed: string[]): string | null {
  for (const match of template.matchAll(/\{([^}]*)\}/g)) if (!allowed.includes(match[1])) return `{${match[1]}}`
  return null
}

export function validatePathTemplate(value: string): ValidationError | null {
  const template = value.trim()
  if (!template) return null
  if (/[<>:"|?*\\]/.test(template)) return { key: 'set.err.templateChars' }
  if (template.includes('//') || template.startsWith('/') || template.endsWith('/')) return { key: 'set.err.templateSlashes' }
  const bad = invalidPlaceholder(template, PATH_TEMPLATE_PLACEHOLDERS)
  return bad ? { key: 'set.err.placeholder', params: { placeholder: bad } } : null
}

export function validateFilenameTemplate(value: string): ValidationError | null {
  const template = value.trim()
  if (!template) return null
  if (/[/\\<>:"|?*]/.test(template)) return { key: 'set.err.filenameChars' }
  const bad = invalidPlaceholder(template, FILENAME_TEMPLATE_PLACEHOLDERS)
  return bad ? { key: 'set.err.placeholder', params: { placeholder: bad } } : null
}

export function validateNumber(field: FieldDef, value: string): ValidationError | null {
  const text = String(value ?? '').trim()
  const pattern = field.integer ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/
  const range = { min: field.min ?? '-', max: field.max ?? '-' }
  if (!pattern.test(text)) return { key: field.integer ? 'set.err.integer' : 'set.err.number', params: range }
  const number = Number(text)
  if ((field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) {
    return { key: 'set.err.range', params: range }
  }
  if (field.step && field.min !== undefined) {
    const steps = (number - field.min) / field.step
    if (Math.abs(steps - Math.round(steps)) > 1e-9) return { key: 'set.err.step', params: { step: field.step } }
  }
  return null
}

export function validateField(field: FieldDef, draft: Draft): ValidationError | null {
  if (field.visibleWhen && !field.visibleWhen(draft)) return null
  const value = draft[field.key]
  if (field.type === 'number') {
    const error = validateNumber(field, String(value))
    if (error) return error
  }
  if (field.type === 'pathTemplate') {
    const error = validatePathTemplate(String(value))
    if (error) return error
  }
  if (field.type === 'filenameTemplate') {
    const error = validateFilenameTemplate(String(value))
    if (error) return error
  }
  if (field.type === 'secret') {
    const secret = value as SecretDraft
    if (secret.mode === 'set' && !secret.value.trim()) return { key: 'set.err.secretEmpty' }
  }
  return field.validate ? field.validate(value, draft) : null
}

export function validateDraft(fields: FieldDef[], draft: Draft): Record<string, ValidationError> {
  const errors: Record<string, ValidationError> = {}
  for (const field of fields) {
    const error = validateField(field, draft)
    if (error) errors[field.key] = error
  }
  return errors
}

// --------------------------------------------------------------------------- save

/** The value the backend should store for a draft value (undefined = secret left alone). */
export function toSaveValue(field: FieldDef, value: DraftValue): unknown {
  switch (field.type) {
    case 'toggle':
      return !!value
    case 'number': {
      const number = Number(String(value).trim())
      return field.integer ? Math.trunc(number) : number
    }
    case 'list':
      return splitList(String(value))
    case 'checkboxes':
      return [...(value as string[])]
    case 'map':
      return parseMap(String(value))
    case 'secret': {
      const secret = value as SecretDraft
      if (secret.mode === 'set') return secret.value.trim()
      if (secret.mode === 'clear') return field.deleteMarker ? DELETE_MARKER : ''
      return undefined
    }
    default:
      return String(value ?? '').trim()
  }
}

/** Comparable form of the stored value (so "2" vs 2 or [] vs missing do not count as changes). */
function normalisedCurrent(field: FieldDef, raw: unknown): unknown {
  return toSaveValue(field, toDraftValue(field, raw))
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Only the changed keys. Dotted fields are merged into a copy of the whole
 * object setting (keys the form does not show are kept). Hidden fields
 * (visibleWhen false) are still compared, so a hidden edit is not lost.
 */
export function buildPatch(settings: SettingsMap, draft: Draft, fields: FieldDef[]): SettingsMap {
  const patch: SettingsMap = {}
  const objects: Record<string, Record<string, unknown>> = {}
  for (const field of fields) {
    const value = draft[field.key]
    if (value === undefined) continue
    const next = toSaveValue(field, value)
    if (next === undefined) continue
    const [top, sub] = splitKey(field.key)
    if (sub === null) {
      if (field.type === 'secret' || !same(normalisedCurrent(field, settings[top]), next)) patch[top] = next
      continue
    }
    const current = asRecord(settings[top])
    if (same(normalisedCurrent(field, current[sub]), next)) continue
    objects[top] ??= { ...current }
    objects[top][sub] = next
  }
  return orderPatch({ ...patch, ...objects })
}

/** Validated keys first (see the module comment); the rest keeps its order. */
export function orderPatch(patch: SettingsMap): SettingsMap {
  const ordered: SettingsMap = {}
  for (const key of VALIDATED_FIRST) if (key in patch) ordered[key] = patch[key]
  for (const [key, value] of Object.entries(patch)) if (!(key in ordered)) ordered[key] = value
  return ordered
}

export function isDirty(settings: SettingsMap, draft: Draft, fields: FieldDef[]): boolean {
  return Object.keys(buildPatch(settings, draft, fields)).length > 0
}

/** The changed fields (for the "N unsaved changes" counter and the per-field dot). */
export function changedFields(settings: SettingsMap, draft: Draft, fields: FieldDef[]): string[] {
  return fields.filter((field) => Object.keys(buildPatch(settings, draft, [field])).length > 0).map((field) => field.key)
}

/** Side effects of a patch the user must acknowledge before saving. */
export function patchEffects(changed: string[], fields: FieldDef[]): FieldDef[] {
  const set = new Set(changed)
  return fields.filter((field) => set.has(field.key) && (field.confirm || field.effect === 'restart' || field.effect === 'moves-files' || field.effect === 'relocates-settings'))
}

/** For any display/diagnostic use: secrets replaced by a mask. Never log a raw patch. */
export function redactPatch(patch: SettingsMap): SettingsMap {
  const redacted: SettingsMap = { ...patch }
  for (const key of SECRET_KEYS) if (key in redacted && redacted[key] !== DELETE_MARKER) redacted[key] = redacted[key] ? '••••••' : ''
  return redacted
}

export function resetToDefault(field: FieldDef): DraftValue {
  return toDraftValue(field, field.default)
}

/** Field visible for the current draft. */
export function isVisible(field: FieldDef, draft: Draft): boolean {
  return !field.visibleWhen || field.visibleWhen(draft)
}

/** Simple search over label text (the classic modal has a search box too). */
export function matchesQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || text.toLowerCase().includes(needle)
}
