<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StateBlock from '@/components/StateBlock.vue'
import { downloadsApi } from '@/api/endpoints'
import type { QueueItem } from '@/api/types'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import { useDownloadQueue } from '@/composables/useDownloadQueue'
import { parseCivitaiInput } from '@/utils/civitai'
import { formatBytes, formatDateTime, formatSpeed, progressPercent } from '@/utils/format'
import { t, type MessageKey } from '@/i18n'

const toasts = useToasts()
const { confirm } = useConfirm()
// Fast cadence only while this page is mounted (and the tab visible).
const queue = useDownloadQueue(1500)

const history = ref<QueueItem[]>([])
const historyTotal = ref(0)
const historyLoading = ref(false)
const historyError = ref<string | null>(null)
const busy = ref<string | null>(null)

const addInput = ref('')
const addError = ref('')
const adding = ref(false)

const failedCount = computed(() => history.value.filter((item) => item.status === 'failed').length)

function itemName(item: QueueItem): string {
  const base = item.model_name || t('downloads.unknownModel', { id: item.model_id ?? item.model_version_id ?? '?' })
  return item.version_name ? `${base} - ${item.version_name}` : base
}

function statusLabel(status: string): string {
  const key = `downloads.status.${status}` as MessageKey
  return t(key) === key ? status : t(key)
}

function statusClass(status: string): string {
  if (status === 'completed') return 'lm-badge--success'
  if (status === 'failed') return 'lm-badge--danger'
  if (status === 'paused' || status === 'canceled') return 'lm-badge--warning'
  return 'lm-badge--accent'
}

async function loadHistory(): Promise<void> {
  historyLoading.value = true
  historyError.value = null
  try {
    const response = await downloadsApi.history(100)
    history.value = response.items ?? []
    historyTotal.value = response.total ?? history.value.length
  } catch (error) {
    historyError.value = (error as Error).message
  } finally {
    historyLoading.value = false
  }
}

// Reload history whenever the completed/failed/canceled counters move.
let lastFinished = -1
const finishedCount = computed(() => (queue.stats.value.completed ?? 0) + (queue.stats.value.failed ?? 0) + (queue.stats.value.canceled ?? 0))

async function run(id: string, action: () => Promise<unknown>, success?: string): Promise<void> {
  busy.value = id
  try {
    await action()
    if (success) toasts.success(success)
  } catch (error) {
    toasts.error((error as Error).message)
  } finally {
    busy.value = null
    await queue.refresh()
  }
}

async function removeItem(item: QueueItem): Promise<void> {
  const ok = await confirm({ message: t('downloads.removeConfirm', { name: itemName(item) }), danger: true, confirmLabel: t('downloads.remove') })
  if (ok) await run(item.download_id, () => downloadsApi.remove(item.download_id))
}

async function togglePause(): Promise<void> {
  await run('pause', () => (queue.paused.value ? downloadsApi.resumeAll() : downloadsApi.pauseAll()))
}

async function retry(item: QueueItem): Promise<void> {
  await run(item.download_id, () => downloadsApi.retry(item.download_id))
  await loadHistory()
}

async function retryAll(): Promise<void> {
  await run('retry-all', () => downloadsApi.retryAllFailed())
  await loadHistory()
}

async function deleteEntry(item: QueueItem): Promise<void> {
  await run(item.download_id, () => downloadsApi.deleteHistoryItem(item.download_id))
  await loadHistory()
}

async function clearHistory(): Promise<void> {
  const ok = await confirm({ message: t('downloads.clearHistoryConfirm'), danger: true, confirmLabel: t('downloads.clearHistory') })
  if (!ok) return
  await run('clear', () => downloadsApi.clearHistory())
  await loadHistory()
}

async function addDownload(): Promise<void> {
  addError.value = ''
  const target = parseCivitaiInput(addInput.value)
  if (!target) {
    addError.value = t('downloads.addInvalid')
    return
  }
  adding.value = true
  try {
    const result = await downloadsApi.add(target)
    if (result.duplicate) toasts.push(t('downloads.duplicate'))
    else toasts.success(t('downloads.added', { name: result.item?.model_name || addInput.value.trim() }))
    addInput.value = ''
  } catch (error) {
    addError.value = (error as Error).message
  } finally {
    adding.value = false
    await queue.refresh()
  }
}

onMounted(() => {
  void loadHistory()
})

watch(finishedCount, (value) => {
  if (lastFinished !== -1 && value !== lastFinished) void loadHistory()
  lastFinished = value
})
</script>

