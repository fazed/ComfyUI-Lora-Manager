/**
 * Pure helpers of the phase B1 model tools: NSFW levels, folder names, the
 * delete-folder probe, the filename-template plan, duplicate groups and a
 * sequential job runner. No I/O; see composables/useModelTools.
 */

import type { DeleteFolderResponse, DuplicateGroup, OrganizeResponse } from '@/api/types'
import type { MessageKey } from '@/i18n'
import { ILLEGAL_NAME_CHARS } from './modelActions'

/** Classic content-rating levels (py/utils/constants.py NSFW_LEVELS; 32 "Blocked" is never offered). */
export const NSFW_LEVELS = [
  { value: 1, label: 'PG' },
  { value: 2, label: 'PG-13' },
  { value: 4, label: 'R' },
  { value: 8, label: 'X' },
  { value: 16, label: 'XXX' },
] as const

export function nsfwLabel(level: number | null | undefined): string {
  return NSFW_LEVELS.find((entry) => entry.value === level)?.label ?? 'Unrated'
}

/** One folder name (rename/create): no separators, no "."/"..", no illegal characters or trailing dot/space. */
export function validateFolderName(value: string): MessageKey | null {
  const name = value.trim()
  if (!name) return 'folders.errorEmpty'
  if (name === '.' || name === '..' || ILLEGAL_NAME_CHARS.test(name) || /[. ]$/.test(value)) return 'folders.errorName'
  if (name.length > 200) return 'folders.errorName'
  return null
}

export type FolderProbe = 'empty' | 'leftovers' | 'notEmpty' | 'busy' | 'protected' | 'missing' | 'refused'

/** Classifies the delete-folder dry run (or its refusal). */
export function classifyFolderProbe(response: DeleteFolderResponse): FolderProbe {
  if (response.success) return (response.file_count ?? 0) > 0 || response.restorable === false ? 'leftovers' : 'empty'
  switch (response.code) {
    case 'not_empty':
      return 'notEmpty'
    case 'busy':
      return 'busy'
    case 'protected':
      return 'protected'
    case 'missing':
      return 'missing'
    default:
      return 'refused'
  }
}

export interface TemplateRename {
  model: string
  from: string
  to: string
  dir: string
}

export interface TemplatePlan {
  renames: TemplateRename[]
  failures: { model: string; message: string }[]
  skipped: number
  template: string | null
  total: number
}

const split = (path: string) => {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return { dir: index === -1 ? '' : normalized.slice(0, index), name: index === -1 ? normalized : normalized.slice(index + 1) }
}

export function summarizeTemplatePlan(response: OrganizeResponse): TemplatePlan {
  const results = response.results ?? response.sample_results ?? []
  return {
    renames: (response.planned_moves ?? []).map((move) => {
      const from = split(move.from)
      return { model: move.model, from: from.name, to: split(move.to).name, dir: from.dir }
    }),
    failures: results.filter((entry) => !entry.success).map((entry) => ({ model: entry.model, message: entry.message || '' })),
    skipped: response.summary?.skipped ?? 0,
    template: response.summary?.path_template ?? null,
    total: response.summary?.total ?? 0,
  }
}

/**
 * Why the current duplicate selection cannot be deleted: nothing selected, or
 * every copy of a group selected (one copy must always stay).
 */
export function duplicateDeleteError(groups: DuplicateGroup[], selected: Set<string>): 'none' | 'keepOne' | null {
  if (!selected.size) return 'none'
  for (const group of groups) {
    if (group.models.length && group.models.every((model) => selected.has(model.file_path))) return 'keepOne'
  }
  return null
}

/** Removes deleted models; groups with fewer than two models are no longer duplicates. */
export function pruneDuplicateGroups(groups: DuplicateGroup[], deleted: string[]): DuplicateGroup[] {
  const gone = new Set(deleted)
  return groups
    .map((group) => ({ ...group, models: group.models.filter((model) => !gone.has(model.file_path)) }))
    .filter((group) => group.models.length > 1)
}

export interface SequentialResult<T> {
  ok: number
  failed: { item: T; message: string }[]
  cancelled: boolean
}

/** Runs `worker` for each item in order; failures are collected, `isCancelled` stops before the next item. */
export async function runSequential<T>(
  items: T[],
  worker: (item: T) => Promise<unknown>,
  options: { onProgress?: (done: number, total: number) => void; isCancelled?: () => boolean } = {},
): Promise<SequentialResult<T>> {
  const result: SequentialResult<T> = { ok: 0, failed: [], cancelled: false }
  let done = 0
  for (const item of items) {
    if (options.isCancelled?.()) {
      result.cancelled = true
      break
    }
    try {
      await worker(item)
      result.ok += 1
    } catch (error) {
      result.failed.push({ item, message: (error as Error)?.message || 'Failed' })
    }
    done += 1
    options.onProgress?.(done, items.length)
  }
  return result
}
