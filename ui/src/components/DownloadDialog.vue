<script setup lang="ts">
/**
 * Download dialog (port of the classic DownloadManager, extended to batches):
 * one or many Civitai URLs / model ids / download links -> one row per entry
 * (version + file, status, selection) -> one shared root and folder (or the
 * default path template) -> rows in the backend download queue.
 *
 * Resolving uses read-only lookups only (2 at a time); "Add N to queue" calls
 * `downloads/queue/add` once per selected row (the queue worker starts the
 * downloads). Failed rows stay selected, so Add retries only those.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import ModalShell from './ModalShell.vue'
import type { CivitaiFile, CivitaiVersion, ModelPrefix } from '@/api/types'
import { LIBRARIES } from '@/config/libraries'
import { useAppSettings } from '@/composables/useAppSettings'
import { useBatchDownload } from '@/composables/useBatchDownload'
import { useDownloadQueue } from '@/composables/useDownloadQueue'
import { isEditable, parseBatchInput, rowStatus, selectedVersionOf, type BatchRow } from '@/utils/batchDownload'
import { versionThumbnail, weightFiles } from '@/utils/downloads'
import { formatBytes } from '@/utils/format'
import { t } from '@/i18n'

const props = defineProps<{ prefix: ModelPrefix; initialInput?: string }>()
const emit = defineEmits<{ close: [] }>()

const { settings, load: loadSettings } = useAppSettings()
const queue = useDownloadQueue(3000)
const type = ref<ModelPrefix>(props.prefix)
const input = ref(props.initialInput ?? '')
const pasteError = ref('')
const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText

function makeBatch(prefix: ModelPrefix) {
  return useBatchDownload(prefix, { queue: () => queue.queue.value, settings: () => settings.value })
}
// shallowRef: the batch object holds refs that must stay refs (no deep unwrapping).
const batch = shallowRef(makeBatch(type.value))
watch(type, (value) => {
  batch.value.stop()
  batch.value = makeBatch(value)
})
const b = computed(() => batch.value)

const parsed = computed(() => parseBatchInput(input.value))
const submitting = computed(() => b.value.submitting.value)
const rows = computed(() => b.value.rows.value)
const summary = computed(() => b.value.summary.value)

onMounted(async () => {
  await loadSettings()
  if (input.value.trim()) void find()
})
onBeforeUnmount(() => batch.value.stop())

async function find(): Promise<void> {
  if (!parsed.value.entries.length && !input.value.trim()) return
  await b.value.start(input.value)
}

async function paste(): Promise<void> {
  pasteError.value = ''
  try {
    const text = await navigator.clipboard.readText()
    if (text) input.value = input.value.trim() ? `${input.value.replace(/\s+$/, '')}\n${text}` : text
  } catch {
    pasteError.value = t('download.pasteFailed')
  }
}

function onRootChange(event: Event): void {
  void b.value.setRoot((event.target as HTMLSelectElement).value)
}

function nameOf(row: BatchRow): string {
  return row.modelName || (row.modelId != null ? t('download.batch.modelFallback', { id: row.modelId }) : row.raw)
}

function thumbOf(row: BatchRow): string {
  const version = selectedVersionOf(row)
  return version ? versionThumbnail(version) : ''
}

function filesOf(row: BatchRow): CivitaiFile[] {
  const version = selectedVersionOf(row)
  return version ? weightFiles(version) : []
}

function statusOf(row: BatchRow) {
  return rowStatus(row, queue.queue.value)
}

function versionLabel(version: CivitaiVersion): string {
  const parts = [version.name || `#${version.id}`, version.baseModel].filter(Boolean).join(' · ')
  return version.existsLocally ? `${parts} (${t('download.badge.inLibrary').toLowerCase()})` : parts
}

function fileLabel(row: BatchRow, file: CivitaiFile): string {
  const details = [file.metadata?.size, file.metadata?.fp, file.sizeKB ? formatBytes(file.sizeKB * 1024) : '']
    .filter(Boolean)
    .join(' · ')
  const local = (selectedVersionOf(row)?.downloadedFiles ?? []).some((entry) => String(entry.fileId ?? '') === String(file.id))
  return `${file.name ?? `#${file.id}`}${details ? ` (${details})` : ''}${local ? ` (${t('download.badge.inLibrary').toLowerCase()})` : ''}`
}

const footerStatus = computed(() => {
  const current = b.value
  if (current.submitting.value) return t('download.queuing', current.progress.value)
  if (current.resolving.value) return t('download.batch.resolving', { done: current.resolvedCount.value, total: rows.value.length })
  if (!current.selectedCount.value && current.readyCount.value && !summary.value) return t('download.batch.nothingSelected')
  return ''
})

const reasonKey = {
  inLibrary: 'download.batch.skip.inLibrary',
  queued: 'download.batch.skip.queued',
  duplicate: 'download.batch.skip.duplicate',
} as const

const control = 'lm-select min-h-control-sm w-auto max-w-full min-w-0 py-0 text-xs'
</script>

<template>
  <ModalShell :title="t('download.title')" title-id="download-dialog-title" :busy="submitting" wide @close="emit('close')">
    <!-- Step 1: input -->
    <form v-if="b.step.value === 'input'" class="flex min-h-0 flex-1 flex-col" novalidate @submit.prevent="find">
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4">
        <div class="flex flex-col gap-1">
          <label class="lm-label" for="download-type">{{ t('download.type') }}</label>
          <select id="download-type" v-model="type" class="lm-select">
            <option v-for="entry in LIBRARIES" :key="entry.prefix" :value="entry.prefix">{{ t(entry.title) }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="lm-label" for="download-input">{{ t('download.input') }}</label>
          <textarea
            id="download-input"
            v-model="input"
            class="lm-textarea font-mono"
            rows="6"
            autocomplete="off"
            spellcheck="false"
            :aria-invalid="!!b.error.value"
            aria-describedby="download-input-hint download-input-preview download-input-error"
          />
          <p id="download-input-hint" class="lm-hint">{{ t('download.inputHint') }}</p>
          <div class="flex flex-wrap items-center gap-2">
            <button v-if="canPaste" type="button" class="lm-btn lm-btn--sm" @click="paste">
              <AppIcon name="copy" :size="14" />{{ t('download.paste') }}
            </button>
            <p id="download-input-preview" class="text-xs text-muted" aria-live="polite">
              <template v-if="input.trim()">
                {{ t('download.parsePreview', { count: parsed.entries.length }) }}<template v-if="parsed.invalid.length">
                  · <span class="text-danger">{{ t('download.parseInvalid', { count: parsed.invalid.length }) }}</span></template
                ><template v-if="parsed.duplicates"> · {{ t('download.parseDuplicates', { count: parsed.duplicates }) }}</template>
              </template>
            </p>
          </div>
          <p v-if="pasteError" class="lm-error-text" role="alert">{{ pasteError }}</p>
          <p id="download-input-error" class="lm-error-text" role="alert">{{ b.error.value ?? '' }}</p>
        </div>
      </div>
      <footer class="flex flex-wrap justify-end gap-2 hairline-t border-border px-5 py-3">
        <button type="button" class="lm-btn" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="submit" class="lm-btn lm-btn--primary" :disabled="!input.trim()">
          <AppIcon name="search" :size="16" />
          {{ parsed.entries.length > 1 ? t('download.findCount', { count: parsed.entries.length }) : t('download.find') }}
        </button>
      </footer>
    </form>

    <!-- Step 2: rows, destination, submit -->
    <form v-else class="flex min-h-0 flex-1 flex-col" novalidate @submit.prevent="b.submit()">
      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
        <section class="flex flex-col gap-2" :aria-label="t('download.batch.entries')">
          <div class="flex flex-wrap items-center gap-2">
            <p class="mr-auto text-sm text-muted" data-testid="batch-counts">
              {{ t('download.batch.counts', { total: rows.length, ready: b.readyCount.value, selected: b.selectedCount.value }) }}
            </p>
            <button v-if="b.resolving.value" type="button" class="lm-btn lm-btn--sm" @click="b.stop()">
              <AppIcon name="pause" :size="14" />{{ t('download.batch.stop') }}
            </button>
            <button
              v-else-if="b.errorCount.value"
              type="button"
              class="lm-btn lm-btn--sm"
              :disabled="submitting"
              @click="b.retryErrors()"
            >
              <AppIcon name="refresh" :size="14" />{{ t('download.batch.retryErrors') }}
            </button>
            <template v-if="rows.length > 1">
              <button type="button" class="lm-btn lm-btn--sm" :disabled="submitting" @click="b.selectAll(true)">{{ t('download.batch.selectAll') }}</button>
              <button type="button" class="lm-btn lm-btn--sm" :disabled="submitting" @click="b.selectAll(false)">{{ t('download.batch.selectNone') }}</button>
            </template>
            <button type="button" class="lm-btn lm-btn--sm" :disabled="submitting" @click="b.back()">
              <AppIcon name="chevronLeft" :size="14" />{{ t('download.back') }}
            </button>
          </div>

          <div v-if="b.invalid.value.length" class="flex flex-col gap-1 rounded-md bg-danger-soft p-2 text-sm" data-testid="batch-invalid">
            <div class="flex items-center gap-2">
              <AppIcon name="alert" :size="15" class="flex-none text-danger" />
              <strong class="mr-auto text-danger">{{ t('download.batch.invalidTitle', { count: b.invalid.value.length }) }}</strong>
              <button type="button" class="lm-btn lm-btn--sm" @click="b.clearInvalid()">
                <AppIcon name="close" :size="14" />{{ t('download.batch.removeInvalid') }}
              </button>
            </div>
            <ul class="flex flex-col gap-px pl-6">
              <li v-for="entry in b.invalid.value" :key="entry" class="truncate font-mono text-xs" :title="entry">{{ entry }}</li>
            </ul>
          </div>

          <ul class="flex flex-col gap-2" data-testid="batch-rows">
            <li
              v-for="row in rows"
              :key="row.key"
              class="flex items-start gap-2 rounded-md hairline p-2"
              :class="[
                row.phase === 'error' || row.submit === 'failed' ? 'border-danger' : 'border-border',
                row.selected && isEditable(row) ? 'bg-accent-soft' : 'bg-surface',
              ]"
              :data-row="row.raw"
            >
              <input
                class="mt-1 size-[16px] flex-none cursor-pointer accent-accent"
                type="checkbox"
                :checked="row.selected"
                :disabled="!isEditable(row) || submitting"
                :aria-label="t('download.batch.include', { name: nameOf(row) })"
                @change="b.toggle(row.key, ($event.target as HTMLInputElement).checked)"
              />
              <LazyMedia
                class="h-[52px] w-[40px] flex-none overflow-hidden rounded-sm bg-sunken"
                media-class="size-full object-cover"
                :src="thumbOf(row)"
                kind="image"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <p class="flex min-w-0 items-center gap-2">
                  <strong class="truncate text-sm" :title="nameOf(row)">{{ nameOf(row) }}</strong>
                </p>
                <p class="truncate font-mono text-xs text-muted" :title="row.raw">{{ row.raw }}</p>

                <template v-if="row.phase === 'ready'">
                  <div class="flex min-w-0 flex-wrap gap-2">
                    <select
                      :class="control"
                      :value="row.versionId ?? ''"
                      :disabled="!isEditable(row) || submitting"
                      :aria-label="`${t('download.versions')}: ${nameOf(row)}`"
                      @change="b.setVersion(row.key, Number(($event.target as HTMLSelectElement).value))"
                    >
                      <option v-for="version in row.versions" :key="version.id" :value="version.id">{{ versionLabel(version) }}</option>
                    </select>
                    <select
                      v-if="filesOf(row).length > 1"
                      :class="control"
                      :value="row.fileId ?? ''"
                      :disabled="!isEditable(row) || submitting"
                      :aria-label="`${t('download.files')}: ${nameOf(row)}`"
                      @change="b.setFile(row.key, Number(($event.target as HTMLSelectElement).value))"
                    >
                      <option v-for="file in filesOf(row)" :key="file.id" :value="file.id">{{ fileLabel(row, file) }}</option>
                    </select>
                  </div>
                  <div v-if="statusOf(row)" class="flex flex-wrap items-center gap-1">
                    <span v-if="statusOf(row)!.inLibrary && !statusOf(row)!.partial" class="lm-badge lm-badge--success">{{ t('download.badge.inLibrary') }}</span>
                    <span v-if="statusOf(row)!.partial" class="lm-badge lm-badge--warning">{{ t('download.badge.partial') }}</span>
                    <span v-if="statusOf(row)!.fileInLibrary" class="lm-badge lm-badge--success">{{ t('download.badge.fileInLibrary') }}</span>
                    <span v-if="statusOf(row)!.downloadedBefore" class="lm-badge">{{ t('download.badge.downloaded') }}</span>
                    <span v-if="statusOf(row)!.queued" class="lm-badge lm-badge--accent">{{ t('download.badge.queued') }}</span>
                    <span v-if="statusOf(row)!.earlyAccess" class="lm-badge lm-badge--warning">{{ t('download.badge.earlyAccess') }}</span>
                    <span v-if="row.reason && !row.selected && row.submit === 'idle'" class="text-xs text-muted">{{ t(reasonKey[row.reason]) }}</span>
                  </div>
                  <p v-if="row.submit === 'failed'" class="text-xs text-danger">{{ row.submitError }}</p>
                </template>
                <p v-else-if="row.phase === 'error'" class="text-xs text-danger">{{ row.error }}</p>
                <p v-else class="flex items-center gap-2 text-xs text-muted">
                  <span
                    v-if="row.phase === 'resolving'"
                    class="size-[12px] animate-spinner rounded-pill border-2 border-border border-t-accent"
                    aria-hidden="true"
                  />
                  {{ row.phase === 'resolving' ? t('download.batch.looking') : t('download.batch.waiting') }}
                </p>
              </div>
              <div class="flex flex-none items-center gap-1">
                <span v-if="row.submit === 'submitting'" class="lm-badge">
                  <span class="size-[10px] animate-spinner rounded-pill border-2 border-border border-t-accent" aria-hidden="true" />
                  {{ t('download.batch.state.adding') }}
                </span>
                <span v-else-if="row.submit === 'added'" class="lm-badge lm-badge--success">
                  <AppIcon name="check" :size="12" />{{ t('download.batch.state.added') }}
                </span>
                <span v-else-if="row.submit === 'duplicate'" class="lm-badge lm-badge--accent">{{ t('download.batch.state.duplicate') }}</span>
                <span v-else-if="row.submit === 'failed'" class="lm-badge lm-badge--danger">{{ t('download.batch.state.failed') }}</span>
                <button
                  v-if="row.phase === 'error'"
                  type="button"
                  class="lm-btn lm-btn--sm"
                  :disabled="submitting"
                  @click="b.retryRow(row.key)"
                >
                  <AppIcon name="refresh" :size="14" />{{ t('download.batch.retry') }}
                </button>
                <button
                  v-if="row.submit !== 'added' && row.submit !== 'duplicate'"
                  type="button"
                  class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm"
                  :disabled="submitting"
                  :aria-label="t('download.batch.remove', { name: nameOf(row) })"
                  :title="t('download.batch.remove', { name: nameOf(row) })"
                  @click="b.removeRow(row.key)"
                >
                  <AppIcon name="close" :size="14" />
                </button>
              </div>
            </li>
          </ul>
        </section>

        <fieldset class="flex min-w-0 flex-col gap-3 rounded-md hairline border-border p-3" :disabled="submitting">
          <legend class="lm-label px-1">{{ t('download.batch.destination') }}</legend>
          <div class="flex flex-col gap-1">
            <label class="lm-label" for="download-root">{{ t('download.root') }}</label>
            <select id="download-root" class="lm-select" :value="b.root.value" @change="onRootChange">
              <option v-for="entry in b.roots.value" :key="entry" :value="entry">{{ entry }}</option>
            </select>
          </div>
          <label class="flex items-start gap-2 text-sm">
            <input v-model="b.useDefaultPath.value" class="mt-1 accent-accent" type="checkbox" />
            <span>
              {{ t('download.useDefault') }}
              <span class="block text-xs text-muted">
                {{ b.template.value ? t('download.useDefaultHint', { template: b.template.value }) : t('download.flat') }}
              </span>
            </span>
          </label>
          <div v-if="!b.useDefaultPath.value" class="flex flex-col gap-1">
            <label class="lm-label" for="download-folder">{{ t('download.folder') }}</label>
            <input
              id="download-folder"
              v-model="b.folder.value"
              class="lm-input font-mono"
              list="download-folder-options"
              autocomplete="off"
              spellcheck="false"
              :aria-invalid="!!b.folderError.value"
              aria-describedby="download-folder-hint download-folder-error"
            />
            <datalist id="download-folder-options">
              <option v-for="path in b.folders.value" :key="path" :value="path" />
            </datalist>
            <p id="download-folder-hint" class="lm-hint">{{ t('download.folderHint') }}</p>
            <p id="download-folder-error" class="lm-error-text" role="alert">{{ b.folderError.value ?? '' }}</p>
          </div>
          <div class="rounded-md bg-sunken p-2 text-sm">
            <p class="lm-overline mb-1">{{ t('download.target') }}</p>
            <p class="lm-mono wrap-anywhere" data-testid="download-target">{{ b.preview.value || '-' }}</p>
            <p v-if="b.useDefaultPath.value && b.template.value" class="mt-1 text-xs text-muted">{{ t('download.templateNote') }}</p>
          </div>
        </fieldset>

        <div role="status" aria-live="polite" data-testid="batch-summary">
          <div v-if="summary" class="flex flex-col gap-1 rounded-md bg-sunken p-3 text-sm">
            <p class="font-medium">
              {{ t('download.doneSummary', { queued: summary.added, duplicates: summary.duplicates, failed: summary.failed }) }}
            </p>
            <template v-if="summary.failures.length">
              <p class="text-xs text-muted">{{ t('download.batch.failures') }}</p>
              <ul class="flex flex-col gap-px text-xs text-danger">
                <li v-for="entry in summary.failures" :key="entry.key" class="wrap-anywhere">{{ entry.label }}: {{ entry.reason }}</li>
              </ul>
            </template>
          </div>
        </div>
        <p class="lm-error-text" role="alert">{{ b.error.value ?? '' }}</p>
      </div>

      <footer class="flex flex-wrap items-center justify-end gap-2 hairline-t border-border px-5 py-3">
        <p class="mr-auto min-w-0 text-xs text-muted" aria-live="polite" data-testid="batch-progress">{{ footerStatus }}</p>
        <RouterLink v-if="summary" class="lm-btn" to="/downloads" @click="emit('close')">{{ t('download.openQueue') }}</RouterLink>
        <button type="button" class="lm-btn" :disabled="submitting" @click="emit('close')">
          {{ summary ? t('common.close') : t('common.cancel') }}
        </button>
        <button
          type="submit"
          class="lm-btn lm-btn--primary"
          :disabled="submitting || !b.selectedCount.value || !b.root.value || !!b.folderError.value"
        >
          <AppIcon name="download" :size="16" />
          {{
            submitting
              ? t('download.queuing', b.progress.value)
              : b.selectedCount.value === 1
                ? t('download.queue')
                : t('download.queueCount', { count: b.selectedCount.value })
          }}
        </button>
      </footer>
    </form>
  </ModalShell>
</template>
