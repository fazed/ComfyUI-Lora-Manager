/**
 * Updates page state (phase 1): the read-only overview of one model type, the
 * type's library roots (for the queue destination), "Check now" (the only
 * Civitai request, behind a confirm in the page) and queueing an update into
 * the folder of the current file, with the row state taken from the shared
 * download queue.
 *
 * `useUpdatesSummary` is the app-wide count of likely updates per type for the
 * top-bar badge and the page's type buttons, read from the same read-only
 * overview endpoint (GET only, never a scan or a Civitai request).
 * `refreshLikelyCounts` re-reads the types whose count is older than
 * `SUMMARY_STALE_MS`; it runs after the shell mounted, after every overview
 * load of the page (page load, Refresh, Check now, a finished update) and when
 * the tab becomes visible again (at most every `SUMMARY_VISIBLE_THROTTLE_MS`).
 */

import { computed, reactive, readonly, ref, shallowRef, watch, type Ref } from 'vue'
import { useDocumentVisibility, useOnline, useTimeoutFn } from '@vueuse/core'
import { ApiError } from '@/api/http'
import { createModelApi, downloadsApi, undoDelete, updatesApi } from '@/api/endpoints'
import type { ModelPrefix, QueueItem, UpdateCandidate, UpdateGroup, UpdatesOverview } from '@/api/types'
import { useDownloadQueue } from './useDownloadQueue'
import { currentCard, deriveDestination, queueStateFor, UPDATE_PREFIXES, type RowQueueState } from '@/utils/updates'
import { queueErrorText, replaceInfoOf, replaceLines, type ReplaceTarget } from '@/utils/versionManagement'
import { useToasts } from './useFeedback'
import { t } from '@/i18n'

// --- app-wide summary (top-bar badge, type buttons) ----------------------------

/** A type's count younger than this is not re-read (unless forced). */
export const SUMMARY_STALE_MS = 60_000
/** Becoming visible again re-reads the counts at most this often. */
export const SUMMARY_VISIBLE_THROTTLE_MS = 5 * 60_000
/** Delay before the shell asks for the counts (keeps the first paint free). */
export const SUMMARY_MOUNT_DELAY_MS = 1500

const likelyByPrefix = reactive<Partial<Record<ModelPrefix, number>>>({})
/** When each type was last read (or tried), in ms since the epoch. */
const readAt: Partial<Record<ModelPrefix, number>> = {}
let inFlight: Promise<void> | null = null

function isStale(prefix: ModelPrefix, now: number): boolean {
  const at = readAt[prefix]
  return at === undefined || now - at >= SUMMARY_STALE_MS
}

/**
 * Re-read the likely count of every update-tracked type that is stale (all of
 * them with `force`), one GET per type, sequentially. Failures are silent (an
 * older backend without the endpoint shows no badge). A call while another is
 * running returns the running one: never two reads at once.
 */
