<script setup lang="ts">
/**
 * Full download dialog (port of the classic DownloadManager): Civitai URL /
 * model id / download link -> version (+ files) -> root and folder (or the
 * default path template) -> rows in the backend download queue.
 *
 * Resolving uses read-only lookups only; "Add to queue" calls
 * `downloads/queue/add` (the queue worker starts the downloads).
 */
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import ModalShell from './ModalShell.vue'
import type { ModelPrefix } from '@/api/types'
import { LIBRARIES } from '@/config/libraries'
import { useAppSettings } from '@/composables/useAppSettings'
import { useDownloadFlow } from '@/composables/useDownloadFlow'
import { useDownloadQueue } from '@/composables/useDownloadQueue'
import { versionSizeBytes, versionStatus, versionThumbnail } from '@/utils/downloads'
import { formatBytes, formatDate } from '@/utils/format'
import { t } from '@/i18n'

const props = defineProps<{ prefix: ModelPrefix; initialInput?: string }>()
const emit = defineEmits<{ close: [] }>()

const { settings, load: loadSettings } = useAppSettings()
const queue = useDownloadQueue(3000)
const type = ref<ModelPrefix>(props.prefix)
const input = ref(props.initialInput ?? '')
const folderFilter = ref('')

function makeFlow(prefix: ModelPrefix) {
  return useDownloadFlow(prefix, { queue: () => queue.queue.value, settings: () => settings.value })
}
// shallowRef: the flow object holds refs that must stay refs (no deep unwrapping).
const flow = shallowRef(makeFlow(type.value))
watch(type, (value) => {
  flow.value = makeFlow(value)
})
const f = computed(() => flow.value)

const versionStates = computed(() =>
  f.value.versions.value.map((version) => ({ version, status: versionStatus(version, queue.queue.value) })),
)
const blockedReason = computed(() => {
  const status = f.value.status.value
  if (!status || status.canQueue) return ''
  return status.queued ? t('download.blocked.queued') : t('download.blocked.inLibrary')
})
const shownFolders = computed(() => {
  const query = folderFilter.value.trim().toLowerCase()
  const all = f.value.folders.value
  return query ? all.filter((path) => path.toLowerCase().includes(query)) : all
})
const queueCount = computed(() => Math.max(1, f.value.selectedFileIds.value.size))
const busy = computed(() => f.value.busy.value)

onMounted(async () => {
  await loadSettings()
  if (input.value.trim()) void find()
})

async function find(): Promise<void> {
  await f.value.resolve(input.value)
}

function onRootChange(event: Event): void {
  void f.value.setRoot((event.target as HTMLSelectElement).value)
}

// `relative` keeps the visually hidden radio inside its row, so focusing it never scrolls the dialog itself.
const versionRow =
  'lm-row relative flex cursor-pointer items-start gap-3 p-2 has-focus-visible:focus-ring hairline border-border rounded-md'

// Show the preselected version (e.g. from ?modelVersionId=) in the list.
watch(
  () => f.value.step.value,
  async (step) => {
    if (step !== 'version') return
    await nextTick()
    document.querySelector('input[name="download-version"]:checked')?.closest('label')?.scrollIntoView({ block: 'nearest' })
  },
)
</script>

