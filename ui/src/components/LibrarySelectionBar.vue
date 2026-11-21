<script setup lang="ts">
/**
 * Selection mode bar. It replaces the toolbar row (same height, so the grid
 * does not jump); the page supplies its bulk actions in the default slot.
 */
import AppIcon from './AppIcon.vue'
import { t } from '@/i18n'

defineProps<{
  count: number
  /** Selected items that are not in the current list (filtered out or not loaded). */
  hidden: number
  hasItems: boolean
  hint: string
}>()
const emit = defineEmits<{ all: []; none: []; invert: []; done: [] }>()
defineSlots<{ default(): unknown }>()
</script>

<template>
  <div
    class="flex min-h-[36px] flex-wrap items-center gap-2 rounded-md bg-accent-soft px-3 py-1 phone:gap-1"
    role="toolbar"
    :aria-label="t('selection.toolbar', { count })"
  >
    <strong class="tabular-nums" aria-live="polite">{{ t('library.selected', { count }) }}</strong>
    <span v-if="hidden" class="text-xs text-muted tabular-nums">({{ t('selection.hidden', { count: hidden }) }})</span>
    <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="t('library.select')">
      <button type="button" class="lm-btn lm-btn--sm phone:min-h-touch" :title="hint" @click="emit('all')">{{ t('selection.all') }}</button>
      <button type="button" class="lm-btn lm-btn--sm phone:min-h-touch" :disabled="!count" @click="emit('none')">{{ t('selection.none') }}</button>
      <button type="button" class="lm-btn lm-btn--sm phone:min-h-touch" :disabled="!hasItems" @click="emit('invert')">{{ t('selection.invert') }}</button>
    </div>
    <span class="mx-1 h-[20px] hairline-l border-border-strong phone:hidden" aria-hidden="true"></span>
    <div class="flex flex-wrap items-center gap-1 phone:[&_.lm-btn]:min-h-touch">
      <slot />
    </div>
    <button type="button" class="lm-btn lm-btn--sm ml-auto phone:min-h-touch" @click="emit('done')">
      <AppIcon name="check" :size="14" />{{ t('library.selectDone') }}
    </button>
  </div>
</template>