function refreshLikelyCounts(options: { force?: boolean } = {}): Promise<void> {
  if (inFlight) return inFlight
  const now = Date.now()
  const due = UPDATE_PREFIXES.filter((prefix) => options.force || isStale(prefix, now))
  if (!due.length) return Promise.resolve()
  inFlight = (async () => {
    try {
      for (const prefix of due) {
        try {
          const overview = await updatesApi.overview(prefix)
          likelyByPrefix[prefix] = overview.totals?.likely ?? 0
        } catch {
          // No badge, no toast.
        } finally {
          readAt[prefix] = Date.now()
        }
      }
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/** Likely updates per type and in total (top-bar badge, Updates type buttons). */
export function useUpdatesSummary() {
  return {
    total: computed(() => Object.values(likelyByPrefix).reduce<number>((sum, n) => sum + (n ?? 0), 0)),
    /** Counts per type; a type is missing until its first successful read. */
    byPrefix: readonly(likelyByPrefix),
    refreshLikelyCounts,
    /** The page read this type itself: keep its count and mark it fresh. */
    set(prefix: ModelPrefix, likely: number): void {
      likelyByPrefix[prefix] = likely
      readAt[prefix] = Date.now()
    },
  }
}

/**
 * The shell's triggers: one refresh `delayMs` after mount, and one whenever
 * the tab becomes visible again, at most every `SUMMARY_VISIBLE_THROTTLE_MS`.
 */
export function useLikelyCountsTriggers(delayMs: number = SUMMARY_MOUNT_DELAY_MS): void {
  useTimeoutFn(() => void refreshLikelyCounts(), delayMs)
  const visibility = useDocumentVisibility()
  let lastVisible = Date.now()
  watch(visibility, (state) => {
    if (state !== 'visible') return
    const now = Date.now()
    if (now - lastVisible < SUMMARY_VISIBLE_THROTTLE_MS) return
    lastVisible = now
    void refreshLikelyCounts({ force: true })
  })
}

/** Test hook: forget the summary. */
export function resetUpdatesSummaryForTesting(): void {
  for (const key of Object.keys(likelyByPrefix)) delete likelyByPrefix[key as ModelPrefix]
  for (const key of Object.keys(readAt)) delete readAt[key as ModelPrefix]
  inFlight = null
}

// --- page state ---------------------------------------------------------------

/** How "Check now" ended. */
export type CheckOutcome = 'done' | 'rate_limited' | 'offline' | 'cooldown' | 'error' | 'stopped'

/** How queueing an update ended. */
export type QueueOutcome =
  /** `replaceAttached`: the backend stored the replace request (only set when one was sent). */
  | { kind: 'queued'; replaceAttached?: boolean }
  | { kind: 'duplicate' }
  /** `status`: HTTP status of the failure (0 = network), null when unknown. */
  | { kind: 'error'; message: string; status: number | null }

/** After a 429 the Check now button rests this long. */
export const CHECK_COOLDOWN_MS = 60_000
/** Queue polling cadence while the page is open. */
export const UPDATES_QUEUE_INTERVAL_MS = 2000

export function useUpdates(prefix: Ref<ModelPrefix>) {
  const overview = shallowRef<UpdatesOverview | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** HTTP status of the last load error (404 = backend without the endpoint). */
  const errorStatus = ref<number | null>(null)
  const roots = shallowRef<string[]>([])
  const summary = useUpdatesSummary()
  let controller: AbortController | null = null
  let rootsFor: ModelPrefix | null = null

  /**
   * Light reload: the overview (GET) and, once per type, the roots (GET).
   * No library scan and no Civitai request. Rejects with `throwOnError`.
   */
  async function load(options: { throwOnError?: boolean } = {}): Promise<void> {
    controller?.abort()
    const current = new AbortController()
    controller = current
    const type = prefix.value
    loading.value = true
    error.value = null
    errorStatus.value = null
    try {
      const [data] = await Promise.all([
        updatesApi.overview(type, current.signal),
        rootsFor === type
          ? Promise.resolve()
          : createModelApi(type)
              .roots()
              .then((list) => {
                roots.value = list
                rootsFor = type
              })
              .catch(() => {
                roots.value = []
              }),
      ])
      if (controller !== current) return
      overview.value = data
      summary.set(type, data.totals?.likely ?? 0)
      // The other types may be stale: re-read them (GET only, deduplicated).
      void summary.refreshLikelyCounts()
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || controller !== current) return
      error.value = (err as Error)?.message || 'Error'
      errorStatus.value = err instanceof ApiError ? err.status : null
      if (options.throwOnError) throw err
    } finally {
      if (controller === current) loading.value = false
    }
  }

  // Switching the type drops the old list at once (no stale rows under another type).
  watch(prefix, () => {
    overview.value = null
    rootsFor = null
    void load()
  })

  // --- Check now ---------------------------------------------------------
  const online = useOnline()
  const checking = ref(false)
  /** A stop of the running check was requested. */
  const stopping = ref(false)
  const coolingDown = ref(false)
  const cooldown = useTimeoutFn(() => (coolingDown.value = false), CHECK_COOLDOWN_MS, { immediate: false })
  const canCheck = computed(() => !checking.value && !coolingDown.value && online.value)

  /**
   * `POST updates/refresh {force: false}` for the active type, then a light
   * reload. The caller asks for confirmation first.
   */
  async function checkNow(): Promise<{ outcome: CheckOutcome; message?: string }> {
    if (!online.value) return { outcome: 'offline' }
    if (coolingDown.value) return { outcome: 'cooldown' }
    if (checking.value) return { outcome: 'cooldown' }
    checking.value = true
    stopping.value = false
    try {
      await updatesApi.refresh(prefix.value)
      await load()
      return { outcome: 'done' }
    } catch (err) {
      const status = err instanceof ApiError ? err.status : null
      const payload = err instanceof ApiError ? (err.payload as { status?: string } | null) : null
      if (payload && typeof payload === 'object' && payload.status === 'cancelled') {
        // Stopped by the user: what was checked so far is stored.
        await load()
        return { outcome: 'stopped' }
      }
      if (status === 429) {
        coolingDown.value = true
        cooldown.start()
        return { outcome: 'rate_limited', message: (err as Error).message }
      }
      if (status === 503 || status === 0) return { outcome: 'offline', message: (err as Error).message }
      return { outcome: 'error', message: (err as Error)?.message || 'Error' }
    } finally {
      checking.value = false
      stopping.value = false
    }
  }

  /** Ask the backend to stop the running check (between models). */
  async function stopCheck(): Promise<boolean> {
    if (!checking.value || stopping.value) return false
    stopping.value = true
    try {
      await updatesApi.cancelCheck(prefix.value)
      return true
    } catch {
      stopping.value = false
      return false
    }
  }

  // --- queue -------------------------------------------------------------
  const queue = useDownloadQueue(UPDATES_QUEUE_INTERVAL_MS)
  const toasts = useToasts()
  /** Versions queued from this page that left the queue: final state from the history. */
  const finished = reactive(new Map<number, RowQueueState>())
  /** The history row of a finished version (its replace outcome). */
  const finishedItems = reactive(new Map<number, QueueItem>())
  /** Versions queued from this page (to notice when they leave the queue). */
  const tracked = new Set<number>()
  const queuing = ref<number | null>(null)

  /** The queue row of a version, else its history row once it finished (replace info). */
  function rowItem(versionId: number): QueueItem | null {
    const active = queue.queue.value.find((item) => Number(item.model_version_id) === versionId)
    return active ?? finishedItems.get(versionId) ?? null
  }

  function rowState(versionId: number): RowQueueState {
    return queueStateFor(versionId, queue.queue.value) ?? finished.get(versionId) ?? null
  }

  /**
   * The replace runs right after the download moved to the history: a row
   * that still says pending / running is read again a little later (bounded).
   */
  const REPLACE_SETTLE_RETRIES = 3
  const REPLACE_SETTLE_DELAY_MS = 2000

  function replaceStillRunning(item: QueueItem | undefined): boolean {
    return !!item?.replace_targets && item.status === 'completed' && (item.replace_status === 'pending' || item.replace_status === 'running')
  }

  async function settleFinished(ids: number[], attempt = 0): Promise<void> {
    let items: QueueItem[] = []
    try {
      items = (await downloadsApi.history(50)).items ?? []
    } catch {
      return
    }
    let completed = false
    const again: number[] = []
    for (const id of ids) {
      const state = queueStateFor(id, items)
      const item = items.find((entry) => Number(entry.model_version_id) === id)
      if (item) finishedItems.set(id, item)
      if (replaceStillRunning(item) && attempt < REPLACE_SETTLE_RETRIES) again.push(id)
      else if (item) announceReplace(item)
      if (state) {
        finished.set(id, state)
        if (state.kind === 'done') completed = true
      }
    }
    if (again.length) setTimeout(() => void settleFinished(again, attempt + 1), REPLACE_SETTLE_DELAY_MS)
    // A finished download is in the library now: re-read so the row moves on.
    if (completed) void load()
  }

  /** The row disappears once the update is owned: say what happened to the old file(s) in a toast. */
  const announced = new Set<string>()
  function announceReplace(item: QueueItem): void {
    if (announced.has(item.download_id)) return
    const lines = replaceLines(replaceInfoOf(item), item.status, Date.now() / 1000)
    if (!lines.length) return
    announced.add(item.download_id)
    const warn = lines.some((line) => line.tone === 'warning')
    const restorable = lines.map((line) => line.restore).filter((target): target is ReplaceTarget => !!target)
    toasts.push(
      lines.map((line) => line.text).join('\n'),
      warn ? 'warning' : 'success',
      restorable.length ? 30_000 : 10_000,
      restorable.length
        ? {
            label: t('replace.row.restorable'),
            run: () => void restoreReplaced(restorable),
          }
        : undefined,
    )
  }

  async function restoreReplaced(targets: ReplaceTarget[]): Promise<void> {
    for (const target of targets) {
      try {
        await undoDelete(target.batchId!)
        toasts.success(t('replace.row.restored', { file: target.fileName }))
      } catch (err) {
        toasts.error(t('replace.row.restoreFailed', { file: target.fileName, error: (err as Error)?.message || '' }))
      }
    }
    void load()
  }

  watch(
    () => queue.queue.value,
    (items) => {
      const present = new Set(items.map((item) => Number(item.model_version_id)))
      const left = [...tracked].filter((id) => !present.has(id))
      if (!left.length) return
      for (const id of left) tracked.delete(id)
      void settleFinished(left)
    },
  )

  /**
   * Queue one update into the folder of the current file. A bulk update
   * passes `refreshQueue: false` and refreshes the shared queue once at the end.
   */
  async function queueUpdate(
    group: UpdateGroup,
    candidate: UpdateCandidate,
    options: { refreshQueue?: boolean; replacePaths?: string[] } = {},
  ): Promise<QueueOutcome> {
    const destination = deriveDestination(currentCard(group), roots.value)
    queuing.value = candidate.versionId
    try {
      const result = await downloadsApi.add({
        modelId: group.modelId,
        versionId: candidate.versionId,
        modelName: group.modelName ?? undefined,
        versionName: candidate.name ?? undefined,
        thumbnailUrl: candidate.previewUrl ?? undefined,
        destination: destination.params,
        replaceFilePaths: options.replacePaths?.length ? options.replacePaths : undefined,
      })
      finished.delete(candidate.versionId)
      finishedItems.delete(candidate.versionId)
      tracked.add(candidate.versionId)
      if (options.refreshQueue !== false) await queue.refresh()
      if (result.duplicate) return { kind: 'duplicate' }
      return options.replacePaths?.length ? { kind: 'queued', replaceAttached: result.replace_attached === true } : { kind: 'queued' }
    } catch (err) {
      return { kind: 'error', message: queueErrorText(err), status: err instanceof ApiError ? err.status : null }
    } finally {
      queuing.value = null
    }
  }

  return {
    overview,
    loading,
    error,
    errorStatus,
    roots,
    load,
    online,
    checking,
    coolingDown,
    canCheck,
    checkNow,
    stopping,
    stopCheck,
    queuing,
    rowState,
    rowItem,
    queueUpdate,
    /** Re-read the shared download queue (after a bulk update). */
    refreshQueue: () => queue.refresh(),
  }
}
