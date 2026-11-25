<script setup lang="ts">
/**
 * Bulk update bar of the Updates page: "Select all visible", the selected
 * count and total size, "Update selected", the stop-on-error option, the live
 * "x/N" progress while queueing and the result summary afterwards. Sticky at
 * the bottom of the viewport on phones (above the home indicator). The page
 * owns the selection and the run (useBulkUpdate); this component only shows
 * them and reports clicks.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import AppIcon from './AppIcon.vue'
import type { BulkResult } from '@/utils/updates'
import { t, type MessageKey } from '@/i18n'

const props = defineProps<{
  count: number
  /** Rows "Select all visible" would pick. */
  selectableCount: number
  sizeText: string
  submitting: boolean
  progress: { done: number; total: number }
  result: BulkResult | null
}>()
const stopOnHardError = defineModel<boolean>('stopOnHardError', { required: true })
const emit = defineEmits<{ selectAll: []; clear: []; submit: []; dismiss: [] }>()

const progressText = computed(() =>
  props.submitting ? t('updates.bulk.progress', { done: props.progress.done, total: props.progress.total }) : '',
)
const resultParts = computed(() => {
  const result = props.result
  if (!result) return []
  const parts: Array<{ key: string; text: string; tone: string }> = []
  if (result.added.length) parts.push({ key: 'added', text: t('updates.bulk.added', { count: result.added.length }), tone: 'text-success' })
  if (result.duplicates.length) parts.push({ key: 'dup', text: t('updates.bulk.duplicates', { count: result.duplicates.length }), tone: 'text-muted' })
  if (result.failed.length) parts.push({ key: 'failed', text: t('updates.bulk.failed', { count: result.failed.length }), tone: 'text-danger' })
  if (result.notSent.length) parts.push({ key: 'notsent', text: t('updates.bulk.notSent', { count: result.notSent.length }), tone: 'text-warning' })
  return parts
})
const stoppedText = computed(() =>
  props.result?.stopped ? t(`updates.bulk.stopped.${props.result.stopped}` as MessageKey) : '',
)
const failures = computed(() =>
  (props.result?.failed ?? []).map(({ item, message }) => ({
    key: item.key,
    text: `${item.group.modelName || ''} ${item.candidate.name || ''}: ${message}`.trim(),
  })),
)
</script>

<template>
  <div
    class="lm-panel sticky bottom-0 z-20 flex flex-col gap-2 px-3 py-2 shadow-md phone:-mx-4 phone:rounded-none phone:pb-[calc(var(--lm-space-2)+env(safe-area-inset-bottom))]"
    role="region"
    :aria-label="t('updates.bulk.toolbar')"
    data-testid="bulk-bar"
  >
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="lm-btn lm-btn--sm phone:min-h-touch"
        :disabled="submitting || !selectableCount"
        :title="t('updates.bulk.selectAllHint')"
        @click="emit('selectAll')"
      >
        <AppIcon name="checkSquare" :size="14" />{{ t('updates.bulk.selectAll') }}
      </button>
      <button v-if="count" type="button" class="lm-btn lm-btn--sm lm-btn--ghost phone:min-h-touch" :disabled="submitting" @click="emit('clear')">
        {{ t('updates.bulk.clear') }}
      </button>
      <span class="text-sm tabular-nums">
        <strong>{{ t('updates.bulk.count', { count }) }}</strong>
        <span v-if="count" class="text-muted"> · {{ sizeText }}</span>
      </span>
      <button
        type="button"
        class="lm-btn lm-btn--primary ml-auto phone:min-h-touch"
        :disabled="submitting || !count"
        :aria-busy="submitting || undefined"
        data-testid="bulk-update"
        @click="emit('submit')"
      >
        <AppIcon name="download" :size="16" />{{ t('updates.bulk.update') }}
      </button>
    </div>
    <!-- Only relevant once something is selected (keeps the bar one row high on phones otherwise). -->
    <label v-if="count || submitting" class="flex cursor-pointer items-start gap-2 text-xs text-muted phone:min-h-touch phone:items-center">
      <input v-model="stopOnHardError" type="checkbox" class="mt-px size-[14px] flex-none cursor-pointer accent-accent phone:mt-0" :disabled="submitting" />
      {{ t('updates.bulk.stopOnError') }}
    </label>

    <!-- Live progress and the result: one polite region, so screen readers hear "3/10" and the summary. -->
    <div aria-live="polite" role="status" class="text-sm" data-testid="bulk-status">
      <p v-if="submitting" class="flex items-center gap-2 tabular-nums">
        <AppIcon name="refresh" :size="14" class="animate-spinner motion-reduce:animate-none" />{{ progressText }}
      </p>
      <div v-else-if="result" class="flex flex-col gap-1">
        <p class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong>{{ t('updates.bulk.resultTitle') }}:</strong>
          <span v-for="part in resultParts" :key="part.key" :class="part.tone">{{ part.text }}</span>
          <RouterLink to="/downloads" class="text-accent underline-offset-2 hover:underline">{{ t('updates.bulk.openDownloads') }}</RouterLink>
          <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm ml-auto phone:min-h-touch" @click="emit('dismiss')">
            {{ t('updates.bulk.dismiss') }}
          </button>
        </p>
        <p v-if="stoppedText" class="text-warning">{{ stoppedText }}</p>
        <ul v-if="failures.length" class="flex flex-col gap-[2px] text-xs text-danger">
          <li v-for="failure in failures" :key="failure.key" class="wrap-anywhere">{{ failure.text }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>
