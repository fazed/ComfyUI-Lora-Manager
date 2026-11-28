<script setup lang="ts">
/**
 * Batch import (classic BatchImportManager, URL / file-path list mode): one
 * image URL or server image path per line -> POST /recipes/batch-import/start
 * -> progress polled every second -> per-item result. The backend job saves
 * every successful item as a recipe; Cancel stops the remaining items.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import ModalShell from './ModalShell.vue'
import { recipesApi } from '@/api/recipes'
import type { BatchImportProgress } from '@/api/types'
import { createPoller } from '@/composables/usePolling'
import { parseBatchImportInput, parseTagInput } from '@/utils/recipes'
import { t } from '@/i18n'

const emit = defineEmits<{ close: []; imported: [] }>()

const text = ref('')
const tagText = ref('')
const skipNoMetadata = ref(true)
const operationId = ref<string | null>(null)
const progress = ref<BatchImportProgress | null>(null)
const error = ref<string | null>(null)
const starting = ref(false)

const parsed = computed(() => parseBatchImportInput(text.value))
const finished = computed(() => !!progress.value && ['completed', 'cancelled'].includes(progress.value.status))
const running = computed(() => !!operationId.value && !finished.value)
const percent = computed(() => {
  const value = progress.value
  if (!value || !value.total) return 0
  return Math.round((value.completed / value.total) * 100)
})

const poller = createPoller(async () => {
  if (!operationId.value) return
  try {
    progress.value = await recipesApi.batchImportProgress(operationId.value)
  } catch (err) {
    error.value = (err as Error).message
  }
  if (finished.value) {
    poller.stop()
    if ((progress.value?.success ?? 0) > 0) emit('imported')
  }
}, 1000)
onBeforeUnmount(() => poller.stop())

async function start(): Promise<void> {
  if (!parsed.value.items.length || starting.value) return
  starting.value = true
  error.value = null
  try {
    operationId.value = await recipesApi.batchImportStart(parsed.value.items, parseTagInput(tagText.value), skipNoMetadata.value)
    progress.value = { total: parsed.value.items.length, completed: 0, success: 0, failed: 0, skipped: 0, status: 'pending' }
    poller.start()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    starting.value = false
  }
}

async function cancel(): Promise<void> {
  if (!operationId.value) return
  try {
    await recipesApi.batchImportCancel(operationId.value)
  } catch (err) {
    error.value = (err as Error).message
  }
}

const STATUS_CLASS: Record<string, string> = {
  success: 'lm-badge lm-badge--success',
  failed: 'lm-badge lm-badge--danger',
  skipped: 'lm-badge lm-badge--warning',
  processing: 'lm-badge lm-badge--accent',
}
</script>

<template>
  <ModalShell :title="t('recipes.batch.title')" title-id="recipe-batch-title" :busy="starting" wide @close="emit('close')">
    <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
      <template v-if="!operationId">
        <div class="flex flex-col gap-1">
          <label class="lm-label" for="recipe-batch-input">{{ t('recipes.batch.label') }}</label>
          <textarea id="recipe-batch-input" v-model="text" class="lm-textarea min-h-[160px] font-mono text-xs" spellcheck="false" :placeholder="t('recipes.batch.placeholder')"></textarea>
          <p class="lm-hint" aria-live="polite">
            {{ t('recipes.batch.preview', { count: parsed.items.length, invalid: parsed.invalid.length, duplicates: parsed.duplicates }) }}
          </p>
          <ul v-if="parsed.invalid.length" class="lm-error-text text-xs">
            <li v-for="line in parsed.invalid.slice(0, 5)" :key="line" class="wrap-anywhere">{{ t('recipes.batch.invalid', { line }) }}</li>
          </ul>
        </div>
        <div class="flex flex-col gap-1">
          <label class="lm-label" for="recipe-batch-tags">{{ t('recipes.import.tags') }}</label>
          <input id="recipe-batch-tags" v-model="tagText" class="lm-input" autocomplete="off" :placeholder="t('recipes.import.tagsPlaceholder')" />
        </div>
        <label class="flex items-center gap-2 text-sm"><input v-model="skipNoMetadata" class="lm-check" type="checkbox" />{{ t('recipes.batch.skipNoMetadata') }}</label>
        <p class="lm-hint">{{ t('recipes.batch.hint') }}</p>
        <p class="lm-error-text" role="alert">{{ error ?? '' }}</p>
        <div class="lm-dialog-footer">
          <button type="button" class="lm-btn" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button type="button" class="lm-btn lm-btn--primary" :disabled="!parsed.items.length || starting" @click="start">
            <AppIcon name="download" :size="16" />{{ t('recipes.batch.start', { count: parsed.items.length }) }}
          </button>
        </div>
      </template>

      <template v-else-if="progress">
        <div class="flex flex-col gap-2" aria-live="polite">
          <p class="text-sm">
            {{ t('recipes.batch.progress', { done: progress.completed, total: progress.total, success: progress.success, failed: progress.failed, skipped: progress.skipped }) }}
          </p>
          <div class="h-[8px] overflow-hidden rounded-pill bg-sunken" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
            <div class="h-full bg-accent transition-[width]" :style="{ width: `${percent}%` }"></div>
          </div>
          <p v-if="running && progress.current_item" class="truncate text-xs text-muted">{{ progress.current_item }}</p>
          <p v-if="finished" class="font-medium">{{ t(progress.status === 'cancelled' ? 'recipes.batch.status.cancelled' : 'recipes.batch.status.completed') }}</p>
        </div>
        <ul v-if="progress.items?.length" class="flex max-h-[min(320px,45vh)] flex-col gap-1 overflow-y-auto">
          <li v-for="item in progress.items" :key="item.id ?? item.source" class="flex items-center gap-2 rounded-md hairline border-border p-2 text-sm">
            <span class="min-w-0 flex-1 truncate font-mono text-xs" :title="item.source">{{ item.recipe_name || item.source }}</span>
            <span v-if="item.error_message" class="max-w-[40%] truncate text-xs text-danger" :title="item.error_message">{{ item.error_message }}</span>
            <span :class="STATUS_CLASS[item.status] ?? 'lm-badge'">{{ item.status }}</span>
          </li>
        </ul>
        <p class="lm-error-text" role="alert">{{ error ?? '' }}</p>
        <div class="lm-dialog-footer">
          <button v-if="running" type="button" class="lm-btn lm-btn--danger" @click="cancel">{{ t('recipes.batch.cancel') }}</button>
          <button type="button" class="lm-btn" @click="emit('close')">{{ running ? t('recipes.batch.hide') : t('common.close') }}</button>
        </div>
      </template>
    </div>
  </ModalShell>
</template>
