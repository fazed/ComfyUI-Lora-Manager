/**
 * Shared download-queue store. Several components (top-bar indicator,
 * Downloads page) subscribe with their preferred interval; one poller runs at
 * the fastest requested cadence and only while the tab is visible.
 */

import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { downloadsApi } from '@/api/endpoints'
import type { QueueItem, QueueStats, QueueWorkerState } from '@/api/types'
import { createPoller } from './usePolling'

const queue = shallowRef<QueueItem[]>([])
const stats = ref<QueueStats>({})
const worker = ref<QueueWorkerState | null>(null)
const queueWorker = ref(false)
const error = ref<string | null>(null)
const loaded = ref(false)

const subscribers = new Map<number, number>()
const interval = ref(5000)
let nextId = 1

async function refresh(): Promise<void> {
  try {
    const response = await downloadsApi.queue()
    queue.value = response.queue ?? []
    stats.value = response.stats ?? {}
    worker.value = response.worker ?? null
    queueWorker.value = !!response.queue_worker
    error.value = null
  } catch (err) {
    error.value = (err as Error)?.message || 'Could not load the download queue'
  } finally {
    loaded.value = true
  }
}

const poller = createPoller(refresh, interval)

function recompute(): void {
  if (subscribers.size === 0) {
    poller.stop()
    return
  }
  interval.value = Math.min(...subscribers.values())
  poller.stop()
  poller.start()
}

const active = computed(() => queue.value.filter((item) => item.status === 'downloading'))
const waiting = computed(() => queue.value.filter((item) => item.status === 'queued' || item.status === 'paused'))
const paused = computed(() => !!worker.value?.paused)

export function useDownloadQueue(intervalMs = 5000) {
  if (getCurrentInstance()) {
    const id = nextId++
    onMounted(() => {
      subscribers.set(id, intervalMs)
      recompute()
    })
    onBeforeUnmount(() => {
      subscribers.delete(id)
      recompute()
    })
  }
  return { queue, stats, worker, queueWorker, error, loaded, active, waiting, paused, refresh }
}
