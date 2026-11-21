<script setup lang="ts">
/** Multi-series SVG line chart over a date axis (usage timeline). */
import { computed } from 'vue'
import { linePaths, shortDate, type TimelinePoint } from '@/utils/stats'
import { seriesBg, seriesFill, seriesStroke } from './chartClasses'

const props = defineProps<{ points: TimelinePoint[]; keys: { key: 'lora' | 'checkpoint' | 'embedding' | 'total'; name: string }[] }>()

const W = 900
const H = 220
const PAD = { left: 48, bottom: 24, top: 8, right: 8 }
const chart = computed(() => linePaths(props.points, props.keys, W - PAD.left - PAD.right, H - PAD.top - PAD.bottom))
const labelEvery = computed(() => Math.max(1, Math.ceil(props.points.length / 6)))
const innerH = H - PAD.top - PAD.bottom
</script>

<template>
  <div class="flex flex-col gap-2">
    <ul class="flex flex-wrap gap-3 text-xs text-muted" aria-hidden="true">
      <li v-for="s in chart.series" :key="s.name" class="flex items-center gap-1">
        <span class="h-[3px] w-[14px] rounded-sm" :class="seriesBg(s.series)"></span>{{ s.name }}
      </li>
    </ul>
    <svg :viewBox="`0 0 ${W} ${H}`" class="h-auto w-full" aria-hidden="true">
      <g :transform="`translate(${PAD.left} ${PAD.top})`">
        <g v-for="tick in chart.ticks" :key="tick">
          <line x1="0" :x2="W - PAD.left - PAD.right" :y1="innerH - (tick / chart.max) * innerH" :y2="innerH - (tick / chart.max) * innerH" class="stroke-border" stroke-width="1" />
          <text x="-6" :y="innerH - (tick / chart.max) * innerH + 4" text-anchor="end" class="fill-muted text-xs">{{ tick }}</text>
        </g>
        <g v-for="(point, i) in points" :key="point.date">
          <text
            v-if="i % labelEvery === 0 || i === points.length - 1"
            :x="chart.series[0]?.points[i]?.x ?? 0"
            :y="innerH + 16"
            :text-anchor="i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'"
            class="fill-muted text-xs"
          >{{ shortDate(point.date) }}</text>
        </g>
        <g v-for="s in chart.series" :key="s.name">
          <path :d="s.path" class="fill-none" :class="seriesStroke(s.series)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
          <circle v-for="(p, i) in s.points" :key="i" :cx="p.x" :cy="p.y" r="2.5" :class="seriesFill(s.series)">
            <title>{{ s.name }} {{ points[i]?.date }}: {{ p.value }}</title>
          </circle>
        </g>
      </g>
    </svg>
  </div>
</template>