<template>
  <ModalShell :title="t('download.title')" title-id="download-dialog-title" :busy="busy" wide @close="emit('close')">
    <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
      <!-- Step 1: input -->
      <form v-if="f.step.value === 'input'" class="flex flex-col gap-3" novalidate @submit.prevent="find">
        <div class="flex flex-col gap-1">
          <label class="lm-label" for="download-type">{{ t('download.type') }}</label>
          <select id="download-type" v-model="type" class="lm-select" :disabled="busy">
            <option v-for="entry in LIBRARIES" :key="entry.prefix" :value="entry.prefix">{{ t(entry.title) }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="lm-label" for="download-input">{{ t('download.input') }}</label>
          <input
            id="download-input"
            v-model="input"
            class="lm-input font-mono"
            autocomplete="off"
            spellcheck="false"
            :disabled="busy"
            :aria-invalid="!!f.error.value"
            aria-describedby="download-input-hint download-input-error"
          />
          <p id="download-input-hint" class="lm-hint">{{ t('download.inputHint') }}</p>
          <p id="download-input-error" class="lm-error-text" role="alert">{{ f.error.value ?? '' }}</p>
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" class="lm-btn" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button type="submit" class="lm-btn lm-btn--primary" :disabled="busy || !input.trim()">
            <AppIcon name="search" :size="16" />{{ busy ? t('download.finding') : t('download.find') }}
          </button>
        </div>
      </form>

      <!-- Step 2: version and files -->
      <template v-else-if="f.step.value === 'version'">
        <fieldset class="flex min-w-0 flex-col gap-2" :disabled="busy">
          <legend class="lm-label mb-1">{{ t('download.versions') }}</legend>
          <div class="flex max-h-[min(360px,45vh)] flex-col gap-2 overflow-y-auto pr-1">
            <label
              v-for="{ version, status } in versionStates"
              :key="version.id"
              :class="[versionRow, { 'is-selected': f.selectedVersionId.value === version.id }]"
            >
              <input
                class="sr-only"
                type="radio"
                name="download-version"
                :value="version.id"
                :checked="f.selectedVersionId.value === version.id"
                @change="f.selectVersion(version.id)"
              />
              <LazyMedia class="h-[72px] w-[56px] flex-none overflow-hidden rounded-sm" media-class="size-full object-cover" :src="versionThumbnail(version)" kind="image" />
              <span class="flex min-w-0 flex-1 flex-col gap-1">
                <strong class="wrap-anywhere">{{ version.name }}</strong>
                <span class="flex flex-wrap gap-x-3 text-xs text-muted">
                  <span v-if="version.baseModel">{{ version.baseModel }}</span>
                  <span v-if="version.createdAt">{{ formatDate(version.createdAt) }}</span>
                  <span v-if="versionSizeBytes(version)">{{ formatBytes(versionSizeBytes(version)) }}</span>
                </span>
                <span class="flex flex-wrap gap-1">
                  <span v-if="status.inLibrary && !status.partial" class="lm-badge lm-badge--success">{{ t('download.badge.inLibrary') }}</span>
                  <span v-if="status.partial" class="lm-badge lm-badge--warning">{{ t('download.badge.partial') }}</span>
                  <span v-if="status.downloadedBefore" class="lm-badge">{{ t('download.badge.downloaded') }}</span>
                  <span v-if="status.queued" class="lm-badge lm-badge--accent">{{ t('download.badge.queued') }}</span>
                  <span v-if="status.earlyAccess" class="lm-badge lm-badge--warning">{{ t('download.badge.earlyAccess') }}</span>
                </span>
                <span v-if="version.localPath" class="lm-mono text-xs text-muted wrap-anywhere">{{ version.localPath }}</span>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset v-if="f.files.value.length > 1" class="flex min-w-0 flex-col gap-1" :disabled="busy">
          <legend class="lm-label mb-1">{{ t('download.files') }}</legend>
          <label v-for="file in f.files.value" :key="file.id" class="flex items-center gap-2 text-sm">
            <input
              class="lm-check"
              type="checkbox"
              :checked="f.selectedFileIds.value.has(file.id) || f.localFileIds.value.has(String(file.id))"
              :disabled="f.localFileIds.value.has(String(file.id))"
              @change="f.toggleFile(file.id)"
            />
            <span class="lm-mono wrap-anywhere">{{ file.name }}</span>
            <span class="text-xs text-muted">
              {{ [file.metadata?.size, file.metadata?.fp, file.metadata?.format].filter(Boolean).join(' · ') }}
              <template v-if="file.sizeKB"> · {{ formatBytes(file.sizeKB * 1024) }}</template>
            </span>
            <span v-if="f.localFileIds.value.has(String(file.id))" class="lm-badge lm-badge--success">{{ t('download.fileInLibrary') }}</span>
          </label>
          <p class="lm-hint">{{ t('download.filesHint') }}</p>
        </fieldset>

        <p v-if="blockedReason" class="text-sm text-muted" role="status">{{ blockedReason }}</p>
        <p class="lm-error-text" role="alert">{{ f.error.value ?? '' }}</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="lm-btn" :disabled="busy" @click="f.back()">
            <AppIcon name="chevronLeft" :size="16" />{{ t('download.back') }}
          </button>
          <button type="button" class="lm-btn lm-btn--primary" :disabled="!f.canContinue.value" @click="f.toLocation()">
            {{ t('download.next') }}<AppIcon name="chevronRight" :size="16" />
          </button>
        </div>
      </template>

      <!-- Step 3: location -->
      <form v-else-if="f.step.value === 'location'" class="flex flex-col gap-4" novalidate @submit.prevent="f.submit()">
        <div class="flex flex-col gap-1">
          <label class="lm-label" for="download-root">{{ t('download.root') }}</label>
          <select id="download-root" class="lm-select" :value="f.root.value" :disabled="busy" @change="onRootChange">
            <option v-for="entry in f.roots.value" :key="entry" :value="entry">{{ entry }}</option>
          </select>
        </div>

        <label class="flex items-start gap-2 text-sm">
          <input v-model="f.useDefaultPath.value" class="lm-check mt-1" type="checkbox" :disabled="busy" />
          <span>
            {{ t('download.useDefault') }}
            <span class="block text-xs text-muted">
              {{ f.template.value ? t('download.useDefaultHint', { template: f.template.value }) : t('download.flat') }}
            </span>
          </span>
        </label>

        <fieldset v-if="!f.useDefaultPath.value" class="flex min-w-0 flex-col gap-2" :disabled="busy">
          <legend class="lm-label mb-1">{{ t('download.folder') }}</legend>
          <input
            id="download-folder"
            v-model="f.folder.value"
            class="lm-input font-mono"
            autocomplete="off"
            spellcheck="false"
            :aria-label="t('download.folder')"
            :aria-invalid="!!f.folderError.value"
            aria-describedby="download-folder-hint download-folder-error"
          />
          <p id="download-folder-hint" class="lm-hint">{{ t('download.folderHint') }}</p>
          <p id="download-folder-error" class="lm-error-text" role="alert">{{ f.folderError.value ?? '' }}</p>
          <label class="sr-only" for="download-folder-filter">{{ t('actions.move.filter') }}</label>
          <input id="download-folder-filter" v-model="folderFilter" class="lm-input" type="search" :placeholder="t('actions.move.filter')" />
          <div class="max-h-[min(220px,30vh)] overflow-y-auto rounded-md hairline border-border bg-surface p-1" role="listbox" :aria-label="t('download.folder')">
            <button
              type="button"
              role="option"
              class="lm-row flex min-h-[30px] w-full cursor-pointer items-center gap-2 px-2 text-left text-sm"
              :class="{ 'is-selected': f.folder.value === '' }"
              :aria-selected="f.folder.value === ''"
              @click="f.folder.value = ''"
            >
              <AppIcon name="grid" :size="15" />{{ t('actions.move.rootFolder') }}
            </button>
            <button
              v-for="path in shownFolders"
              :key="path"
              type="button"
              role="option"
              class="lm-row flex min-h-[30px] w-full cursor-pointer items-center gap-2 px-2 text-left text-sm"
              :class="{ 'is-selected': f.folder.value === path }"
              :aria-selected="f.folder.value === path"
              :title="path"
              @click="f.folder.value = path"
            >
              <AppIcon name="folder" :size="15" /><span class="truncate">{{ path }}</span>
            </button>
            <p v-if="!shownFolders.length && folderFilter.trim()" class="p-2 text-sm text-muted">{{ t('actions.move.noFolders') }}</p>
          </div>
        </fieldset>

        <div class="rounded-md bg-sunken p-3 text-sm">
          <p class="lm-overline mb-1">{{ t('download.target') }}</p>
          <p class="lm-mono wrap-anywhere" data-testid="download-target">{{ f.preview.value || '-' }}</p>
          <p v-if="f.useDefaultPath.value && f.template.value" class="mt-2 text-xs text-muted">{{ t('download.templateNote') }}</p>
        </div>

        <p class="lm-error-text" role="alert">{{ f.error.value ?? '' }}</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="lm-btn" :disabled="busy" @click="f.back()">
            <AppIcon name="chevronLeft" :size="16" />{{ t('download.back') }}
          </button>
          <button type="submit" class="lm-btn lm-btn--primary" :disabled="busy || !f.root.value || !!f.folderError.value">
            <AppIcon name="download" :size="16" />
            {{ busy ? t('download.queuing') : queueCount > 1 ? t('download.queueFiles', { count: queueCount }) : t('download.queue') }}
          </button>
        </div>
      </form>

      <!-- Step 4: done -->
      <div v-else class="flex flex-col gap-3" role="status">
        <p class="text-md font-bold">{{ t('download.doneTitle') }}</p>
        <p class="text-sm">
          {{ t('download.doneSummary', { queued: f.result.value?.queued ?? 0, duplicates: f.result.value?.duplicates ?? 0, failed: f.result.value?.failed ?? 0 }) }}
        </p>
        <ul v-if="f.result.value?.errors.length" class="lm-error-text flex flex-col gap-1">
          <li v-for="(entry, index) in f.result.value.errors" :key="index">{{ entry }}</li>
        </ul>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="lm-btn" @click="f.reset(); input = ''">{{ t('download.another') }}</button>
          <RouterLink class="lm-btn" to="/downloads" @click="emit('close')">{{ t('download.openQueue') }}</RouterLink>
          <button type="button" class="lm-btn lm-btn--primary" @click="emit('close')">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>
  </ModalShell>
</template>
