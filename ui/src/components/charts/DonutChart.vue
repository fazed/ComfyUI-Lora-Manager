<script setup lang="ts">
/** Dependency-free SVG donut with a legend; colors from the series tokens. */
import type { Slice } from '@/utils/stats'
import { seriesBg, seriesFill } from './chartClasses'

withDefaults(defineProps<{ slices: Slice[]; centerValue?: string; centerLabel?: string; format?: (value: number) => string }>(), {
  centerValue: '',
  centerLabel: '',
  format: (value: number) => value.toLocaleString(),
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-4">
    <svg viewBox="0 0 160 160" class="size-[10rem] flex-none" aria-hidden="true">
      <circle cx="80" cy="80" r="66" class="fill-none stroke-sunken" stroke-width="28" />
      <path v-for="slice in slices" :key="slice.label" :d="slice.path" :class="seriesFill(slice.series)" class="stroke-surface" stroke-width="1">
        <title>{{ slice.label }}: {{ format(slice.value) }} ({{ slice.percent }}%)</title>
      </path>
      <text v-if="centerValue" x="80" y="80" text-anchor="middle" class="fill-fg text-lg font-bold">{{ centerValue }}</text>
      <text v-if="centerLabel" x="80" y="98" text-anchor="middle" class="fill-muted text-xs">{{ centerLabel }}</text>
    </svg>
    <ul class="flex min-w-[8.75rem] flex-1 flex-col gap-1 text-sm">
      <li v-for="slice in slices" :key="slice.label" class="flex items-center gap-2">
        <span class="size-[0.625rem] flex-none rounded-sm" :class="seriesBg(slice.series)" aria-hidden="true"></span>
        <span class="min-w-0 flex-1 truncate" :title="slice.label">{{ slice.label }}</span>
        <span class="tabular-nums text-muted">{{ format(slice.value) }} · {{ slice.percent }}%</span>
      </li>
    </ul>
  </div>
</template>
