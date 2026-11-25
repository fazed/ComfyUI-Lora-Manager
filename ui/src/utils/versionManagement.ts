/**
 * Version management helpers (pure): which local files belong to a model
 * line, what the replace prompt preselects, and how a queue / history row's
 * replace request reads (`replace_targets` / `replace_status` from the
 * backend, see py/services/version_replace.py).
 */

import type { ModelUpdateRecord, ModelVersionInfo, QueueItem, UpdateCandidate, UpdateGroup, VersionLocalFile } from '@/api/types'
import { toDate } from './format'
import { t, type MessageKey } from '@/i18n'

/** A local file the user owns that a replace could target. */
export interface OwnedFile {
  filePath: string
  fileName: string
  folder: string
  versionId: number
  versionName: string | null
  releasedAt: string | null
  sizeBytes: number | null
}

/** What the user chose for the old version(s) when updating. */
export type ReplaceDecision = { mode: 'replace'; paths: string[] } | { mode: 'keep' }

/** Backend outcome per old file (`replace_targets[].status`). */
export type ReplaceTargetStatus = 'replaced' | 'kept' | 'already_gone'

export interface ReplaceTarget {
  path: string
  fileName: string
  versionName: string | null
  sizeBytes: number | null
  status: ReplaceTargetStatus | null
  note: string | null
  batchId: string | null
  /** Unix seconds until the staged old file can still be restored. */
  undoUntil: number | null
}

export type ReplacePhase = 'pending' | 'running' | 'done' | 'interrupted'

export interface ReplaceInfo {
  phase: ReplacePhase
  targets: ReplaceTarget[]
}

const baseKey = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

/** Last path component, either separator. */
export function fileNameOf(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path
}

function releaseStamp(file: Pick<OwnedFile, 'releasedAt'>): number {
  return toDate(file.releasedAt)?.getTime() ?? Number.NEGATIVE_INFINITY
}

/** Newest owned version first (release date, then version id), then by path. */
export function sortOwnedNewestFirst(files: OwnedFile[]): OwnedFile[] {
  return [...files].sort(
    (a, b) =>
      releaseStamp(b) - releaseStamp(a) || b.versionId - a.versionId || (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0),
  )
}

/**
 * Files of the line an Updates row stands for that a replace may target:
 * every local card of the line except files of the version being downloaded.
 */
export function ownedFilesForGroup(group: UpdateGroup, candidate: UpdateCandidate): OwnedFile[] {
  return sortOwnedNewestFirst(
    group.localCards
      .filter((card) => card.versionId !== candidate.versionId && !!card.filePath)
      .map((card) => ({
        filePath: card.filePath,
        fileName: fileNameOf(card.filePath),
        folder: card.folder ?? '',
        versionId: card.versionId,
        versionName: card.versionName,
        releasedAt: card.releasedAt,
        sizeBytes: card.sizeBytes,
      })),
  )
}

/** Local files of one version from the versions endpoint (`localFiles`, new backends only). */
export function localFilesOf(version: ModelVersionInfo): VersionLocalFile[] {
  return Array.isArray(version.localFiles) ? version.localFiles : []
}

/**
 * In the library right now: the scanner's `localFiles` when the backend sends
 * them (read-time ownership), else the persisted flag (older backends).
 */
export function isOwnedVersion(version: ModelVersionInfo): boolean {
  return Array.isArray(version.localFiles) ? version.localFiles.length > 0 : !!version.isInLibrary
}

/**
 * Files of the drawer's model that a replace of `target` may delete: other
 * owned versions on the same base model (a different base is another LoRA).
 */
export function ownedFilesForVersion(record: ModelUpdateRecord | null, target: ModelVersionInfo): OwnedFile[] {
  if (!record) return []
  const base = baseKey(target.baseModel)
  const files: OwnedFile[] = []
  for (const version of record.versions) {
    if (version.versionId === target.versionId) continue
    for (const file of localFilesOf(version)) {
      const fileBase = baseKey(file.baseModel ?? version.baseModel)
      if (base && fileBase && fileBase !== base) continue
      files.push({
        filePath: file.filePath,
        fileName: fileNameOf(file.filePath),
        folder: file.folder ?? '',
        versionId: version.versionId,
        versionName: version.name ?? null,
        releasedAt: version.releasedAt ?? null,
        sizeBytes: file.sizeBytes ?? null,
      })
    }
  }
  return sortOwnedNewestFirst(files)
}

/** The prompt preselects only the newest owned file (never more). */
export function defaultReplaceSelection(files: OwnedFile[]): string[] {
  const [newest] = sortOwnedNewestFirst(files)
  return newest ? [newest.filePath] : []
}

