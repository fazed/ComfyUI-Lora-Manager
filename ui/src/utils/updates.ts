/**
 * Pure helpers of the Updates page: filter tiers, the candidate a row shows,
 * reason and gate labels, "checked N days ago", the queue destination derived
 * from the current file, and the per-row queue state. No I/O; the page and
 * composables/useUpdates.ts do the requests.
 */

import type {
  DestinationParams,
  ModelPrefix,
  QueueItem,
  UpdateCandidate,
  UpdateFileInfo,
  UpdateGroup,
  UpdateHiddenReason,
  UpdateLocalCard,
  UpdatesOverview,
} from '@/api/types'
import { LIBRARIES } from '@/config/libraries'
import { formatBytes, toDate } from './format'
import { t, type MessageKey } from '@/i18n'

/**
 * Segmented filter of the page. Likely and Possible are disjoint; All shows
 * every line; Ignored lists the ignored models and versions (restore view).
 */
export type UpdatesFilter = 'likely' | 'possible' | 'all' | 'ignored'
export const UPDATES_FILTERS: UpdatesFilter[] = ['likely', 'possible', 'all', 'ignored']

/** Model types with update tracking, in tab order. */
export const UPDATE_PREFIXES: ModelPrefix[] = (Object.keys(LIBRARIES) as ModelPrefix[]).filter(
  (prefix) => LIBRARIES[prefix].supportsUpdates,
)

export function isUpdatePrefix(value: unknown): value is ModelPrefix {
  return typeof value === 'string' && (UPDATE_PREFIXES as string[]).includes(value)
}

/** "LoRAs 3, Checkpoints 1": the likely counts per type, only types with updates. */
export function likelySplitText(byPrefix: Readonly<Partial<Record<ModelPrefix, number>>>): string {
  return UPDATE_PREFIXES.filter((prefix) => (byPrefix[prefix] ?? 0) > 0)
    .map((prefix) => t('topbar.updatesSplitItem', { type: t(LIBRARIES[prefix].title), count: byPrefix[prefix]! }))
    .join(', ')
}

/** "3 likely updates" (title / screen-reader text of a type button). */
export function typeLikelyText(count: number): string {
  return t('updates.typeLikely', { count, updates: count === 1 ? t('updates.update') : t('updates.updatesWord') })
}

export function isVisible(candidate: UpdateCandidate): boolean {
  return candidate.hiddenBecause.length === 0
}

/** Lines shown under a filter (the backend already sorts them: likely, possible, hidden). */
export function groupsForFilter(groups: UpdateGroup[], filter: UpdatesFilter): UpdateGroup[] {
  if (filter === 'all') return groups
  if (filter === 'ignored') return groups.filter((group) => group.isIgnored || group.candidates.some((c) => c.isIgnored))
  return groups.filter((group) => group.tier === filter)
}

export function filterCounts(overview: UpdatesOverview | null): Record<UpdatesFilter, number> {
  if (!overview) return { likely: 0, possible: 0, all: 0, ignored: 0 }
  return {
    likely: overview.totals.likely,
    possible: overview.totals.possible,
    all: overview.groups.length,
    ignored: ignoredEntries(overview.groups).length,
  }
}

// --- ignore / restore ---------------------------------------------------------

/** An ignore (or restore) of a whole model (`versionId` null) or of one version. */
export interface IgnoreChange {
  modelId: number
  versionId: number | null
  ignore: boolean
}

/** One row of the Ignored view: a whole model, or one version of a model that is not ignored itself. */
export type IgnoredEntry =
  | { kind: 'model'; key: string; group: UpdateGroup }
  | { kind: 'version'; key: string; group: UpdateGroup; candidate: UpdateCandidate }

/**
 * The ignored models (once per model, even with several base lines) and the
 * ignored versions of models that are not ignored as a whole. Only versions
 * the overview lists as candidates appear: an ignored version older than
 * yours is not an update anyway.
 */
export function ignoredEntries(groups: UpdateGroup[]): IgnoredEntry[] {
  const entries: IgnoredEntry[] = []
  const models = new Set<number>()
  const versions = new Set<number>()
  for (const group of groups) {
    if (group.isIgnored) {
      if (!models.has(group.modelId)) entries.push({ kind: 'model', key: `m:${group.modelId}`, group })
      models.add(group.modelId)
      continue
    }
    for (const candidate of group.candidates) {
      if (!candidate.isIgnored || versions.has(candidate.versionId)) continue
      versions.add(candidate.versionId)
      entries.push({ kind: 'version', key: `v:${group.modelId}:${candidate.versionId}`, group, candidate })
    }
  }
  return entries
}

function tierOf(candidates: UpdateCandidate[]): UpdateGroup['tier'] {
  const visible = candidates.filter(isVisible)
  if (visible.some((c) => c.confidence === 'likely')) return 'likely'
  if (visible.some((c) => c.confidence === 'possible')) return 'possible'
  return 'hidden'
}

