<script setup lang="ts">
/**
 * One model line on the Updates page: the new version's thumbnail, the model
 * name and base model, "your version -> new version" with release dates and
 * sizes, the reason the candidate is offered (or hidden), where the update
 * will be saved, and the actions Update / Open on Civitai / Open in library.
 * The row state (queued, downloading, in library) comes from the page.
 */
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import MenuButton, { type MenuEntry } from './MenuButton.vue'
import ReplaceNote from './ReplaceNote.vue'
import type { ModelPrefix, QueueItem, UpdateCandidate, UpdateGroup } from '@/api/types'
import { civitaiModelUrl } from '@/utils/civitai'
import { formatBytes, formatDate } from '@/utils/format'
import { isBlurred } from '@/utils/mature'
import {
  canQueue,
  currentCard,
  fileLabel,
  formatLabel,
  hiddenText,
  libraryLink,
  reasonText,
  type DerivedDestination,
  type RowQueueState,
} from '@/utils/updates'
import { t, type MessageKey } from '@/i18n'

const props = withDefaults(
  defineProps<{
    group: UpdateGroup
    candidate: UpdateCandidate
    prefix: ModelPrefix
    state: RowQueueState
    queuing: boolean
    destination: DerivedDestination
    /** Newer candidates of this line not shown in the row. */
    moreCount: number
    blurMature: boolean
    civitaiHost: string
    /** Bulk update: whether the row is ticked. */
    selected?: boolean
    /** Bulk update running: the checkbox and Update are locked. */
    locked?: boolean
    /** An ignore of this row is being stored. */
    ignoreBusy?: boolean
    /** The queue (or history) row of the candidate: shows its replace request. */
    queueItem?: QueueItem | null
  }>(),
  { selected: false, locked: false, ignoreBusy: false, queueItem: null },
)

const emit = defineEmits<{ update: []; select: [value: boolean]; ignore: [scope: 'version' | 'model'] }>()

const name = computed(() => props.group.modelName || t('updates.unknownVersion'))
const newName = computed(() => props.candidate.name || t('updates.unknownVersion'))
const card = computed(() => currentCard(props.group))
const thumb = computed(() => props.candidate.previewUrl || card.value?.previewUrl || '')
const blurred = computed(() => isBlurred(props.group.previewNsfwLevel, props.blurMature))
const civitaiUrl = computed(() => civitaiModelUrl(props.civitaiHost, props.group.modelId, props.candidate.versionId))
const libraryTarget = computed(() => (card.value ? libraryLink(props.prefix, card.value.filePath) : null))
const reason = computed(() => reasonText(props.group, props.candidate))
const hidden = computed(() => hiddenText(props.candidate))
// A hidden candidate keeps its confidence label, but not the colour of a visible one.
const confidenceClass = computed(() =>
  props.candidate.hiddenBecause.length
    ? ''
    : props.candidate.confidence === 'likely'
    ? 'lm-badge--success'
    : props.candidate.confidence === 'possible'
      ? 'lm-badge--accent'
      : '',
)
const stateLabel = computed(() => {
  const state = props.state
  if (!state) return ''
  if (state.kind === 'downloading') return t('updates.state.downloading', { progress: state.progress })
  return t(`updates.state.${state.kind}` as MessageKey)
})
const confidenceLabel = computed(() => t(`updates.confidence.${props.candidate.confidence}` as MessageKey))
const stateClass = computed(() => {
  const kind = props.state?.kind
  if (kind === 'done') return 'lm-badge--success'
  if (kind === 'failed') return 'lm-badge--danger'
  if (kind === 'paused') return 'lm-badge--warning'
  return 'lm-badge--accent'
})
const updateDisabled = computed(() => props.locked || props.queuing || !canQueue(props.state))
/** Only a row whose Update action is available can be ticked. */
const canSelect = computed(() => !props.queuing && canQueue(props.state))
const rowId = computed(() => `update-${props.group.key.replace(/[^a-z0-9-]/gi, '-')}`)
const format = computed(() => formatLabel(props.candidate))
const changelog = computed(() => props.candidate.description || '')
/** The file list is only worth showing when there is more than the main file. */
const files = computed(() => ((props.candidate.files?.length ?? 0) > 1 ? props.candidate.files! : []))
const ignoreItems = computed<MenuEntry[]>(() => [
  { id: 'version', label: t('updates.ignore.version'), icon: 'eyeOff', disabled: props.ignoreBusy || props.candidate.isIgnored },
  { id: 'model', label: t('updates.ignore.model'), icon: 'eyeOff', disabled: props.ignoreBusy || props.group.isIgnored },
])
function onIgnore(id: string): void {
  if (id === 'version' || id === 'model') emit('ignore', id)
}

