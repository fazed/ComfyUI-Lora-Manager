/**
 * Pure helpers for the model management actions (delete/undo, rename, move,
 * selection, auto-organize preview). No I/O; see composables/useModelActions.
 */

import type {
  BulkDeleteResponse,
  BulkMoveResponse,
  FolderTree,
  OrganizeProgress,
  OrganizeResponse,
  OrganizeResultEntry,
  UndoHandle,
} from '@/api/types'
import type { MessageKey } from '@/i18n'

/** Characters the backend refuses in a new file name (`rename_model`). */
export const ILLEGAL_NAME_CHARS = /[/\\:*?"<>|]/
export const MAX_FILE_NAME_LENGTH = 200

/**
 * Validates a new file stem for rename. Mirrors the backend's character check
 * and adds two Windows rules the backend does not catch (trailing dot/space,
 * overlong names) so the user gets the message before anything happens.
 */
export function validateFileName(value: string, current: string): MessageKey | null {
  const name = value.trim()
  if (!name) return 'actions.rename.errorEmpty'
  if (ILLEGAL_NAME_CHARS.test(name)) return 'actions.rename.errorChars'
  if (name === current) return 'actions.rename.errorUnchanged'
  if (/[. ]$/.test(name)) return 'actions.rename.errorTrailing'
  if (name.length > MAX_FILE_NAME_LENGTH) return 'actions.rename.errorLength'
  return null
}

/** Batch ids to undo: the merged `batch_id`, or the `batch_ids` fallback array. */
export function undoBatchIds(handle: UndoHandle | null | undefined): string[] {
  if (!handle) return []
  if (handle.batch_id) return [handle.batch_id]
  return Array.isArray(handle.batch_ids) ? handle.batch_ids.filter(Boolean) : []
}

export interface Failure {
  path: string
  message: string
}

export interface MoveSummary {
  moved: { from: string; to: string }[]
  failed: Failure[]
}

export function summarizeBulkMove(response: BulkMoveResponse): MoveSummary {
  const summary: MoveSummary = { moved: [], failed: [] }
  for (const entry of response.results ?? []) {
    if (entry.success && entry.new_file_path) summary.moved.push({ from: entry.original_file_path, to: entry.new_file_path })
    else summary.failed.push({ path: entry.original_file_path, message: entry.message || 'Move failed' })
  }
  return summary
}

export interface DeleteSummary {
  deleted: string[]
  failed: Failure[]
}

export function summarizeBulkDelete(response: BulkDeleteResponse): DeleteSummary {
  const summary: DeleteSummary = { deleted: [], failed: [] }
  for (const entry of response.results ?? []) {
    if (entry.success) summary.deleted.push(entry.file_path)
    else summary.failed.push({ path: entry.file_path, message: entry.error || 'Delete failed' })
  }
  return summary
}

const slashes = (path: string) => path.replace(/\\/g, '/')
const trimSlashes = (path: string) => path.replace(/^\/+|\/+$/g, '')

/** Absolute target directory: root + library-relative folder, forward slashes. */
export function joinTargetPath(root: string, folder: string): string {
  const base = slashes(root).replace(/\/+$/, '')
  const rel = trimSlashes(slashes(folder))
  return rel ? `${base}/${rel}` : base
}

function rootOf(path: string, roots: string[]): string | null {
  const normalized = slashes(path)
  const lower = normalized.toLowerCase()
  let best: string | null = null
  for (const root of roots) {
    const base = slashes(root).replace(/\/+$/, '')
    if (lower.startsWith(base.toLowerCase() + '/') && (!best || base.length > best.length)) best = base
  }
  return best
}

/** Library-relative directory of a model file ('' = directly in a root). */
export function relativeFolder(filePath: string, roots: string[]): string {
  const root = rootOf(filePath, roots)
  if (!root) return ''
  const rest = slashes(filePath).slice(root.length + 1)
  const index = rest.lastIndexOf('/')
  return index === -1 ? '' : rest.slice(0, index)
}

/** A path shown relative to its library root (absolute when outside every root). */
export function displayPath(path: string, roots: string[]): string {
  const root = rootOf(path, roots)
  return root ? slashes(path).slice(root.length + 1) : slashes(path)
}

/**
 * Validates the optional "new folder" typed into the move dialog: a relative
 * path of one or more segments below the chosen folder.
 */
export function validateNewFolder(value: string): MessageKey | null {
  const raw = value.trim()
  if (!raw) return null
  const path = slashes(raw)
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return 'actions.move.errorFolder'
  const segments = path.replace(/\/+$/, '').split('/')
  for (const segment of segments) {
    const name = segment.trim()
    if (!name || name === '.' || name === '..' || ILLEGAL_NAME_CHARS.test(name) || /[. ]$/.test(name)) {
      return 'actions.move.errorFolder'
    }
  }
  return null
}

/** Every folder path of a tree, depth-first in display (natural) order. */
export function flattenFolderTree(tree: FolderTree, parent = ''): string[] {
  const out: string[] = []
  const names = Object.keys(tree).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  for (const name of names) {
    const path = parent ? `${parent}/${name}` : name
    out.push(path, ...flattenFolderTree(tree[name] ?? {}, path))
  }
  return out
}

export function invertSelection(selected: Set<string>, keys: string[]): Set<string> {
  return new Set(keys.filter((key) => !selected.has(key)))
}

export function pruneSelection(selected: Set<string>, removed: string[]): Set<string> {
  const gone = new Set(removed)
  return new Set([...selected].filter((key) => !gone.has(key)))
}

export interface OrganizePlan {
  moves: NonNullable<OrganizeResponse['planned_moves']>
  /** Skipped for a reason worth showing (missing metadata, path too long, ...). */
  skipped: OrganizeResultEntry[]
  /** Would fail (target exists, planned collision, outside roots, ...). */
  issues: OrganizeResultEntry[]
  alreadyOrganized: number
  template: string | null
  flat: boolean
  total: number
}

export function groupOrganizePlan(response: OrganizeResponse): OrganizePlan {
  const results = response.results ?? response.sample_results ?? []
  const already = results.filter((entry) => entry.reason === 'already_organized')
  return {
    moves: response.planned_moves ?? [],
    skipped: results.filter((entry) => entry.status === 'skipped' && entry.reason !== 'already_organized'),
    issues: results.filter((entry) => entry.status !== 'skipped' && !entry.success),
    alreadyOrganized: already.length,
    template: response.summary?.path_template ?? null,
    flat: response.summary?.organization_type === 'flat',
    total: response.summary?.total ?? 0,
  }
}

export function isOrganizeFinished(progress: OrganizeProgress | null | undefined): boolean {
  return !!progress && ['completed', 'error', 'cancelled'].includes(String(progress.status))
}
