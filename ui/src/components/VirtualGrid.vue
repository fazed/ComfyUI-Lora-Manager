<script setup lang="ts" generic="T">
/**
 * Windowed card grid: only the rows inside (or near) the viewport are
 * rendered. Card aspect ratio and gap come from the theme tokens
 * --lm-card-aspect and --lm-card-gap (base.css / density; built-in themes
 * do not override them, user themes may).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useEventListener, useMutationObserver, useResizeObserver } from '@vueuse/core'
import { scrollTopToReveal } from '@/utils/drawerNav'
import { gridColumns } from '@/utils/gridLayout'
import { t } from '@/i18n'

const props = withDefaults(
  defineProps<{
    items: T[]
    itemKey: (item: T) => string
    minItemWidth: number
    /** Extra rows rendered above/below the viewport. */
    overscan?: number
    label?: string
    /** Loading: render placeholder cells with the real columns, gap and aspect instead of items. */
    skeleton?: boolean
  }>(),
  { overscan: 2, label: '', skeleton: false },
)

const emit = defineEmits<{ 'reach-end': [] }>()
defineSlots<{ default(props: { item: T; index: number }): unknown; footer?(): unknown }>()

const scroller = ref<HTMLElement | null>(null)
const width = ref(0)
const viewportHeight = ref(0)
const scrollTop = ref(0)
const aspect = ref(2 / 3)
const gap = ref(14)

/** Parse "2 / 3", "0.75" or "16/9" into width/height. */
function parseAspect(value: string): number | null {
  const parts = value.split('/').map((part) => Number.parseFloat(part.trim()))
  const ratio = parts.length === 2 ? parts[0] / parts[1] : parts[0]
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null
}

function readTokens(): void {
  const style = getComputedStyle(scroller.value ?? document.documentElement)
  aspect.value = parseAspect(style.getPropertyValue('--lm-card-aspect')) ?? 2 / 3
  const parsedGap = Number.parseFloat(style.getPropertyValue('--lm-card-gap'))
  gap.value = Number.isFinite(parsedGap) ? parsedGap : 14
}

// On phone widths always allow two columns, whatever the card-size slider says (utils/gridLayout.ts).
const columns = computed(() => gridColumns(width.value, gap.value, props.minItemWidth))
const itemWidth = computed(() => (width.value - gap.value * (columns.value - 1)) / columns.value)
const itemHeight = computed(() => Math.max(40, itemWidth.value / aspect.value))
const rowHeight = computed(() => itemHeight.value + gap.value)
const rowCount = computed(() => Math.ceil(props.items.length / columns.value))
const startRow = computed(() => Math.max(0, Math.floor(scrollTop.value / rowHeight.value) - props.overscan))
const endRow = computed(() =>
  Math.min(rowCount.value, Math.ceil((scrollTop.value + viewportHeight.value) / rowHeight.value) + props.overscan),
)
const visible = computed(() =>
  props.items.slice(startRow.value * columns.value, endRow.value * columns.value).map((item, offset) => ({
    item,
    index: startRow.value * columns.value + offset,
  })),
)
const totalHeight = computed(() => Math.max(0, rowCount.value * rowHeight.value - gap.value))

function onScroll(): void {
  if (scroller.value) scrollTop.value = scroller.value.scrollTop
}

function measure(): void {
  const el = scroller.value
  if (!el) return
  width.value = el.clientWidth - Number.parseFloat(getComputedStyle(el).paddingLeft) * 2
  viewportHeight.value = el.clientHeight
}

function remeasure(): void {
  readTokens()
  measure()
}

onMounted(remeasure)
useResizeObserver(scroller, measure)
// Theme / density switches change the card tokens.
useMutationObserver(document.documentElement, remeasure, {
  attributes: true,
  attributeFilter: ['data-theme', 'data-density', 'style'],
})
// A user theme's stylesheet arrives after data-theme flips: re-read the tokens once it has loaded.
useEventListener(
  document,
  'load',
  (event: Event) => {
    if ((event.target as Element | null)?.tagName === 'LINK') remeasure()
  },
  true,
)

// Ask for more data when the rendered window reaches the last rows.
watch(
  [endRow, rowCount, width],
  () => {
    if (width.value > 0 && endRow.value >= rowCount.value - props.overscan) emit('reach-end')
  },
  { immediate: false },
)

/** Scroll back to the top (after filters change). */
function scrollToTop(): void {
  if (scroller.value) scroller.value.scrollTop = 0
  scrollTop.value = 0
}

/** Scroll the row of an item into view with the least movement (drawer prev/next). */
function scrollToIndex(index: number): void {
  const el = scroller.value
  if (!el || index < 0) return
  const rowTop = Math.floor(index / columns.value) * rowHeight.value
  const next = scrollTopToReveal(rowTop, itemHeight.value, el.scrollTop, el.clientHeight)
  if (next === el.scrollTop) return
  el.scrollTop = next
  scrollTop.value = next
}

const scrollOffset = () => scroller.value?.scrollTop ?? 0

/** Restore a saved scroll position (after the list has been re-loaded). */
function scrollTo(top: number): void {
  if (!scroller.value) return
  scroller.value.scrollTop = top
  scrollTop.value = scroller.value.scrollTop
}

/** Placeholder cells that fill the viewport at the real column count. */
const skeletonCount = computed(() => columns.value * (Math.ceil(viewportHeight.value / rowHeight.value) + 1))

defineExpose({ scrollToTop, scrollToIndex, scrollTo, scrollOffset })
</script>

<template>
  <div
    ref="scroller"
    class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-6 pb-6 phone:px-3 phone:pb-4"
    :aria-label="label || undefined"
    :aria-busy="skeleton || undefined"
    role="region"
    @scroll.passive="onScroll"
  >
    <template v-if="skeleton">
      <p class="sr-only" role="status">{{ t('common.loading') }}</p>
      <div class="grid gap-card" aria-hidden="true" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: `${itemHeight}px` }">
        <div v-for="n in skeletonCount" :key="n" class="lm-skeleton rounded-md"></div>
      </div>
    </template>
    <div v-else class="relative" :style="{ height: `${totalHeight}px` }">
      <div
        class="absolute inset-x-0 top-0 grid gap-card will-change-transform"
        role="list"
        :style="{
          transform: `translateY(${startRow * rowHeight}px)`,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: `${itemHeight}px`,
        }"
      >
        <div v-for="entry in visible" :key="itemKey(entry.item)" class="min-w-0" role="listitem">
          <slot :item="entry.item" :index="entry.index" />
        </div>
      </div>
    </div>
    <slot name="footer" />
  </div>
</template>
