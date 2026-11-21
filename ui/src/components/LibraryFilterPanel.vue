<script setup lang="ts">
/**
 * Chip groups (base models, tags) and the extra checkboxes of the filter
 * panel. Pure view: the selection lives in useLibraryFilters. The tag group
 * gets a small text filter once it has more than a handful of tags.
 */
import { computed, ref } from 'vue'
import { t, type MessageKey } from '@/i18n'

export interface FilterGroup {
  field: 'baseModels' | 'tags'
  title: MessageKey
  entries: { name: string; count: number }[]
}

const TAG_FILTER_MIN = 8

const props = defineProps<{ groups: FilterGroup[]; selected: Record<'baseModels' | 'tags', string[]>; idPrefix: string }>()
const emit = defineEmits<{ toggle: [field: 'baseModels' | 'tags', name: string] }>()
defineSlots<{ default?(): unknown }>()

const tagQuery = ref('')

const shown = computed(() =>
  props.groups.map((group) => {
    const query = tagQuery.value.trim().toLowerCase()
    const entries = group.field === 'tags' && query ? group.entries.filter((entry) => entry.name.toLowerCase().includes(query)) : group.entries
    return { ...group, entries, searchable: group.field === 'tags' && group.entries.length >= TAG_FILTER_MIN }
  }),
)
</script>

<template>
  <div class="grid gap-4">
    <div v-for="group in shown" :key="group.field">
      <div class="mb-2 flex items-center justify-between gap-3">
        <h3 class="lm-overline">{{ t(group.title) }}</h3>
        <input
          v-if="group.searchable"
          :id="`${idPrefix}-tag-filter`"
          v-model="tagQuery"
          type="search"
          class="lm-input h-control-sm w-[160px] min-w-0 text-xs phone:min-h-touch phone:w-[55%]"
          :aria-label="t('library.tagFilter')"
          :placeholder="t('library.tagFilter')"
          autocomplete="off"
        />
      </div>
      <div class="flex max-h-[120px] flex-wrap gap-1 overflow-y-auto phone:max-h-[200px]">
        <button
          v-for="entry in group.entries"
          :key="entry.name"
          type="button"
          class="lm-chip phone:min-h-touch"
          :class="{ 'lm-chip--active': selected[group.field].includes(entry.name) }"
          :aria-pressed="selected[group.field].includes(entry.name)"
          @click="emit('toggle', group.field, entry.name)"
        >
          {{ entry.name }} <span class="lm-muted">{{ entry.count }}</span>
        </button>
        <p v-if="!group.entries.length" class="text-sm text-muted">{{ group.searchable ? t('library.tagFilterNone') : t('common.none') }}</p>
      </div>
    </div>
    <div class="flex flex-wrap gap-4 [&_label]:inline-flex [&_label]:items-center [&_label]:gap-2 phone:[&_label]:min-h-touch">
      <slot />
    </div>
  </div>
</template>
