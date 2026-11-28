<script setup lang="ts">
/**
 * Panel around a chart: title, the chart (role="img" with a text summary)
 * and a "Show as table" toggle with the same data as an accessible table.
 */
import { ref } from 'vue'
import { t } from '@/i18n'

const props = withDefaults(defineProps<{ title: string; id: string; summary?: string; hint?: string; table?: boolean }>(), {
  summary: '',
  hint: '',
  table: true,
})
const showTable = ref(false)
void props
</script>

<template>
  <section class="lm-panel flex min-w-0 flex-col gap-3 p-4" :aria-labelledby="`${id}-title`">
    <header class="flex flex-wrap items-center gap-2">
      <h2 :id="`${id}-title`" class="min-w-0 flex-1 text-md">{{ title }}</h2>
      <button
        v-if="table"
        type="button"
        class="lm-btn lm-btn--ghost lm-btn--sm"
        :aria-expanded="showTable"
        :aria-controls="`${id}-table`"
        @click="showTable = !showTable"
      >
        {{ showTable ? t('stats.hideTable') : t('stats.showTable') }}
      </button>
    </header>
    <p v-if="hint" class="lm-hint -mt-2">{{ hint }}</p>
    <div role="img" :aria-label="summary || t('stats.chartOf', { title })" class="min-w-0">
      <slot />
    </div>
    <div v-if="table && showTable" :id="`${id}-table`" class="max-h-[20rem] overflow-auto">
      <slot name="table" />
    </div>
  </section>
</template>
