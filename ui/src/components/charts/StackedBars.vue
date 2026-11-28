<script setup lang="ts">
/** Horizontal stacked bars (CSS), one row per label, a legend on top. */
import type { StackRow } from '@/utils/stats'
import { seriesBg } from './chartClasses'

defineProps<{ rows: StackRow[] }>()
</script>

<template>
  <div class="flex flex-col gap-3">
    <ul v-if="rows.length" class="flex flex-wrap gap-3 text-xs text-muted" aria-hidden="true">
      <li v-for="segment in rows[0].segments" :key="segment.name" class="flex items-center gap-1">
        <span class="size-[0.625rem] rounded-sm" :class="seriesBg(segment.series)"></span>{{ segment.name }}
      </li>
    </ul>
    <div v-for="row in rows" :key="row.label" class="grid grid-cols-[minmax(90px,30%)_1fr_auto] items-center gap-2 text-sm phone:grid-cols-[minmax(70px,35%)_1fr_auto]">
      <span class="truncate" :title="row.label">{{ row.label }}</span>
      <div class="flex h-[0.875rem] overflow-hidden rounded-sm bg-sunken" aria-hidden="true">
        <span
          v-for="segment in row.segments"
          :key="segment.name"
          class="h-full"
          :class="seriesBg(segment.series)"
          :style="{ width: `${segment.widthPercent}%` }"
          :title="`${segment.name}: ${segment.value}`"
        ></span>
      </div>
      <span class="text-right tabular-nums text-muted">{{ row.total }}</span>
    </div>
  </div>
</template>