<template>
  <div class="lm-page downloads">
    <header class="lm-page-header">
      <div>
        <h1>{{ t('downloads.title') }}</h1>
        <p v-if="queue.worker.value" class="lm-muted downloads__status">
          <span class="lm-badge" :class="queue.paused.value ? 'lm-badge--warning' : 'lm-badge--success'">
            {{ queue.paused.value ? t('downloads.paused') : t('downloads.running') }}
          </span>
          {{ t('downloads.concurrency', { count: queue.worker.value.max_concurrent ?? '?' }) }}
          <span v-if="queue.worker.value.rate_limited" class="lm-badge lm-badge--warning">{{ t('downloads.rateLimited') }}</span>
        </p>
      </div>
      <button
        v-if="queue.queueWorker.value"
        type="button"
        class="lm-btn"
        :disabled="busy === 'pause'"
        @click="togglePause"
      >
        <AppIcon :name="queue.paused.value ? 'play' : 'pause'" :size="16" />
        {{ queue.paused.value ? t('downloads.resumeAll') : t('downloads.pauseAll') }}
      </button>
    </header>

    <p v-if="queue.loaded.value && !queue.queueWorker.value && !queue.error.value" class="downloads__notice lm-panel">{{ t('downloads.workerOff') }}</p>

    <form class="downloads__add lm-panel" @submit.prevent="addDownload">
      <label class="lm-label" for="add-download">{{ t('downloads.add') }}</label>
      <div class="downloads__add-row">
        <input
          id="add-download"
          v-model="addInput"
          class="lm-input"
          :placeholder="t('downloads.addPlaceholder')"
          :aria-invalid="!!addError"
          aria-describedby="add-download-hint"
          autocomplete="off"
        />
        <button type="submit" class="lm-btn lm-btn--primary" :disabled="adding || !addInput.trim()">
          <AppIcon name="plus" :size="16" />{{ t('downloads.addButton') }}
        </button>
      </div>
      <p v-if="addError" class="lm-error-text" role="alert">{{ addError }}</p>
      <p id="add-download-hint" class="lm-hint">{{ t('downloads.addHint') }}</p>
    </form>

    <StateBlock v-if="queue.error.value && !queue.loaded.value" kind="error" :message="queue.error.value" @retry="queue.refresh()" />
    <StateBlock v-else-if="!queue.loaded.value" kind="loading" />
    <template v-else>
      <p v-if="queue.error.value" class="lm-error-text" role="alert">{{ queue.error.value }}</p>

      <section class="downloads__section" aria-labelledby="dl-active">
        <h2 id="dl-active">{{ t('downloads.active') }} <span class="lm-muted">{{ queue.active.value.length }}</span></h2>
        <p v-if="!queue.active.value.length" class="lm-muted">{{ t('downloads.noActive') }}</p>
        <ul v-else class="downloads__list">
          <li v-for="item in queue.active.value" :key="item.download_id" class="downloads__item lm-panel">
            <img v-if="item.thumbnail_url" class="downloads__thumb" :src="item.thumbnail_url" alt="" loading="lazy" />
            <div v-else class="downloads__thumb"></div>
            <div class="downloads__main">
              <strong class="downloads__name">{{ itemName(item) }}</strong>
              <div
                class="downloads__bar"
                role="progressbar"
                :aria-valuenow="Math.round(progressPercent(item.progress, item.bytes_downloaded, item.total_bytes))"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="itemName(item)"
              >
                <span :style="{ width: `${progressPercent(item.progress, item.bytes_downloaded, item.total_bytes)}%` }"></span>
              </div>
              <div class="downloads__meta">
                <span>{{ Math.round(progressPercent(item.progress, item.bytes_downloaded, item.total_bytes)) }}%</span>
                <span v-if="item.total_bytes">{{ formatBytes(item.bytes_downloaded) }} / {{ formatBytes(item.total_bytes) }}</span>
                <span v-if="item.bytes_per_second">{{ formatSpeed(item.bytes_per_second) }}</span>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <section class="downloads__section" aria-labelledby="dl-waiting">
        <h2 id="dl-waiting">{{ t('downloads.waiting') }} <span class="lm-muted">{{ queue.waiting.value.length }}</span></h2>
        <p v-if="!queue.waiting.value.length" class="lm-muted">{{ t('downloads.noWaiting') }}</p>
        <ul v-else class="downloads__list">
          <li v-for="(item, index) in queue.waiting.value" :key="item.download_id" class="downloads__item lm-panel">
            <img v-if="item.thumbnail_url" class="downloads__thumb" :src="item.thumbnail_url" alt="" loading="lazy" />
            <div v-else class="downloads__thumb"></div>
            <div class="downloads__main">
              <strong class="downloads__name">{{ itemName(item) }}</strong>
              <div class="downloads__meta">
                <span class="lm-badge" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
                <span>{{ formatDateTime(item.added_at) }}</span>
              </div>
            </div>
            <div class="downloads__actions">
              <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('downloads.moveTop')" :title="t('downloads.moveTop')" :disabled="index === 0 || busy === item.download_id" @click="run(item.download_id, () => downloadsApi.moveToTop(item.download_id))">
                <AppIcon name="arrowUp" :size="16" />
              </button>
              <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('downloads.moveEnd')" :title="t('downloads.moveEnd')" :disabled="index === queue.waiting.value.length - 1 || busy === item.download_id" @click="run(item.download_id, () => downloadsApi.moveToEnd(item.download_id))">
                <AppIcon name="arrowDown" :size="16" />
              </button>
              <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm downloads__danger" :aria-label="t('downloads.remove')" :title="t('downloads.remove')" :disabled="busy === item.download_id" @click="removeItem(item)">
                <AppIcon name="trash" :size="16" />
              </button>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <section class="downloads__section" aria-labelledby="dl-history">
      <div class="downloads__section-head">
        <h2 id="dl-history">{{ t('downloads.history') }} <span class="lm-muted">{{ historyTotal }}</span></h2>
        <div class="downloads__actions">
          <button v-if="failedCount" type="button" class="lm-btn lm-btn--sm" :disabled="busy === 'retry-all'" @click="retryAll">
            <AppIcon name="refresh" :size="14" />{{ t('downloads.retryAll') }}
          </button>
          <button v-if="history.length" type="button" class="lm-btn lm-btn--sm" :disabled="busy === 'clear'" @click="clearHistory">
            <AppIcon name="trash" :size="14" />{{ t('downloads.clearHistory') }}
          </button>
        </div>
      </div>
      <StateBlock v-if="historyError" kind="error" :message="historyError" @retry="loadHistory" />
      <StateBlock v-else-if="historyLoading && !history.length" kind="loading" />
      <p v-else-if="!history.length" class="lm-muted">{{ t('downloads.noHistory') }}</p>
      <ul v-else class="downloads__list">
        <li v-for="item in history" :key="item.download_id" class="downloads__item downloads__item--history lm-panel">
          <img v-if="item.thumbnail_url" class="downloads__thumb downloads__thumb--sm" :src="item.thumbnail_url" alt="" loading="lazy" />
          <div v-else class="downloads__thumb downloads__thumb--sm"></div>
          <div class="downloads__main">
            <strong class="downloads__name">{{ itemName(item) }}</strong>
            <div class="downloads__meta">
              <span class="lm-badge" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
              <span>{{ formatDateTime(item.completed_at) }}</span>
              <span v-if="item.total_bytes">{{ formatBytes(item.total_bytes) }}</span>
            </div>
            <p v-if="item.error" class="lm-error-text">{{ item.error }}</p>
          </div>
          <div class="downloads__actions">
            <button v-if="item.status === 'failed' || item.status === 'canceled'" type="button" class="lm-btn lm-btn--sm" :disabled="busy === item.download_id" @click="retry(item)">
              <AppIcon name="refresh" :size="14" />{{ t('downloads.retry') }}
            </button>
            <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('downloads.deleteEntry')" :title="t('downloads.deleteEntry')" :disabled="busy === item.download_id" @click="deleteEntry(item)">
              <AppIcon name="close" :size="16" />
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.downloads {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-6);
}

