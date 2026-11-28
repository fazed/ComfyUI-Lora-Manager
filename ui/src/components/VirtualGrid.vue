<script setup lang="ts" generic="T">
/**
 * Windowed card grid or row list: only the rows inside (or near) the viewport
 * are rendered. Grid: card aspect ratio and gap come from --lm-card-aspect and
 * --lm-card-gap. List (`layout="list"`): one full-width column of
 * --lm-row-height rows, --lm-row-gap apart. The tokens live in base.css /
 * density; built-in themes do not override them, user themes may. The maths is
 * shared with the skeleton (utils/gridLayout.ts).
 *
 * Keyboard: one tab stop (`v-model:active-key`, useGridKeyboard.ts). The slot
 * gets `tabbable` for the active item, or for the first item in view while the
 * active one is not rendered; items mark their main button `data-grid-primary`.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useEventListener, useMutationObserver, useResizeObserver } from '@vueuse/core'
import { useGridKeyboard } from '@/composables/useGridKeyboard'
import { scrollTopToReveal } from '@/utils/drawerNav'
import { anchorAt, gridMetrics, parseLength, rowTop, type GridLayout, type LayoutTokens, type VirtualGridExposed } from '@/utils/gridLayout'
import { t } from '@/i18n'

const props = withDefaults(
  defineProps<{
    items: T[]
    itemKey: (item: T) => string
    minItemWidth: number
    /** Card grid (default) or one-column row list. */
    layout?: GridLayout
    /** Extra rows rendered above/below the viewport. */
    overscan?: number
    label?: string
    /** Loading: render placeholder cells with the real columns, gap and aspect instead of items. */
    skeleton?: boolean
    /** Status text read while the skeleton shows (default "Loading…"). */
    skeletonLabel?: string
    /** Card image width / height; default --lm-card-aspect (the View popover's Portrait). */
    aspect?: number
    /** Grid: height of the text under each card image in px at the 16px root (scaled with the text size, like minItemWidth). */
    extraHeight?: number
  }>(),
  { layout: 'grid', overscan: 2, label: '', skeleton: false, extraHeight: 0 },
)

const emit = defineEmits<{ 'reach-end': [] }>()
/** Key of the item that holds the grid's tab stop (keyboard cursor; the page's quick view follows it). */
const activeKey = defineModel<string | null>('activeKey', { default: null })
defineSlots<{ default(props: { item: T; index: number; tabbable: boolean }): unknown; footer?(): unknown }>()

const scroller = ref<HTMLElement | null>(null)
const width = ref(0)
const viewportHeight = ref(0)
const scrollTop = ref(0)
const tokens = ref<LayoutTokens>({ aspect: 2 / 3, cardGap: 14, rowHeight: 56, rowGap: 6 })
// Root font size in px: the rem tokens and the card-size slider follow the text-size setting.
const remPx = ref(16)

/** Parse "2 / 3", "0.75" or "16/9" into width/height. */
function parseAspect(value: string): number | null {
  const parts = value.split('/').map((part) => Number.parseFloat(part.trim()))
  const ratio = parts.length === 2 ? parts[0] / parts[1] : parts[0]
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null
}

function readTokens(): void {
  const style = getComputedStyle(scroller.value ?? document.documentElement)
  remPx.value = parseLength(getComputedStyle(document.documentElement).fontSize, 16)
  tokens.value = {
    aspect: parseAspect(style.getPropertyValue('--lm-card-aspect')) ?? 2 / 3,
    cardGap: parseLength(style.getPropertyValue('--lm-card-gap'), 14, remPx.value),
    rowHeight: parseLength(style.getPropertyValue('--lm-row-height'), 56, remPx.value),
    rowGap: parseLength(style.getPropertyValue('--lm-row-gap'), 6, remPx.value),
  }
}

