<script setup lang="ts">
/** Size (log axis) versus usage scatter of the largest models. */
import { computed } from 'vue'
import { formatBytes } from '@/utils/format'
import { niceTicks, scatterPoints, type StorageItem } from '@/utils/stats'
import { seriesBg, seriesFill } from './chartClasses'

const props = defineProps<{ items: StorageItem[]; names: Record<string, string> }>()
const W = 600
const H = 220
const PAD = { left: 36, bottom: 24, top: 8, right: 12 }
const innerW = W - PAD.left - PAD.right
const innerH = H - PAD.top - PAD.bottom
const chart = computed(() => scatterPoints(props.items, innerW, innerH))
const yTicks = computed(() => niceTicks(chart.value.yMax))
const xTicks = computed(() => {
  const list: number[] = []
  for (let e = chart.value.xMin; e <= chart.value.xMax; e++) list.push(e)
  return list
})
const xPos = (exp: number) => ((exp - chart.value.xMin) / Math.max(1, chart.value.xMax - chart.value.xMin)) * innerW
</script>

<template>
  <div class="flex flex-col gap-2">
    <ul class="flex flex-wrap gap-3 text-xs text-muted" aria-hidden="true">
      <li v-for="(name, i) in Object.values(names)" :key="name" class="flex items-center gap-1">
        <span class="size-[10px] rounded-pill" :class="seriesBg(`series-${i + 1}`)"></span>{{ name }}
      </li>
    </ul>
    <svg :viewBox="`0 0 ${W} ${H}`" class="h-auto w-full" aria-hidden="true">
      <g :transform="`translate(${PAD.left} ${PAD.top})`">
        <g v-for="tick in yTicks" :key="`y${tick}`">
          <line x1="0" :x2="innerW" :y1="innerH - (tick / (chart.yMax || 1)) * innerH" :y2="innerH - (tick / (chart.yMax || 1)) * innerH" class="stroke-border" stroke-width="1" />
          <text x="-6" :y="innerH - (tick / (chart.yMax || 1)) * innerH + 4" text-anchor="end" class="fill-muted text-xs">{{ tick }}</text>
        </g>
        <text v-for="exp in xTicks" :key="`x${exp}`" :x="xPos(exp)" :y="innerH + 18" text-anchor="middle" class="fill-muted text-xs">{{ formatBytes(10 ** exp, 0) }}</text>
        <circle v-for="(point, i) in chart.points" :key="i" :cx="point.x" :cy="point.y" r="5" :class="seriesFill(point.series)" fill-opacity="0.8">
          <title>{{ point.item.name }}: {{ formatBytes(point.item.size) }}, {{ point.item.usageCount }} uses</title>
        </circle>
      </g>
    </svg>
  </div>
</template>
