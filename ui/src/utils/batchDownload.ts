/**
 * Pure core of the batch download dialog: the multi-entry input parser, the
 * per-row state machine (resolve -> choose -> submit), selection defaults,
 * the submit plan / summary and a small concurrency limiter. No I/O; see
 * composables/useBatchDownload.
 *
 * Row lifecycle:
 *
 *   pending --resolve--> resolving --ok--> ready      (version/file/selection chosen)
 *                                  --fail-> error     (retry -> pending)
 *   ready: submit idle --> submitting --> added | duplicate (locked) | failed (retryable)
 */

import { ApiError } from '@/api/http'
import type { CivitaiVersion, QueueItem } from '@/api/types'
import { t } from '@/i18n'
import { defaultVersionId, parseDownloadTarget, versionStatus, weightFiles, type DownloadTarget, type VersionStatus } from './downloads'

// --- Input parsing -----------------------------------------------------------

export interface BatchEntry {
  /** Identity of the entry (model:version:file); also the row key. */
  key: string
  /** The entry as typed / pasted (first spelling wins on duplicates). */
  raw: string
  target: DownloadTarget
}

export interface ParsedBatch {
  entries: BatchEntry[]
  /** Lines or tokens that are not a Civitai link or id (de-duplicated). */
  invalid: string[]
  /** Identical entries that were dropped. */
  duplicates: number
}

export function targetKey(target: DownloadTarget): string {
  return `${target.modelId ?? ''}:${target.versionId ?? ''}:${target.fileId ?? ''}`
}