// On phone widths the card grid always allows two columns, whatever the card-size slider says.
const metrics = computed(() =>
  gridMetrics(
    props.layout,
    width.value,
    (props.minItemWidth * remPx.value) / 16,
    props.aspect ? { ...tokens.value, aspect: props.aspect } : tokens.value,
    (props.extraHeight * remPx.value) / 16,
  ),
)
const columns = computed(() => metrics.value.columns)
const itemHeight = computed(() => metrics.value.itemHeight)
const rowHeight = computed(() => itemHeight.value + metrics.value.gap)
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
// The tab stop: the active item while it is rendered, otherwise the first item of the top visible row.
const tabKey = computed(() => {
  const entries = visible.value
  if (entries.some((entry) => props.itemKey(entry.item) === activeKey.value)) return activeKey.value
  const first = Math.min(props.items.length - 1, Math.ceil(scrollTop.value / rowHeight.value) * columns.value)
  return first >= 0 ? props.itemKey(props.items[first]) : null
})
const totalHeight = computed(() => Math.max(0, rowCount.value * rowHeight.value - metrics.value.gap))
const gapClass = computed(() => (props.layout === 'list' ? 'gap-[var(--lm-row-gap)]' : 'gap-card'))
const trackStyle = computed(() => ({ gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`, gridAutoRows: `${itemHeight.value}px` }))

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
// Theme / density / text-size switches change the card tokens.
useMutationObserver(document.documentElement, remeasure, {
  attributes: true,
  attributeFilter: ['data-theme', 'data-density', 'data-scale', 'style'],
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

// Switching grid <-> list, the card shape or the text under the cards keeps the first visible item at the top
// instead of jumping to an unrelated pixel offset.
watch([metrics, () => [props.layout, props.aspect, props.extraHeight].join()], async ([next, view], [prev, prevView]) => {
  const el = scroller.value
  if (!el || view === prevView || !prev) return
  const firstIndex = Math.floor(el.scrollTop / (prev.itemHeight + prev.gap)) * prev.columns
  await nextTick()
  scrollTo(rowTop(firstIndex, next))
})

/** Scroll back to the top (after filters change). */
function scrollToTop(): void {
  if (scroller.value) scroller.value.scrollTop = 0
  scrollTop.value = 0
}

/** Scroll the row of an item into view with the least movement (drawer prev/next). */
function scrollToIndex(index: number): void {
  const el = scroller.value
  if (!el || index < 0) return
  const next = scrollTopToReveal(rowTop(index, metrics.value), itemHeight.value, el.scrollTop, el.clientHeight)
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

/** Refresh: remember the top visible item, then put it back at the same spot after the items were replaced. */
const anchor = () => anchorAt(scroller.value?.scrollTop ?? 0, metrics.value)

function scrollToAnchor(index: number, offset: number): void {
  scrollTo(rowTop(index, metrics.value) + offset)
}

const keyboard = useGridKeyboard({
  root: scroller,
  keys: () => props.items.map(props.itemKey),
  shape: () => ({ columns: columns.value, pageRows: Math.max(1, Math.floor(viewportHeight.value / rowHeight.value)) }),
  activeKey,
  scrollToIndex,
})

/** Placeholder cells that fill the viewport at the real column count. */
const skeletonCount = computed(() => columns.value * (Math.ceil(viewportHeight.value / rowHeight.value) + 1))

defineExpose<VirtualGridExposed>({ scrollToTop, scrollToIndex, scrollTo, scrollOffset, anchor, scrollToAnchor })
</script>

<template>
  <div
    ref="scroller"
    class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-6 pb-6 phone:px-3 phone:pb-4"
    :aria-label="label || undefined"
    :aria-busy="skeleton || undefined"
    role="region"
    @scroll.passive="onScroll"
    @keydown="keyboard.onKeydown"
    @focusin="keyboard.onFocusin"
  >
    <template v-if="skeleton">
      <p class="sr-only" role="status">{{ skeletonLabel || t('common.loading') }}</p>
      <div class="grid" :class="gapClass" aria-hidden="true" :style="trackStyle">
        <div v-for="n in skeletonCount" :key="n" class="lm-skeleton rounded-md"></div>
      </div>
    </template>
    <div v-else class="relative" :style="{ height: `${totalHeight}px` }">
      <div
        class="absolute inset-x-0 top-0 grid"
        :class="gapClass"
        role="list"
        :style="{ ...trackStyle, transform: `translateY(${startRow * rowHeight}px)` }"
      >
        <div v-for="entry in visible" :key="itemKey(entry.item)" class="min-w-0" role="listitem" :data-grid-key="itemKey(entry.item)">
          <slot :item="entry.item" :index="entry.index" :tabbable="itemKey(entry.item) === tabKey" />
        </div>
      </div>
    </div>
    <slot name="footer" />
  </div>
</template>
