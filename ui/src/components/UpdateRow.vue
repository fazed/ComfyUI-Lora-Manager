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
import type { ModelPrefix, UpdateCandidate, UpdateGroup } from '@/api/types'
import { civitaiModelUrl } from '@/utils/civitai'
import { formatBytes, formatDate } from '@/utils/format'
import { isBlurred } from '@/utils/mature'
import {
  canQueue,
  currentCard,
  hiddenText,
  libraryLink,
  reasonText,
  type DerivedDestination,
  type RowQueueState,
} from '@/utils/updates'
import { t, type MessageKey } from '@/i18n'

const props = defineProps<{
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
}>()

const emit = defineEmits<{ update: [] }>()

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
const updateDisabled = computed(() => props.queuing || !canQueue(props.state))
const rowId = computed(() => `update-${props.group.key.replace(/[^a-z0-9-]/gi, '-')}`)

const action = 'lm-btn phone:min-h-touch'
const iconAction = 'lm-btn lm-btn--ghost lm-btn--icon phone:size-touch'
</script>

<template>
  <li class="lm-panel flex gap-4 p-3 phone:flex-col phone:gap-3" :aria-labelledby="`${rowId}-name`">
    <div class="flex min-w-0 flex-1 gap-3">
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
