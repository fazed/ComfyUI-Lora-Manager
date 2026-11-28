<script setup lang="ts">
/**
 * Column header above the list view: the same cells and rem widths as
 * ModelRow (utils/rowColumns.ts), so the columns line up and hide at the same
 * container widths. Name, Size and Date sort the list through the existing
 * sort values (`name:*`, `size:*`, `date:*`); a second click reverses the
 * direction. Not shown on phones (rows use their two-line layout there).
 */
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { ROW_COLUMN_HIDE_CLASS } from '@/utils/rowColumns'
import { t, type MessageKey } from '@/i18n'

const props = defineProps<{ selectionMode: boolean; canSend: boolean }>()
const sort = defineModel<string>('sort', { required: true })

interface Column {
  label: MessageKey
  class: string
  /** Sort key and the direction of the first click; absent = not sortable. */
  sort?: { key: string; first: 'asc' | 'desc' }
}

const COLUMNS: Column[] = [
  { label: 'list.name', class: 'min-w-[6rem] flex-1', sort: { key: 'name', first: 'asc' } },
  { label: 'list.baseModel', class: 'w-(--lm-row-badge-max-width) min-w-0 shrink' },
  { label: 'list.size', class: 'w-[4.5rem] flex-none justify-end', sort: { key: 'size', first: 'desc' } },
  { label: 'list.date', class: `w-[9.375rem] flex-none ${ROW_COLUMN_HIDE_CLASS.date}`, sort: { key: 'date', first: 'desc' } },
  { label: 'list.tags', class: `w-[12.5rem] flex-none ${ROW_COLUMN_HIDE_CLASS.tags}` },
]

function direction(column: Column): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sort) return undefined
  const [key, dir] = sort.value.split(':')
  if (key !== column.sort.key) return 'none'
  return dir === 'asc' ? 'ascending' : 'descending'
}

function sortBy(column: Column): void {
  if (!column.sort) return
  const current = direction(column)
  const dir = current === 'none' ? column.sort.first : current === 'ascending' ? 'desc' : 'asc'
  sort.value = `${column.sort.key}:${dir}`
}

/** Width of the trailing buttons of a row: 2rem each, gap-1 between them. */
const actionsWidth = computed(() => {
  const buttons = props.canSend ? 4 : 2
  return `${buttons * 2 + (buttons - 1) * 0.25}rem`
})
</script>

<template>
  <div class="overflow-hidden px-6 [scrollbar-gutter:stable] phone:hidden">
    <div class="@container flex h-[2rem] items-center gap-3 hairline border-transparent px-2 text-xs text-muted" role="row" :aria-label="t('list.header')">
      <span v-if="selectionMode" class="w-[1.25rem] flex-none" aria-hidden="true"></span>
      <span class="w-(--lm-row-thumb) flex-none" aria-hidden="true"></span>
      <span v-for="column in COLUMNS" :key="column.label" role="columnheader" :aria-sort="direction(column)" :class="['flex min-w-0', column.class]">
        <button
          v-if="column.sort"
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--sm -mx-2"
          :aria-label="t('list.sortBy', { column: t(column.label) })"
          @click="sortBy(column)"
        >
          {{ t(column.label) }}
          <AppIcon v-if="direction(column) !== 'none'" :name="direction(column) === 'ascending' ? 'arrowUp' : 'arrowDown'" :size="12" />
        </button>
        <span v-else class="truncate">{{ t(column.label) }}</span>
      </span>
      <span class="flex-none" :style="{ width: actionsWidth }" aria-hidden="true"></span>
    </div>
  </div>
</template>