// A Civitai host with or without scheme (civitai.com, civitai.red, www.civitai.green, ...), or any http(s) URL.
const URL_PATTERN = /(?:https?:\/\/)?(?:[\w-]+\.)*civitai\.[a-z]{2,}(?:\/[^\s<>"'`()[\]{},;]*)?|https?:\/\/[^\s<>"'`()[\]{},;]+/gi
const SEPARATORS = /[\s,;]+/
const TRAILING_PUNCTUATION = /[.,;:!?*]+$/
const BARE_ID = /^\d{1,12}$/

/**
 * Splits pasted text into Civitai entries. Entries may be separated by new
 * lines (LF / CRLF / CR), spaces, tabs, commas or semicolons. A line that
 * contains links is treated as free text: its links (and bare ids) count, the
 * words around them are ignored. On other lines every token must be a link
 * or id; a line without any usable token is flagged as a whole.
 */
export function parseBatchInput(text: string): ParsedBatch {
  const entries: BatchEntry[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  let duplicates = 0

  const add = (raw: string): boolean => {
    const target = parseDownloadTarget(raw)
    if (!target) return false
    const key = targetKey(target)
    if (seen.has(key)) duplicates += 1
    else {
      seen.add(key)
      entries.push({ key, raw, target })
    }
    return true
  }
  const flag = (value: string) => {
    if (!invalid.includes(value)) invalid.push(value)
  }

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const urls = (line.match(URL_PATTERN) ?? []).map((url) => url.replace(TRAILING_PUNCTUATION, '')).filter(Boolean)
    if (urls.length) {
      for (const url of urls) if (!add(url)) flag(url)
      // Bare ids next to links still count; other words are prose.
      const rest = line.replace(URL_PATTERN, ' ').split(SEPARATORS)
      for (const token of rest) {
        const clean = token.replace(TRAILING_PUNCTUATION, '')
        if (BARE_ID.test(clean)) add(clean)
      }
      continue
    }
    const tokens = line.split(SEPARATORS).filter(Boolean)
    if (!tokens.length) continue
    const bad = tokens.filter((token) => !add(token))
    if (bad.length === tokens.length) flag(line)
    else bad.forEach(flag)
  }
  return { entries, invalid, duplicates }
}

// --- Rows --------------------------------------------------------------------

export type RowPhase = 'pending' | 'resolving' | 'ready' | 'error'
export type SubmitState = 'idle' | 'submitting' | 'added' | 'duplicate' | 'failed'
/** Why a row starts deselected (the user can still select it). */
export type SkipReason = 'inLibrary' | 'queued' | 'duplicate' | null

export interface BatchRow {
  key: string
  raw: string
  target: DownloadTarget
  phase: RowPhase
  /** Lookup error (phase `error`). */
  error: string | null
  modelId: number | null
  modelName: string
  versions: CivitaiVersion[]
  versionId: number | null
  /** Chosen weight file; null = the backend's primary file (versions with one weight file). */
  fileId: number | null
  selected: boolean
  reason: SkipReason
  submit: SubmitState
  submitError: string | null
}

export interface RowStatus extends VersionStatus {
  /** The chosen file of a multi-file version is already in the library. */
  fileInLibrary: boolean
}

export interface SelectionContext {
  queue: QueueItem[]
  /** `rowIdentity` of the rows that already claim a version + file. */
  taken: Set<string>
}

export function createRow(entry: BatchEntry): BatchRow {
  return {
    key: entry.key,
    raw: entry.raw,
    target: entry.target,
    phase: 'pending',
    error: null,
    modelId: entry.target.modelId,
    modelName: '',
    versions: [],
    versionId: null,
    fileId: null,
    selected: false,
    reason: null,
    submit: 'idle',
    submitError: null,
  }
}

export function selectedVersionOf(row: BatchRow): CivitaiVersion | null {
  return row.versions.find((version) => version.id === row.versionId) ?? null
}

/** What would be queued: version + file. */
export function rowIdentity(row: Pick<BatchRow, 'versionId' | 'fileId'>): string {
  return `${row.versionId ?? ''}:${row.fileId ?? ''}`
}

/** Default file: the linked one, else the first missing one of a partial version, else the primary; null with one weight file. */
export function defaultFileId(version: CivitaiVersion, wanted: number | null): number | null {
  const files = weightFiles(version)
  if (files.length <= 1) return null
  if (wanted != null && files.some((file) => file.id === wanted)) return wanted
  const local = new Set((version.downloadedFiles ?? []).map((entry) => String(entry.fileId ?? '')))
  if (version.existsLocally) {
    const missing = files.find((file) => !local.has(String(file.id)))
    if (missing) return missing.id
  }
  return (files.find((file) => file.primary) ?? files[0]).id
}

export function rowStatus(row: BatchRow, queue: QueueItem[]): RowStatus | null {
  const version = selectedVersionOf(row)
  if (!version) return null
  const fileInLibrary =
    row.fileId != null && (version.downloadedFiles ?? []).some((entry) => String(entry.fileId ?? '') === String(row.fileId))
  return { ...versionStatus(version, queue), fileInLibrary }
}

function withDefaultSelection(row: BatchRow, context: SelectionContext): BatchRow {
  const status = rowStatus(row, context.queue)
  let reason: SkipReason = null
  if (!status) return { ...row, selected: false, reason }
  if (status.queued) reason = 'queued'
  else if ((status.inLibrary && !status.partial) || status.fileInLibrary) reason = 'inLibrary'
  else if (context.taken.has(rowIdentity(row))) reason = 'duplicate'
  return { ...row, selected: reason === null, reason }
}

export interface ResolvedModel {
  modelId: number
  modelName: string
  versions: CivitaiVersion[]
}

export function applyResolved(row: BatchRow, resolved: ResolvedModel, context: SelectionContext): BatchRow {
  const versionId = defaultVersionId(resolved.versions, row.target.versionId)
  const version = resolved.versions.find((entry) => entry.id === versionId) ?? null
  const next: BatchRow = {
    ...row,
    phase: 'ready',
    error: null,
    modelId: resolved.modelId,
    modelName: resolved.modelName,
    versions: resolved.versions,
    versionId,
    fileId: version ? defaultFileId(version, row.target.fileId) : null,
  }
  return withDefaultSelection(next, context)
}

export function applyResolveError(row: BatchRow, message: string): BatchRow {
  return { ...row, phase: 'error', error: message, selected: false, reason: null }
}

export function chooseVersion(row: BatchRow, versionId: number, queue: QueueItem[], taken = new Set<string>()): BatchRow {
  const version = row.versions.find((entry) => entry.id === versionId)
  if (!version || !isEditable(row)) return row
  return withDefaultSelection({ ...row, versionId, fileId: defaultFileId(version, null) }, { queue, taken })
}

export function chooseFile(row: BatchRow, fileId: number, queue: QueueItem[] = [], taken = new Set<string>()): BatchRow {
  const version = selectedVersionOf(row)
  if (!version || !isEditable(row) || !weightFiles(version).some((file) => file.id === fileId)) return row
  return withDefaultSelection({ ...row, fileId }, { queue, taken })
}

/** Ready and not queued yet (added / duplicate rows are locked; failed rows stay editable for the retry). */
export function isEditable(row: BatchRow): boolean {
  return row.phase === 'ready' && (row.submit === 'idle' || row.submit === 'failed')
}

export function toggleRow(row: BatchRow, selected = !row.selected): BatchRow {
  return isEditable(row) ? { ...row, selected } : row
}

// --- Submit ------------------------------------------------------------------

export function submittableRows(rows: BatchRow[]): BatchRow[] {
  return rows.filter((row) => isEditable(row) && row.selected && row.versionId != null)
}

export type SubmitOutcome = { queued: boolean; duplicate: boolean } | { error: string }

export function applySubmitOutcome(row: BatchRow, outcome: SubmitOutcome): BatchRow {
  if ('error' in outcome) return { ...row, submit: 'failed', submitError: outcome.error }
  if (outcome.duplicate) return { ...row, submit: 'duplicate', submitError: null }
  if (outcome.queued) return { ...row, submit: 'added', submitError: null }
  return { ...row, submit: 'failed', submitError: t('download.notQueued') }
}

export function rowLabel(row: BatchRow): string {
  const name = row.modelName || (row.modelId != null ? t('download.batch.modelFallback', { id: row.modelId }) : row.raw)
  const version = selectedVersionOf(row)?.name
  return version ? `${name} · ${version}` : name
}

export interface BatchSummary {
  added: number
  duplicates: number
  failed: number
  failures: { key: string; label: string; reason: string }[]
}

export function summarize(rows: BatchRow[]): BatchSummary {
  const summary: BatchSummary = { added: 0, duplicates: 0, failed: 0, failures: [] }
  for (const row of rows) {
    if (row.submit === 'added') summary.added += 1
    else if (row.submit === 'duplicate') summary.duplicates += 1
    else if (row.submit === 'failed') {
      summary.failed += 1
      summary.failures.push({ key: row.key, label: rowLabel(row), reason: row.submitError || t('common.error') })
    }
  }
  return summary
}

// --- Resolve helpers ---------------------------------------------------------

export function isAbort(error: unknown): boolean {
  return (error as Error)?.name === 'AbortError'
}

export function describeResolveError(error: unknown): string {
  if (isAbort(error)) return t('download.batch.err.stopped')
  if (error instanceof ApiError) {
    if (error.status === 404) return t('download.batch.err.notFound')
    if (error.status === 401 || error.status === 403) return t('download.batch.err.private')
    if (error.status === 429) return t('download.batch.err.rateLimited')
  }
  return (error as Error)?.message || t('common.error')
}

/** Runs `worker` over `items` with at most `limit` in flight; stops starting new items once `signal` aborts. */
export async function runLimited<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0
  const lane = async () => {
    while (next < items.length && !signal?.aborted) {
      const item = items[next++]
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane))
}