function withIgnored(candidate: UpdateCandidate, ignored: boolean): UpdateCandidate {
  const others = candidate.hiddenBecause.filter((code) => code !== 'ignored')
  return { ...candidate, isIgnored: ignored, hiddenBecause: ignored ? ['ignored', ...others] : others }
}

/**
 * The overview as it will look once the pending ignore / restore changes are
 * stored (optimistic view): candidates and lines get the `ignored` gate, tiers
 * and totals are recomputed. The page re-reads the overview afterwards, which
 * replaces this approximation (a restored model does not know which of its
 * versions were also ignored one by one; they show as restored until then).
 */
export function applyIgnoreChanges(overview: UpdatesOverview | null, changes: readonly IgnoreChange[]): UpdatesOverview | null {
  if (!overview || !changes.length) return overview
  const modelChange = new Map<number, boolean>()
  const versionChange = new Map<string, boolean>()
  for (const change of changes) {
    if (change.versionId === null) modelChange.set(change.modelId, change.ignore)
    else versionChange.set(`${change.modelId}:${change.versionId}`, change.ignore)
  }
  const groups = overview.groups.map((group) => {
    const modelIgnored = modelChange.get(group.modelId)
    const touched = modelIgnored !== undefined || group.candidates.some((c) => versionChange.has(`${group.modelId}:${c.versionId}`))
    if (!touched) return group
    const isIgnored = modelIgnored ?? group.isIgnored
    const candidates = group.candidates.map((candidate) => {
      const own = versionChange.get(`${group.modelId}:${candidate.versionId}`)
      // Without a version change, a model-level restore clears the flag it set.
      const versionIgnored = own ?? (group.isIgnored ? false : candidate.isIgnored)
      return withIgnored(candidate, isIgnored || versionIgnored)
    })
    return { ...group, isIgnored, candidates, tier: tierOf(candidates) }
  })
  const totals = { ...overview.totals, likely: 0, possible: 0, hidden: 0 }
  for (const group of groups) totals[group.tier] += 1
  return { ...overview, groups, totals }
}

// --- drawer Versions tab ---------------------------------------------------------

const CONFIDENCE_RANK: Record<UpdateCandidate['confidence'], number> = { likely: 0, possible: 1, variant: 2 }

/**
 * Classification of a model's remote versions from the overview: versionId ->
 * confidence (the best one when a version appears in several lines). Versions
 * that are not newer candidates (yours, older ones) are absent.
 */
export function versionClassification(overview: UpdatesOverview | null, modelId: number | null | undefined): Map<number, UpdateCandidate['confidence']> {
  const map = new Map<number, UpdateCandidate['confidence']>()
  if (!overview || !modelId) return map
  for (const group of overview.groups) {
    if (group.modelId !== modelId) continue
    for (const candidate of group.candidates) {
      const known = map.get(candidate.versionId)
      if (!known || CONFIDENCE_RANK[candidate.confidence] < CONFIDENCE_RANK[known]) map.set(candidate.versionId, candidate.confidence)
    }
  }
  return map
}

// --- changelog and file format -------------------------------------------------

/** "SafeTensor · fp16" for the primary file (empty when unknown). */
export function formatLabel(candidate: Pick<UpdateCandidate, 'fileFormat' | 'precision'>): string {
  return [candidate.fileFormat, candidate.precision].filter((part): part is string => !!part).join(' · ')
}

/** "GGUF · fp8 · pruned" for one file entry of the files list. */
export function fileLabel(file: UpdateFileInfo): string {
  return [file.format, file.precision, file.size].filter((part): part is string => !!part).join(' · ')
}

/** The candidate a row offers under the filter (null when the line has none there). */
export function primaryCandidate(group: UpdateGroup, filter: UpdatesFilter): UpdateCandidate | null {
  if (filter === 'all') {
    return (
      group.candidates.find((c) => isVisible(c) && c.confidence === 'likely') ??
      group.candidates.find((c) => isVisible(c) && c.confidence === 'possible') ??
      group.candidates[0] ??
      null
    )
  }
  return group.candidates.find((c) => isVisible(c) && c.confidence === filter) ?? null
}