const action = 'lm-btn phone:min-h-touch'
const iconAction = 'lm-btn lm-btn--ghost lm-btn--icon phone:size-touch'
</script>

<template>
  <li
    class="lm-panel flex gap-4 p-3 phone:flex-col phone:gap-3"
    :class="selected && 'border-accent'"
    :aria-labelledby="`${rowId}-name`"
  >
    <div class="flex min-w-0 flex-1 gap-3">
      <!-- Bulk selection: a 44px hit area on phones, the native checkbox for keyboard and screen readers. -->
      <label
        v-if="canSelect"
        class="-m-1 flex flex-none cursor-pointer items-start p-1 phone:-my-2 phone:min-h-touch phone:min-w-touch phone:items-center phone:justify-center"
      >
        <input
          type="checkbox"
          class="mt-1 size-[16px] cursor-pointer accent-accent phone:mt-0"
          :checked="selected"
          :disabled="locked"
          :aria-label="t('updates.bulk.selectRow', { name, version: newName })"
          :data-testid="`select-${group.key}`"
          @change="emit('select', ($event.target as HTMLInputElement).checked)"
        />
      </label>
      <span v-else class="w-[16px] flex-none phone:hidden" aria-hidden="true"></span>
      <LazyMedia
        class="lm-thumb h-[88px] w-[66px] overflow-hidden phone:h-[72px] phone:w-[54px]"
        :media-class="['size-full object-cover', blurred && 'scale-110 blur-[12px]']"
        :src="thumb"
        :alt="t('updates.thumbAlt', { name })"
        :icon-size="20"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <h3 :id="`${rowId}-name`" class="min-w-0 truncate text-md font-bold" :title="name">{{ name }}</h3>
          <span v-if="group.baseModel" class="lm-badge">{{ group.baseModel }}</span>
          <span class="lm-badge" :class="confidenceClass">{{ confidenceLabel }}</span>
          <span v-if="candidate.isEarlyAccess" class="lm-badge lm-badge--warning">{{ t('updates.earlyAccess') }}</span>
          <span v-if="candidate.isPaid" class="lm-badge lm-badge--warning">{{ t('updates.paid') }}</span>
          <span v-if="group.isIgnored" class="lm-badge">{{ t('updates.ignored') }}</span>
        </div>

        <!-- Your version -> new version: the one comparison the row is about. -->
        <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 text-sm tabular-nums">
          <dt class="text-muted">{{ t('updates.yourVersion') }}</dt>
          <dd class="min-w-0 truncate">
            <span class="text-fg">{{ group.newestOwned.name || t('updates.unknownVersion') }}</span>
            <span class="ml-2 text-muted">{{ formatDate(group.newestOwned.releasedAt) }}</span>
            <span v-if="group.newestOwned.sizeBytes" class="ml-2 text-muted">{{ formatBytes(group.newestOwned.sizeBytes) }}</span>
          </dd>
          <dt class="text-muted">{{ t('updates.newVersion') }}</dt>
          <dd class="min-w-0 truncate">
            <span class="font-medium text-accent">{{ newName }}</span>
            <span class="ml-2 text-muted">{{ formatDate(candidate.releasedAt) }}</span>
            <span v-if="candidate.sizeBytes" class="ml-2 text-muted">{{ formatBytes(candidate.sizeBytes) }}</span>
            <span v-if="format" class="lm-badge ml-2" :title="t('updates.formatLabel')" data-testid="format-badge">{{ format }}</span>
          </dd>
        </dl>

        <p class="text-sm text-pretty text-muted">{{ reason }}</p>
        <p v-if="hidden" class="text-sm text-pretty text-warning">{{ hidden }}</p>
        <p class="truncate text-xs text-muted" :title="destination.display || undefined">
          <template v-if="destination.known">{{ t('updates.saveTo', { path: destination.display }) }}</template>
          <template v-else>{{ t('updates.saveToDefault') }}</template>
        </p>
        <p v-if="moreCount" class="text-xs text-muted">
          {{ t('updates.moreVersions', { count: moreCount, versions: moreCount === 1 ? t('updates.version') : t('updates.versions') }) }}
        </p>
        <p v-if="state?.kind === 'failed' && state.error" class="lm-error-text">{{ state.error }}</p>
        <ReplaceNote :item="queueItem" />
        <!-- Changelog: plain text from the backend (no HTML is rendered). Only when a check stored it. -->
        <details v-if="changelog || files.length" class="group/changelog text-sm" data-testid="changelog">
          <summary
            class="inline-flex min-h-control-sm cursor-pointer items-center gap-1 rounded-sm text-accent hover:underline phone:min-h-touch"
            :aria-label="t('updates.whatsNewLabel', { name, version: newName })"
          >
            <AppIcon name="chevronRight" :size="14" class="transition-transform group-open/changelog:rotate-90 motion-reduce:transition-none" />
            {{ t('updates.whatsNew') }}
          </summary>
          <div class="mt-1 flex flex-col gap-2 rounded-sm bg-sunken p-3">
            <p v-if="changelog" class="max-h-[240px] overflow-y-auto text-pretty whitespace-pre-line wrap-anywhere">{{ changelog }}</p>
            <div v-if="files.length">
              <p class="text-xs font-medium text-muted">{{ t('updates.files') }}</p>
              <ul class="flex flex-col gap-[2px] text-xs tabular-nums">
                <li v-for="(file, index) in files" :key="index">
                  {{ fileLabel(file) || file.type }}
                  <span v-if="file.sizeBytes" class="text-muted"> · {{ formatBytes(file.sizeBytes) }}</span>
                  <span v-if="file.primary" class="text-muted"> ({{ t('updates.filePrimary') }})</span>
                </li>
              </ul>
            </div>
          </div>
        </details>
      </div>
    </div>

    <div class="flex flex-none flex-col items-end gap-2 phone:flex-row phone:items-center">
      <span v-if="stateLabel" class="lm-badge" :class="stateClass">{{ stateLabel }}</span>
      <div class="flex items-center gap-1 phone:ml-auto">
        <button
          type="button"
          :class="[action, 'lm-btn--primary']"
          :disabled="updateDisabled"
          :aria-label="t('updates.action.updateLabel', { name, version: newName })"
          @click="emit('update')"
        >
          <AppIcon name="download" :size="16" />{{ t('updates.action.update') }}
        </button>
        <MenuButton
          :label="t('updates.ignore.menu')"
          icon="eyeOff"
          align="right"
          button-class="lm-btn lm-btn--ghost phone:min-h-touch"
          :items="ignoreItems"
          @select="onIgnore"
        />
        <a
          v-if="civitaiUrl"
          :class="iconAction"
          :href="civitaiUrl"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="t('updates.action.civitaiLabel', { name })"
          :title="t('updates.action.civitai')"
        >
          <AppIcon name="external" :size="16" />
        </a>
        <RouterLink
          v-if="libraryTarget"
          :class="iconAction"
          :to="libraryTarget"
          :aria-label="t('updates.action.libraryLabel', { name })"
          :title="t('updates.action.library')"
        >
          <AppIcon name="layers" :size="16" />
        </RouterLink>
      </div>
    </div>
  </li>
</template>
