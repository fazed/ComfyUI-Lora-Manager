<script setup lang="ts">
/**
 * Horizontally scrolling base-model chips under the library toolbar.
 * Pure view: the selection lives in useLibraryFilters (state.baseModels), the
 * same list the filter panel and the active-filter chips use.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import type { CountEntry } from '@/api/types'
import { buildBaseModelChips, QUICK_FILTER_LIMIT } from '@/utils/baseModelChips'
import { t } from '@/i18n'

const props = withDefaults(defineProps<{ entries: CountEntry[]; selected: string[]; limit?: number; idPrefix?: string }>(), {
  limit: QUICK_FILTER_LIMIT,
  idPrefix: 'quick',
})
const emit = defineEmits<{ toggle: [name: string]; clear: [] }>()

const row = computed(() => buildBaseModelChips(props.entries, props.selected, props.limit))
const moreOpen = ref(false)
const moreButton = ref<HTMLButtonElement | null>(null)
const popover = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const popoverId = computed(() => `${props.idPrefix}-base-more`)

const chipClass = 'lm-chip h-[28px] flex-none px-3 text-sm'

function label(name: string, count?: number): string {
  return count === undefined ? name : t('library.quickCount', { name, count: count.toLocaleString() })
}

function closeMore(focusButton = false): void {
  moreOpen.value = false
  if (focusButton) moreButton.value?.focus()
}

function pickOverflow(name: string): void {
  emit('toggle', name)
  closeMore(true)
}

function onDocumentPointer(event: PointerEvent): void {
  const target = event.target as Node | null
  if (target && (popover.value?.contains(target) || moreButton.value?.contains(target))) return
  closeMore()
}

function onPopoverKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    closeMore(true)
  }
}

watch(moreOpen, async (open) => {
  if (open) {
    document.addEventListener('pointerdown', onDocumentPointer)
    await nextTick()
    popover.value?.querySelector<HTMLElement>('button')?.focus()
  } else {
    document.removeEventListener('pointerdown', onDocumentPointer)
  }
})

watch(
  () => row.value.overflow.length,
  (count) => {
    if (!count) closeMore()
  },
)

// A base model picked from "More" (or the filter panel) joins the end of the row: scroll it into view.
watch(
  () => [...props.selected],
  async (next, previous) => {
    const added = next.find((name) => !previous?.includes(name))
    if (!added) return
    await nextTick()
    const chip = [...(scroller.value?.querySelectorAll<HTMLElement>('[data-base-model]') ?? [])].find(
      (element) => element.dataset.baseModel === added,
    )
    chip?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  },
)

onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer))
</script>

<template>
  <div v-if="row.visible.length || row.overflow.length" class="flex items-center gap-2 px-6 pb-3 phone:px-3">
    <div
      ref="scroller"
      class="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-[2px] [scrollbar-width:thin]"
      role="group"
      :aria-label="t('library.quickFilter')"
    >
      <button
        type="button"
        :class="[chipClass, !selected.length && 'lm-chip--active']"
        :aria-pressed="!selected.length"
        @click="emit('clear')"
      >
        {{ t('library.quickAll') }}
      </button>
      <button
        v-for="chip in row.visible"
        :key="chip.name"
        type="button"
        :data-base-model="chip.name"
        :class="[chipClass, chip.selected && 'lm-chip--active']"
        :aria-pressed="chip.selected"
        :aria-label="label(chip.name, chip.count)"
        @click="emit('toggle', chip.name)"
      >
        <span>{{ chip.name }}</span>
        <span v-if="chip.count !== undefined" class="tabular-nums" :class="chip.selected ? '' : 'text-muted'">{{ chip.count }}</span>
      </button>
    </div>
    <div v-if="row.overflow.length" class="relative flex-none">
      <button
        ref="moreButton"
        type="button"
        :class="chipClass"
        :aria-expanded="moreOpen"
        :aria-controls="popoverId"
        :aria-label="t('library.quickMoreLabel', { count: row.overflow.length })"
        @click="moreOpen = !moreOpen"
      >
        {{ t('library.quickMore') }}
        <span class="text-muted tabular-nums">{{ row.overflow.length }}</span>
        <AppIcon name="chevronDown" :size="14" />
      </button>
      <div
        v-if="moreOpen"
        :id="popoverId"
        ref="popover"
        class="absolute top-full right-0 z-30 mt-1 flex max-h-[min(320px,60vh)] w-[min(260px,calc(100vw-var(--lm-space-6)))] flex-col gap-px overflow-y-auto rounded-md hairline border-border bg-elevated p-1 shadow-md"
        role="group"
        :aria-label="t('library.quickMoreLabel', { count: row.overflow.length })"
        @keydown="onPopoverKey"
      >
        <button
          v-for="chip in row.overflow"
          :key="chip.name"
          type="button"
          class="lm-row flex min-h-control-sm cursor-pointer items-center justify-between gap-3 px-2 text-left text-sm"
          :aria-pressed="false"
          :aria-label="label(chip.name, chip.count)"
          @click="pickOverflow(chip.name)"
        >
          <span class="wrap-anywhere">{{ chip.name }}</span>
          <span class="text-xs text-muted tabular-nums">{{ chip.count }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
