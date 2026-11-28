<script setup lang="ts">
/**
 * Selection mode bar: floats at the bottom of the grid section (the page's
 * `<section>` is the positioning parent) while the toolbar stays usable above
 * the grid. Count, "N not in view", All / None / Invert, the page's bulk
 * actions (default slot) and Done. The page adds bottom padding to the grid
 * while it shows, so the last row is never hidden behind it.
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
    class="absolute inset-x-0 bottom-4 z-10 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center gap-1 rounded-lg hairline border-border-strong bg-elevated py-1 pr-1 pl-4 shadow-lg phone:bottom-2 phone:max-w-[calc(100%-1rem)] phone:pl-3"
    role="toolbar"
    :aria-label="t('selection.toolbar', { count })"
    data-testid="selection-bar"
  >
    <strong class="mr-1 whitespace-nowrap tabular-nums" aria-live="polite">{{ t('library.selected', { count }) }}</strong>
    <span v-if="hidden" class="mr-1 text-xs whitespace-nowrap text-muted tabular-nums">({{ t('selection.hidden', { count: hidden }) }})</span>
    <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="t('library.select')">
      <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm phone:min-h-touch" :title="hint" @click="emit('all')">{{ t('selection.all') }}</button>
      <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm phone:min-h-touch" :disabled="!count" @click="emit('none')">{{ t('selection.none') }}</button>
      <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm phone:min-h-touch" :disabled="!hasItems" @click="emit('invert')">{{ t('selection.invert') }}</button>
    </div>
    <span class="mx-1 h-[1.25rem] hairline-l border-border-strong phone:hidden" aria-hidden="true"></span>
    <div class="flex flex-wrap items-center gap-1 phone:[&_.lm-btn]:min-h-touch">
      <slot />
    </div>
    <span class="mx-1 h-[1.25rem] hairline-l border-border-strong phone:hidden" aria-hidden="true"></span>
    <button type="button" class="lm-btn lm-btn--sm phone:min-h-touch" @click="emit('done')">
      <AppIcon name="check" :size="14" />{{ t('library.selectDone') }}
    </button>
  </div>
</template>