/** The file that is being downloaded right now for this version (never offer to delete it). */
export function isVersionDownloading(versionId: number, queue: QueueItem[]): boolean {
  return queue.some(
    (item) => Number(item.model_version_id) === versionId && ['downloading', 'waiting', 'queued', 'paused'].includes(item.status),
  )
}

const toNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const toText = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

/** `replace_targets` / `replace_status` of a queue or history row; null without a replace request. */
export function replaceInfoOf(item: Pick<QueueItem, 'replace_targets' | 'replace_status'> | null | undefined): ReplaceInfo | null {
  if (!item?.replace_targets) return null
  let raw: unknown
  try {
    raw = typeof item.replace_targets === 'string' ? JSON.parse(item.replace_targets) : item.replace_targets
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  const targets: ReplaceTarget[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || typeof (entry as { path?: unknown }).path !== 'string') continue
    const value = entry as Record<string, unknown>
    const status = value.status
    targets.push({
      path: value.path as string,
      fileName: toText(value.file_name) ?? fileNameOf(value.path as string),
      versionName: toText(value.version_name),
      sizeBytes: toNumber(value.size),
      status: status === 'replaced' || status === 'kept' || status === 'already_gone' ? status : null,
      note: toText(value.note),
      batchId: toText(value.batch_id),
      undoUntil: toNumber(value.undo_until),
    })
  }
  if (!targets.length) return null
  const phase = item.replace_status
  return {
    phase: phase === 'running' || phase === 'done' || phase === 'interrupted' ? phase : 'pending',
    targets,
  }
}

/** A replaced target whose staged copy can still be restored at `nowSeconds`. */
export function canRestore(target: ReplaceTarget, nowSeconds: number): boolean {
  return target.status === 'replaced' && !!target.batchId && (target.undoUntil ?? 0) > nowSeconds + 5
}

// --- texts --------------------------------------------------------------------

/** One line under a queue / history row about its replace request. */
export interface ReplaceLine {
  key: string
  text: string
  tone: 'muted' | 'success' | 'warning'
  /** Set when the replaced old file can still be restored (Undo). */
  restore: ReplaceTarget | null
}

function reasonText(note: string | null): string {
  const code = (note ?? '').split(':')[0].trim()
  const key = `replace.reason.${code}` as MessageKey
  return code && t(key) !== key ? t(key) : t('replace.reason.other')
}

/**
 * Lines for a row: "Will replace X when finished" while it waits or runs,
 * the outcome per old file afterwards. `downloadStatus` is the row's own
 * status (history: completed / failed / canceled).
 */
export function replaceLines(info: ReplaceInfo | null, downloadStatus: string | null | undefined, nowSeconds: number): ReplaceLine[] {
  if (!info) return []
  const finishedWithoutReplace = info.phase === 'pending' && (downloadStatus === 'failed' || downloadStatus === 'canceled')
  return info.targets.map((target) => {
    const file = target.fileName
    const key = target.path
    if (finishedWithoutReplace) return { key, text: t('replace.row.notReplaced', { file }), tone: 'warning', restore: null }
    if (target.status === 'replaced') {
      return { key, text: t('replace.row.replaced', { file }), tone: 'success', restore: canRestore(target, nowSeconds) ? target : null }
    }
    if (target.status === 'already_gone') return { key, text: t('replace.row.gone', { file }), tone: 'muted', restore: null }
    if (target.status === 'kept') {
      if (info.phase === 'interrupted') return { key, text: t('replace.row.interrupted', { file }), tone: 'warning', restore: null }
      return { key, text: t('replace.row.kept', { file, reason: reasonText(target.note) }), tone: 'warning', restore: null }
    }
    return { key, text: t('replace.row.willReplace', { file }), tone: 'muted', restore: null }
  })
}

/** Friendly text for a `queue/add` 400 code (falls back to the backend message). */
export function replaceCodeText(code: string | null | undefined, fallback: string): string {
  if (!code) return fallback
  const key = `replace.code.${code}` as MessageKey
  return t(key) === key ? fallback : t(key)
}

/** Error text of a failed `queue/add`: the replace code's message when there is one. */
export function queueErrorText(error: unknown): string {
  const fallback = (error as Error)?.message || t('common.error')
  const payload = (error as { payload?: unknown })?.payload
  const code = payload && typeof payload === 'object' ? (payload as { code?: unknown }).code : null
  return typeof code === 'string' ? replaceCodeText(code, fallback) : fallback
}
