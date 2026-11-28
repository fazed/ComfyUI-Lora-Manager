/**
 * "Send to ComfyUI" for LoRAs, mirroring the classic UI
 * (static/js/utils/uiHelpers.js: buildLoraSyntax, sendLoraToWorkflow):
 *
 * 1. GET  /api/lm/get-registry   -> nodes of the open ComfyUI workflow tabs
 * 2. keep enabled LoRA-capable nodes that are not excluded from send targets
 * 3. POST /api/lm/update-lora-code {lora_code, mode, node_ids}; the backend
 *    forwards it to the ComfyUI frontend over the PromptServer websocket
 *    (`lora_code_update`), where the LoRA Manager node appends/replaces it.
 */

import type { ModelItem } from '@/api/types'

export type SendMode = 'append' | 'replace'

export interface UsageStrengths {
  strength: number
  hasStrength: boolean
  clipStrength: number | null
}

function tipNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/** `usage_tips` arrives as a JSON string ("{}") on list items. */
export function parseUsageTips(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function loraStrengths(usageTips: unknown): UsageStrengths {
  const tips = parseUsageTips(usageTips)
  const strength = tipNumber(tips.strength)
  const clip = tipNumber(tips.clip_strength ?? tips.clipStrength)
  return { strength: strength ?? 1, hasStrength: strength !== null, clipStrength: clip }
}

export interface LoraSyntaxOptions {
  /** `lora_syntax_format` setting: "legacy" (default) uses the bare file name. */
  format?: string
  /** Overrides the model strength from the usage tips. */
  strength?: number | null
}

/** A strength as shown and sent: at most three decimals, no trailing zeros. */
export function formatStrength(value: number): string {
  return String(Number(value.toFixed(3)))
}

export function buildLoraSyntax(
  item: Pick<ModelItem, 'file_name' | 'folder' | 'usage_tips'>,
  options: LoraSyntaxOptions = {},
): string {
  const relative = item.folder ? `${item.folder.replace(/[\\/]+$/, '')}/${item.file_name}` : item.file_name
  const name = (options.format ?? 'legacy') === 'legacy' ? relative.split('/').pop() || item.file_name : relative
  const tips = loraStrengths(item.usage_tips)
  const strength =
    typeof options.strength === 'number' && Number.isFinite(options.strength) ? options.strength : tips.strength
  if (tips.clipStrength !== null) return `<lora:${name}:${formatStrength(strength)}:${formatStrength(tips.clipStrength)}>`
  return `<lora:${name}:${formatStrength(strength)}>`
}

/** Syntax plus trigger words, like the classic "copy LoRA syntax" (include_trigger_words). */
export function buildLoraCopyText(syntax: string, trainedWords: readonly string[] | undefined, includeTriggerWords: boolean): string {
  if (!includeTriggerWords || !trainedWords?.length) return syntax
  const groups = trainedWords
    .map((group) =>
      group
        .split(',')
        .map((word) => word.trim())
        .filter(Boolean)
        .join(', '),
    )
    .filter(Boolean)
  if (!groups.length) return syntax
  return [`${syntax}, ${groups[0]}`, ...groups.slice(1)].join(`\n${'-'.repeat(17)}\n`)
}

export interface RegistryNode {
  id: number | string
  graph_id?: string | null
  graph_name?: string | null
  title?: string
  type?: number
  type_name?: string
  comfy_class?: string
  mode?: number
  bgcolor?: string
  exclude_send?: boolean
  marker_role?: string | null
  capabilities?: { supports_lora?: boolean; widget_names?: string[] } | null
}

export interface SendExclusions {
  node_classes?: string[]
  title_patterns?: string[]
}

function isExcluded(node: RegistryNode, exclusions: SendExclusions | null | undefined): boolean {
  if (node.exclude_send === true) return true
  if (node.marker_role) return false
  if (!exclusions || typeof exclusions !== 'object') return false
  const nodeClass = node.comfy_class || node.type_name
  if (nodeClass && Array.isArray(exclusions.node_classes) && exclusions.node_classes.includes(nodeClass)) return true
  const title = typeof node.title === 'string' ? node.title.toLowerCase() : ''
  return (Array.isArray(exclusions.title_patterns) ? exclusions.title_patterns : []).some(
    (pattern) => typeof pattern === 'string' && !!pattern.trim() && title.includes(pattern.trim().toLowerCase()),
  )
}

/** Enabled (mode 0 / unset), LoRA-capable, not excluded. Same rules as the classic UI. */
export function loraTargetNodes(
  nodes: Record<string, RegistryNode> | null | undefined,
  exclusions?: SendExclusions | null,
): Record<string, RegistryNode> {
  if (!nodes || typeof nodes !== 'object') return {}
  return Object.fromEntries(
    Object.entries(nodes).filter(([, node]) => {
      if (!node || isExcluded(node, exclusions)) return false
      if (node.mode !== undefined && node.mode !== 0) return false
      if (node.capabilities?.supports_lora === true) return true
      return typeof node.type === 'number' && node.type > 0
    }),
  )
}

export interface NodeReference {
  node_id: number | string
  graph_id: string | null
}

export function resolveNodeReference(key: string, nodes: Record<string, RegistryNode>): NodeReference {
  const direct = nodes[key]
  if (direct) return { node_id: direct.id, graph_id: direct.graph_id ?? null }
  if (key.includes(':')) {
    const [graphId, ...rest] = key.split(':')
    const part = rest.join(':')
    const numeric = Number(part)
    return { node_id: Number.isNaN(numeric) ? part : numeric, graph_id: graphId || null }
  }
  const numeric = Number(key)
  return { node_id: Number.isNaN(numeric) ? key : numeric, graph_id: null }
}

export interface UpdateLoraCodeBody {
  lora_code: string
  mode: SendMode
  node_ids: NodeReference[]
}

export function buildUpdateLoraCodeBody(
  loraCode: string,
  mode: SendMode,
  nodeKeys: readonly string[],
  nodes: Record<string, RegistryNode>,
): UpdateLoraCodeBody {
  return { lora_code: loraCode, mode, node_ids: nodeKeys.map((key) => resolveNodeReference(key, nodes)) }
}

/** Label for the node picker: `#12 Lora Loader (Subgraph name)`. */
export function nodeLabel(node: RegistryNode): string {
  const graph = node.graph_name ? ` (${node.graph_name})` : ''
  return `#${node.id}${graph} ${node.title || node.comfy_class || node.type_name || ''}`.trim()
}

export interface UsageTipEntry {
  key: string
  /** Displayed text, e.g. "strength 0.8". */
  text: string
  /** The strength a click applies (only for the `strength` tip). */
  strength: number | null
}

const MAX_TIP_LENGTH = 40

/** Read-only usage tips of a model as chips: strength, clip, then other scalar tips. */
export function usageTipEntries(usageTips: unknown): UsageTipEntry[] {
  const tips = parseUsageTips(usageTips)
  const entries: UsageTipEntry[] = []
  const strength = tipNumber(tips.strength)
  if (strength !== null) entries.push({ key: 'strength', text: `strength ${formatStrength(strength)}`, strength })
  const clip = tipNumber(tips.clip_strength ?? tips.clipStrength)
  if (clip !== null) entries.push({ key: 'clip', text: `clip ${formatStrength(clip)}`, strength: null })
  for (const [key, value] of Object.entries(tips)) {
    if (['strength', 'clip_strength', 'clipStrength'].includes(key)) continue
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
    const shown = String(value).trim()
    if (!shown) continue
    const text = `${key} ${shown}`
    entries.push({ key, text: text.length > MAX_TIP_LENGTH ? `${text.slice(0, MAX_TIP_LENGTH - 1)}…` : text, strength: null })
  }
  return entries
}