/** The local file a row updates: the one holding the newest owned version. */
export function currentCard(group: UpdateGroup): UpdateLocalCard | null {
  return (
    group.localCards.find((card) => card.versionId === group.newestOwned.versionId) ?? group.localCards[0] ?? null
  )
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days from `from` to `to` (negative when `to` is earlier); null without both dates. */
export function daysBetween(from: string | number | null | undefined, to: string | number | null | undefined): number | null {
  const a = toDate(from ?? null)
  const b = toDate(to ?? null)
  if (!a || !b) return null
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS)
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/** "released 3 days after yours" / "released the same day as yours". */
function afterYours(days: number | null): string {
  if (days === null) return ''
  if (days <= 0) return t('updates.after.sameDay')
  return t('updates.after.days', { count: days, days: plural(days, t('updates.day'), t('updates.days')) })
}

/** One sentence that explains why the candidate is (or is not) offered. */
export function reasonText(group: UpdateGroup, candidate: UpdateCandidate): string {
  const key = `updates.reason.${candidate.reason}` as MessageKey
  const base = candidate.baseModel || group.baseModel || t('updates.unknownBase')
  const main = t(key, { base })
  const after = afterYours(daysBetween(group.newestOwned.releasedAt, candidate.releasedAt))
  return `${main === key ? candidate.reason : main}${after ? `, ${after}` : ''}.`
}

export function hiddenLabel(code: UpdateHiddenReason): string {
  const key = `updates.hidden.${code}` as MessageKey
  const text = t(key)
  return text === key ? code : text
}

/** "Hidden: early access, downloaded before" (empty when visible). */
export function hiddenText(candidate: UpdateCandidate): string {
  if (isVisible(candidate)) return ''
  return t('updates.hiddenBecause', { reasons: candidate.hiddenBecause.map(hiddenLabel).join(', ') })
}

/** Age in whole days of an ISO time (0 = today); null when unknown. */
export function ageInDays(iso: string | null | undefined, now: Date = new Date()): number | null {
  const date = toDate(iso ?? null)
  if (!date) return null
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS))
}

/** "Checked today", "Checked 1 day ago", "Checked 12 days ago", "Never checked". */
export function checkedAgoText(iso: string | null | undefined, now: Date = new Date()): string {
  const days = ageInDays(iso, now)
  if (days === null) return t('updates.neverChecked')
  if (days === 0) return t('updates.checkedToday')
  return t('updates.checkedAgo', { count: days, days: plural(days, t('updates.day'), t('updates.days')) })
}

// --- destination ------------------------------------------------------------

export interface DerivedDestination {
  /** queue/add params; `{}` = backend default root + path template. */
  params: DestinationParams
  /** Whether the current file's root was found among the type's roots. */
  known: boolean
  /** Shown under the row: `<root>/<folder>` (empty when not known). */
  display: string
}

const slashes = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
const isWindowsPath = (value: string) => /^[a-z]:\//i.test(value) || value.startsWith('//')
const key = (value: string) => (isWindowsPath(value) ? value.toLowerCase() : value)

/**
 * Queue destination for an update: the same root and folder as the current
 * file. The root is the longest configured root that contains the file
 * (`GET /{prefix}/roots`); the folder is the file's directory below it. When no
 * root matches (moved roots, a symlinked path, roots not loaded) the update
 * falls back to the default root and path template and says so.
 */
export function deriveDestination(card: UpdateLocalCard | null, roots: string[]): DerivedDestination {
  return destinationForFile(card?.filePath ?? null, roots)
}

/**
 * Queue destination next to a local file (the drawer's Versions tab and the
 * Updates page share it): the longest root containing the file and the file's
 * folder below it; no destination (default root + path template) otherwise.
 */
export function destinationForFile(filePath: string | null | undefined, roots: string[]): DerivedDestination {
  const fallback: DerivedDestination = { params: {}, known: false, display: '' }
  if (!filePath) return fallback
  const path = slashes(filePath)
  const cut = path.lastIndexOf('/')
  if (cut <= 0) return fallback
  const dir = path.slice(0, cut)
  let best: { raw: string; clean: string } | null = null
  for (const raw of roots) {
    if (!raw) continue
    const clean = slashes(raw)
    if (!clean) continue
    const inside = key(dir) === key(clean) || key(dir).startsWith(`${key(clean)}/`)
    if (inside && (!best || clean.length > best.clean.length)) best = { raw, clean }
  }
  if (!best) return fallback
  const folder = dir.length > best.clean.length ? dir.slice(best.clean.length + 1) : ''
  return {
    params: { model_root: best.raw, relative_path: folder, use_default_paths: 'false' },
    known: true,
    display: folder ? `${best.clean}/${folder}` : best.clean,
  }
}

/** Library route that opens the current file's drawer. */
export function libraryLink(prefix: ModelPrefix, filePath: string): { path: string; query: { open: string } } {
  return { path: `/${prefix}`, query: { open: filePath.replace(/\\/g, '/') } }
}

// --- queue state ------------------------------------------------------------

export type RowQueueState =
  | { kind: 'queued' }
  | { kind: 'paused' }
  | { kind: 'downloading'; progress: number }
  | { kind: 'done' }
  | { kind: 'failed'; error: string }
  | null