.downloads .lm-page-header {
  margin-bottom: 0;
}

.downloads__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lm-space-2);
  margin: var(--lm-space-2) 0 0;
  font-size: var(--lm-font-size-sm);
}

.downloads__notice {
  margin: 0;
  padding: var(--lm-space-3) var(--lm-space-4);
  color: var(--lm-color-muted);
}

.downloads__add {
  padding: var(--lm-space-4);
}

.downloads__add-row {
  display: flex;
  gap: var(--lm-space-2);
}

.downloads__section {
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-3);
}

.downloads__section h2 {
  font-size: var(--lm-font-size-lg);
}

.downloads__section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--lm-space-2);
}

.downloads__list {
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.downloads__item {
  display: flex;
  align-items: center;
  gap: var(--lm-space-3);
  padding: var(--lm-space-3);
}

.downloads__thumb {
  flex: none;
  width: 48px;
  height: 64px;
  border-radius: var(--lm-radius-sm);
  background: var(--lm-color-sunken);
  object-fit: cover;
}

.downloads__thumb--sm {
  width: 36px;
  height: 48px;
}

.downloads__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-1);
}

.downloads__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.downloads__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lm-space-2);
  color: var(--lm-color-muted);
  font-size: var(--lm-font-size-xs);
  font-variant-numeric: tabular-nums;
}

.downloads__bar {
  height: 6px;
  overflow: hidden;
  border-radius: var(--lm-radius-pill);
  background: var(--lm-color-sunken);
}

.downloads__bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--lm-color-accent);
  transition: width var(--lm-motion-normal) var(--lm-ease);
}

.downloads__actions {
  display: flex;
  align-items: center;
  gap: var(--lm-space-1);
}

.downloads__danger:hover:not(:disabled) {
  color: var(--lm-color-danger);
}

@media (max-width: 720px) {
  .downloads__item {
    flex-wrap: wrap;
  }

  .downloads__actions {
    margin-left: auto;
  }
}
</style>
