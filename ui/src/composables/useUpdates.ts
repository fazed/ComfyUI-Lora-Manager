/**
 * Updates page state (phase 1): the read-only overview of one model type, the
 * type's library roots (for the queue destination), "Check now" (the only
 * Civitai request, behind a confirm in the page) and queueing an update into
 * the folder of the current file, with the row state taken from the shared
 * download queue.
 *
 * `useUpdatesSummary` is the app-wide count of likely updates for the top-bar
 * badge: loaded once, lazily, from the same read-only overview endpoint (no
 * polling, never a Civitai request); the page keeps it in sync.
 */

import { computed, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import { useOnline, useTimeoutFn } from '@vueuse/core'
import { ApiError } from '@/api/http'
import { createModelApi, downloadsApi, updatesApi } from '@/api/endpoints'
import type { ModelPrefix, QueueItem, UpdateCandidate, UpdateGroup, UpdatesOverview } from '@/api/types'
import { useDownloadQueue } from './useDownloadQueue'
import { currentCard, deriveDestination, queueStateFor, UPDATE_PREFIXES, type RowQueueState } from '@/utils/updates'

// --- app-wide summary (top-bar badge) ----------------------------------------

const likelyByPrefix = reactive<Partial<Record<ModelPrefix, number>>>({})
let summaryStarted = false

/** Count of likely updates across the update-tracked types (top-bar badge). */
export function useUpdatesSummary() {
  return {
    total: computed(() => Object.values(likelyByPrefix).reduce<number>((sum, n) => sum + (n ?? 0), 0)),
    /** Load every type's overview once (sequentially, errors ignored). Later calls do nothing. */
    async loadOnce(): Promise<void> {
      if (summaryStarted) return
      summaryStarted = true
      for (const prefix of UPDATE_PREFIXES) {
        if (likelyByPrefix[prefix] !== undefined) continue
        try {
          const overview = await updatesApi.overview(prefix)
          likelyByPrefix[prefix] = overview.totals?.likely ?? 0
        } catch {
          // An older backend without the endpoint, or a hiccup: no badge, no toast.
        }
      }
    },
    set(prefix: ModelPrefix, likely: number): void {
      likelyByPrefix[prefix] = likely
    },
  }
}

/** Test hook: forget the summary. */
export function resetUpdatesSummaryForTesting(): void {
  for (const key of Object.keys(likelyByPrefix)) delete likelyByPrefix[key as ModelPrefix]
  summaryStarted = false
}

// --- page state ---------------------------------------------------------------

/** How "Check now" ended. */
export type CheckOutcome = 'done' | 'rate_limited' | 'offline' | 'cooldown' | 'error'

/** How queueing an update ended. */
export type QueueOutcome = { kind: 'queued' } | { kind: 'duplicate' } | { kind: 'error'; message: string }

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
    try {
      await updatesApi.refresh(prefix.value)
      await load()
      return { outcome: 'done' }
    } catch (err) {
      const status = err instanceof ApiError ? err.status : null
      if (status === 429) {
        coolingDown.value = true
        cooldown.start()
        return { outcome: 'rate_limited', message: (err as Error).message }
      }
      if (status === 503 || status === 0) return { outcome: 'offline', message: (err as Error).message }
      return { outcome: 'error', message: (err as Error)?.message || 'Error' }
    } finally {
      checking.value = false
    }
  }

  // --- queue -------------------------------------------------------------
  const queue = useDownloadQueue(UPDATES_QUEUE_INTERVAL_MS)
  /** Versions queued from this page that left the queue: final state from the history. */
  const finished = reactive(new Map<number, RowQueueState>())
  /** Versions queued from this page (to notice when they leave the queue). */
  const tracked = new Set<number>()
  const queuing = ref<number | null>(null)

  function rowState(versionId: number): RowQueueState {
    return queueStateFor(versionId, queue.queue.value) ?? finished.get(versionId) ?? null
  }

  async function settleFinished(ids: number[]): Promise<void> {
    let items: QueueItem[] = []
    try {
      items = (await downloadsApi.history(50)).items ?? []
    } catch {
      return
    }
    let completed = false
    for (const id of ids) {
      const state = queueStateFor(id, items)
      if (state) {
        finished.set(id, state)
        if (state.kind === 'done') completed = true
      }
    }
    // A finished download is in the library now: re-read so the row moves on.
    if (completed) void load()
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

  async function queueUpdate(group: UpdateGroup, candidate: UpdateCandidate): Promise<QueueOutcome> {
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
      })
      finished.delete(candidate.versionId)
      tracked.add(candidate.versionId)
      await queue.refresh()
      return result.duplicate ? { kind: 'duplicate' } : { kind: 'queued' }
    } catch (err) {
      return { kind: 'error', message: (err as Error)?.message || 'Error' }
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
    queuing,
    rowState,
    queueUpdate,
  }
}