/** State of a version in the download queue (active rows first). */
export function queueStateFor(versionId: number, queue: QueueItem[]): RowQueueState {
  const rows = queue.filter((item) => Number(item.model_version_id) === versionId)
  if (!rows.length) return null
  const pick = (status: string) => rows.find((item) => item.status === status)
  const downloading = pick('downloading')
  if (downloading) {
    const progress = typeof downloading.progress === 'number' ? Math.round(downloading.progress) : 0
    return { kind: 'downloading', progress: Math.max(0, Math.min(100, progress)) }
  }
  if (pick('queued') || pick('waiting')) return { kind: 'queued' }
  if (pick('paused')) return { kind: 'paused' }
  if (pick('completed')) return { kind: 'done' }
  const failed = pick('failed') ?? pick('canceled')
  if (failed) return { kind: 'failed', error: failed.error || '' }
  return null
}

/** The row can queue its candidate (not while it is already queued, downloading or done). */
export function canQueue(state: RowQueueState): boolean {
  return state === null || state.kind === 'failed'
}

// --- bulk update ----------------------------------------------------------------

/** One row as the page shows it (the candidate the current filter offers). */
export interface UpdateRowModel {
  group: UpdateGroup
  candidate: UpdateCandidate
  more: number
}

/** One queued item of a bulk update, with its destination. */
export interface BulkItem {
  key: string
  group: UpdateGroup
  candidate: UpdateCandidate
  destination: DerivedDestination
}

/**
 * Rows "Select all visible" picks: an enabled Update action (not queued,
 * downloading or in the library) and a candidate that is not hidden, so All
 * never mass-selects variants, ignored or other-base versions (they can still
 * be ticked one by one).
 */
export function autoSelectable(row: UpdateRowModel, state: RowQueueState): boolean {
  return canQueue(state) && isVisible(row.candidate)
}

export interface BulkPlanSummary {
  count: number
  /** Sum of the known sizes. */
  totalBytes: number
  /** Items without a size (the total is then "at least"). */
  unknownSizes: number
  /** Distinct folders, in order of first use. */
  folders: string[]
  /** Items saved to the default root + path template (no root matched). */
  defaultCount: number
}

export function summarizeBulk(items: BulkItem[]): BulkPlanSummary {
  const folders: string[] = []
  let totalBytes = 0
  let unknownSizes = 0
  let defaultCount = 0
  for (const item of items) {
    const size = item.candidate.sizeBytes
    if (typeof size === 'number' && size > 0) totalBytes += size
    else unknownSizes += 1
    if (!item.destination.known) defaultCount += 1
    else if (!folders.includes(item.destination.display)) folders.push(item.destination.display)
  }
  return { count: items.length, totalBytes, unknownSizes, folders, defaultCount }
}

/** "1.2 GB in total" / "at least 800 MB (2 without a size)" / "size unknown". */
export function bulkSizeText(summary: Pick<BulkPlanSummary, 'totalBytes' | 'unknownSizes' | 'count'>): string {
  if (!summary.count) return ''
  if (summary.totalBytes <= 0) return t('updates.bulk.sizeUnknown')
  const size = formatBytes(summary.totalBytes)
  return summary.unknownSizes
    ? t('updates.bulk.sizeAtLeast', { size, count: summary.unknownSizes })
    : t('updates.bulk.size', { size })
}

/** Body of the bulk-update confirm: count and size, the distinct folders, the default-path fallback. */
export function bulkConfirmMessage(summary: BulkPlanSummary): string {
  const lines = [
    t('updates.bulk.confirmCount', {
      count: summary.count,
      updates: summary.count === 1 ? t('updates.update') : t('updates.updatesWord'),
      size: bulkSizeText(summary),
    }),
  ]
  if (summary.folders.length) {
    lines.push('', t('updates.bulk.confirmFolders'), ...summary.folders.map((folder) => `- ${folder}`))
  }
  if (summary.defaultCount) lines.push('', t('updates.bulk.confirmDefault', { count: summary.defaultCount }))
  lines.push('', t('updates.bulk.confirmNote'))
  return lines.join('\n')
}

/** Why a bulk update stopped early: errors that would hit every following item too. */
export type BulkStopReason = 'forbidden' | 'offline' | 'rate_limited'

/** HTTP status -> stop reason (403 guard / permission, 0 / 503 offline, 429 rate limit); null = per-item error. */
export function hardErrorOf(status: number | null | undefined): BulkStopReason | null {
  if (status === 403) return 'forbidden'
  if (status === 0 || status === 503) return 'offline'
  if (status === 429) return 'rate_limited'
  return null
}

export interface BulkResult {
  added: BulkItem[]
  duplicates: BulkItem[]
  failed: Array<{ item: BulkItem; message: string }>
  /** Items not sent because the run stopped. */
  notSent: BulkItem[]
  stopped: BulkStopReason | null
}
