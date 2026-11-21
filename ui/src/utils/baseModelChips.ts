/**
 * Base-model quick filter: turns the `/base-models` counts into the chip row
 * shown under the library toolbar (top N by count, the rest in "More").
 */

import type { CountEntry } from '@/api/types'

export interface BaseModelChip {
  name: string
  /** Undefined for a selected base model the counts list does not know (yet). */
  count?: number
  selected: boolean
}

export interface BaseModelChipRow {
  visible: BaseModelChip[]
  overflow: BaseModelChip[]
}

export const QUICK_FILTER_LIMIT = 8

/** Count desc, then name asc; blank names dropped, duplicate names merged. */
export function sortBaseModels(entries: readonly CountEntry[]): CountEntry[] {
  const merged = new Map<string, number>()
  for (const entry of entries) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    if (!name) continue
    const count = Number.isFinite(entry.count) ? entry.count : 0
    merged.set(name, (merged.get(name) ?? 0) + count)
  }
  return [...merged.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * Split the base models into the visible chips and the "More" overflow.
 * Selected base models are always visible: a selection made from the overflow
 * (or from the filter panel) moves into the row so it can be seen and undone.
 */
export function buildBaseModelChips(
  entries: readonly CountEntry[],
  selected: readonly string[],
  limit = QUICK_FILTER_LIMIT,
): BaseModelChipRow {
  const sorted = sortBaseModels(entries)
  const chosen = new Set(selected)
  const top = sorted.slice(0, Math.max(0, limit))
  const rest = sorted.slice(top.length)

  const visible: BaseModelChip[] = top.map((entry) => ({ ...entry, selected: chosen.has(entry.name) }))
  const overflow: BaseModelChip[] = []
  for (const entry of rest) {
    if (chosen.has(entry.name)) visible.push({ ...entry, selected: true })
    else overflow.push({ ...entry, selected: false })
  }
  const known = new Set(sorted.map((entry) => entry.name))
  for (const name of selected) {
    if (!known.has(name)) visible.push({ name, selected: true })
  }
  return { visible, overflow }
}
