/**
 * Generation data of example images: normalises the free-form Civitai
 * `images[].meta` object (A1111-style keys such as "CFG scale", ComfyUI-style
 * keys such as cfgScale, resources in three different shapes) into a small
 * view model for the lightbox.
 */

import type { MessageKey } from '@/i18n'

export interface GenerationParam {
  key: string
  label: MessageKey
  value: string
}

export interface GenerationResource {
  name: string
  type: string
  weight?: string
}

export interface GenerationView {
  prompt: string
  negativePrompt: string
  params: GenerationParam[]
  resources: GenerationResource[]
}

type Meta = Record<string, unknown>

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function firstText(meta: Meta, keys: readonly string[]): string {
  for (const key of keys) {
    const value = text(meta[key])
    if (value) return value
  }
  return ''
}

/** Rounds noisy floats (0.30000000000000004) without touching integers or seeds. */
function number(value: string): string {
  if (!/^-?\d+\.\d+$/.test(value)) return value
  return String(Number(Number(value).toFixed(4)))
}

const PARAMS: { key: string; label: MessageKey; keys: string[]; numeric?: boolean }[] = [
  { key: 'model', label: 'generation.model', keys: ['Model', 'model', 'baseModel'] },
  { key: 'sampler', label: 'generation.sampler', keys: ['sampler', 'Sampler', 'sampler_name'] },
  { key: 'scheduler', label: 'generation.scheduler', keys: ['scheduler', 'Schedule type', 'Scheduler'] },
  { key: 'steps', label: 'generation.steps', keys: ['steps', 'Steps'], numeric: true },
  { key: 'cfg', label: 'generation.cfg', keys: ['cfgScale', 'CFG scale', 'cfg', 'cfg_scale'], numeric: true },
  { key: 'seed', label: 'generation.seed', keys: ['seed', 'Seed'] },
  { key: 'size', label: 'generation.size', keys: [] },
  { key: 'clipSkip', label: 'generation.clipSkip', keys: ['clipSkip', 'Clip skip', 'clip_skip'], numeric: true },
  { key: 'denoise', label: 'generation.denoise', keys: ['denoise', 'Denoising strength'], numeric: true },
  { key: 'vae', label: 'generation.vae', keys: ['VAE', 'vae'] },
]

function size(meta: Meta): string {
  const explicit = text(meta.Size ?? meta.size)
  if (explicit) return explicit.replace(/\s*[x×]\s*/i, '×')
  const width = text(meta.width)
  const height = text(meta.height)
  return width && height ? `${width}×${height}` : ''
}

function weightText(value: unknown): string | undefined {
  const raw = text(value)
  return raw ? number(raw) : undefined
}

/** `urn:air:sdxl:lora:civitai:282420@317904` -> `civitai 282420@317904`. */
function resourceName(name: string): string {
  const air = name.match(/^urn:air:[^:]+:[^:]+:([^:]+):(.+)$/)
  return air ? `${air[1]} ${air[2]}` : name
}

function resources(meta: Meta): GenerationResource[] {
  const result: GenerationResource[] = []
  const seen = new Set<string>()
  const add = (name: string, type: string, weight?: string) => {
    const key = `${type}|${name}`.toLowerCase()
    if (!name || seen.has(key)) return
    seen.add(key)
    result.push(weight === undefined ? { name, type } : { name, type, weight })
  }
  const list = (value: unknown): Meta[] =>
    Array.isArray(value) ? value.filter((entry): entry is Meta => !!entry && typeof entry === 'object') : []

  for (const entry of list(meta.resources)) {
    add(text(entry.name), text(entry.type) || 'model', weightText(entry.weight ?? entry.strength))
  }
  for (const entry of list(meta.additionalResources)) {
    add(resourceName(text(entry.name)), text(entry.type) || 'model', weightText(entry.strength ?? entry.weight))
  }
  // civitaiResources carry no file name, only the version; use it when nothing better exists.
  if (!result.length) {
    for (const entry of list(meta.civitaiResources)) {
      const version = text(entry.modelVersionName)
      const id = text(entry.modelVersionId)
      const name = version ? `${version}${id ? ` (#${id})` : ''}` : id ? `#${id}` : ''
      add(name, text(entry.type) || 'model', weightText(entry.weight))
    }
  }
  return result
}

/** Normalise one image's `meta`; null when there is nothing worth showing. */
export function toGenerationView(meta: unknown): GenerationView | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const record = meta as Meta
  const params: GenerationParam[] = []
  for (const param of PARAMS) {
    const raw = param.key === 'size' ? size(record) : firstText(record, param.keys)
    if (raw) params.push({ key: param.key, label: param.label, value: param.numeric ? number(raw) : raw })
  }
  const view: GenerationView = {
    prompt: firstText(record, ['prompt', 'Prompt']),
    negativePrompt: firstText(record, ['negativePrompt', 'Negative prompt', 'negative_prompt']),
    params,
    resources: resources(record),
  }
  if (!view.prompt && !view.negativePrompt && !view.params.length && !view.resources.length) return null
  return view
}

/** Short single-line prompt preview for thumbnail tooltips. */
export function promptHint(meta: unknown, max = 160): string {
  const prompt = toGenerationView(meta)?.prompt ?? ''
  const line = prompt.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}
