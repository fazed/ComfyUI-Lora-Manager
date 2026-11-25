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
  UpdateGroup,
  UpdateHiddenReason,
  UpdateLocalCard,
  UpdatesOverview,
} from '@/api/types'
import { LIBRARIES } from '@/config/libraries'
import { toDate } from './format'
import { t, type MessageKey } from '@/i18n'

/** Segmented filter of the page. Likely and Possible are disjoint; All shows every line. */
export type UpdatesFilter = 'likely' | 'possible' | 'all'
export const UPDATES_FILTERS: UpdatesFilter[] = ['likely', 'possible', 'all']

/** Model types with update tracking, in tab order. */
export const UPDATE_PREFIXES: ModelPrefix[] = (Object.keys(LIBRARIES) as ModelPrefix[]).filter(
  (prefix) => LIBRARIES[prefix].supportsUpdates,
)

export function isUpdatePrefix(value: unknown): value is ModelPrefix {
  return typeof value === 'string' && (UPDATE_PREFIXES as string[]).includes(value)
}

export function isVisible(candidate: UpdateCandidate): boolean {
  return candidate.hiddenBecause.length === 0
}

/** Lines shown under a filter (the backend already sorts them: likely, possible, hidden). */
export function groupsForFilter(groups: UpdateGroup[], filter: UpdatesFilter): UpdateGroup[] {
  if (filter === 'all') return groups
  return groups.filter((group) => group.tier === filter)
}

export function filterCounts(overview: UpdatesOverview | null): Record<UpdatesFilter, number> {
  if (!overview) return { likely: 0, possible: 0, all: 0 }
  return {
    likely: overview.totals.likely,
    possible: overview.totals.possible,
    all: overview.groups.length,
  }
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
  const fallback: DerivedDestination = { params: {}, known: false, display: '' }
  if (!card?.filePath) return fallback
  const path = slashes(card.filePath)
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
