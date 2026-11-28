<script setup lang="ts">
/**
 * Groups of the Filters flyout (and of the phone sheet): presets, base model,
 * tags (with Any / All), model type, licence (two three-way choices), then
 * the page's extra checkboxes (slot). Every option is a native checkbox or
 * radio. Pure view: the selection lives in useLibraryFilters. The tag group
 * gets a small text filter once it has more than a handful of tags.
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { FilterPreset, TagLogic, Tristate } from '@/composables/useLibraryFilters'
import { t, type MessageKey } from '@/i18n'

export type FilterField = 'baseModels' | 'tags' | 'modelTypes'
export type LicenceField = 'creditRequired' | 'allowSelling'

export interface FilterGroup {
  field: FilterField
  title: MessageKey
  entries: { name: string; count: number }[]
}

const TAG_FILTER_MIN = 8

const props = withDefaults(
  defineProps<{
    groups: FilterGroup[]
    selected: Record<FilterField, string[]> & { tagLogic: TagLogic } & Record<LicenceField, Tristate>
    idPrefix: string
    /** The list endpoint takes `tag_logic` (model libraries). */
    tagLogic?: boolean
    /** The list endpoint takes the licence flags (model libraries). */
    licence?: boolean
    /** Saved presets; absent = no presets group. */
    presets?: FilterPreset[]
  }>(),
  { tagLogic: false, licence: false, presets: undefined },
)
const emit = defineEmits<{
  toggle: [field: FilterField, name: string]
  'tag-logic': [value: TagLogic]
  licence: [field: LicenceField, value: Tristate]
  'apply-preset': [preset: FilterPreset]
  'save-preset': [name: string]
  'delete-preset': [name: string]
}>()
defineSlots<{ default?(): unknown }>()

const tagQuery = ref('')
const presetName = ref('')

const shown = computed(() =>
  props.groups.map((group) => {
    const query = tagQuery.value.trim().toLowerCase()
    const entries = group.field === 'tags' && query ? group.entries.filter((entry) => entry.name.toLowerCase().includes(query)) : group.entries
    return { ...group, entries, searchable: group.field === 'tags' && group.entries.length >= TAG_FILTER_MIN }
  }),
)

const LICENCE: { field: LicenceField; label: MessageKey }[] = [
  { field: 'creditRequired', label: 'filters.creditRequired' },
  { field: 'allowSelling', label: 'filters.sellingAllowed' },
]
const TAG_LOGICS: TagLogic[] = ['any', 'all']
const TRISTATE: { value: Tristate; label: MessageKey }[] = [
  { value: null, label: 'filters.any' },
  { value: true, label: 'filters.yes' },
  { value: false, label: 'filters.no' },
]

function savePreset(): void {
  if (!presetName.value.trim()) return
  emit('save-preset', presetName.value)
  presetName.value = ''
}

const groupClass = 'grid gap-2 hairline-b border-border pb-4 last:border-b-0 last:pb-0'
const optionClass = 'lm-check lm-row min-h-control-sm min-w-0 px-2 text-sm phone:min-h-touch'
const segment =
  'block cursor-pointer rounded-sm px-2 py-px text-center text-xs text-muted peer-checked:bg-surface peer-checked:text-fg peer-checked:shadow-sm peer-focus-visible:focus-ring'
</script>

<template>
  <div class="grid gap-4">
    <section v-if="presets" :class="groupClass" :aria-labelledby="`${idPrefix}-presets-title`">
      <h3 :id="`${idPrefix}-presets-title`" class="lm-overline">{{ t('filters.presets') }}</h3>
      <ul v-if="presets.length" class="flex flex-wrap gap-1">
        <li v-for="preset in presets" :key="preset.name" class="lm-chip gap-1 pr-1">
          <button type="button" class="cursor-pointer" :aria-label="t('filters.presetApply', { name: preset.name })" @click="emit('apply-preset', preset)">
            {{ preset.name }}
          </button>
          <button type="button" class="lm-icon-btn" :aria-label="t('filters.presetDelete', { name: preset.name })" @click="emit('delete-preset', preset.name)">
            <AppIcon name="close" :size="12" />
          </button>
        </li>
      </ul>
      <p v-else class="text-sm text-muted">{{ t('filters.presetsNone') }}</p>
      <form class="flex gap-2" @submit.prevent="savePreset">
        <input
          v-model="presetName"
          type="text"
          class="lm-input h-control-sm min-w-0 flex-1 text-sm phone:min-h-touch"
          :aria-label="t('filters.presetName')"
          :placeholder="t('filters.presetName')"
          autocomplete="off"
        />
        <button type="submit" class="lm-btn lm-btn--sm flex-none phone:min-h-touch" :disabled="!presetName.trim()">{{ t('filters.presetSave') }}</button>
      </form>
    </section>

    <section v-for="group in shown" :key="group.field" :class="groupClass">
      <div class="flex items-center justify-between gap-3">
        <h3 class="lm-overline">{{ t(group.title) }}</h3>
        <fieldset v-if="group.field === 'tags' && tagLogic" class="flex rounded-sm bg-sunken p-[2px]">
          <legend class="sr-only">{{ t('filters.tagLogic') }}</legend>
          <label v-for="value in TAG_LOGICS" :key="value">
            <input
              type="radio"
              class="peer sr-only"
              :name="`${idPrefix}-tag-logic`"
              :checked="selected.tagLogic === value"
              @change="emit('tag-logic', value)"
            />
            <span :class="segment">{{ t(value === 'any' ? 'filters.tagAny' : 'filters.tagAll') }}</span>
          </label>
        </fieldset>
      </div>
      <input
        v-if="group.searchable"
        :id="`${idPrefix}-tag-filter`"
        v-model="tagQuery"
        type="search"
        class="lm-input h-control-sm w-full min-w-0 text-xs phone:min-h-touch"
        :aria-label="t('library.tagFilter')"
        :placeholder="t('library.tagFilter')"
        autocomplete="off"
      />
      <div class="grid max-h-[10rem] grid-cols-2 gap-x-1 overflow-y-auto phone:max-h-[14rem]" role="group" :aria-label="t(group.title)">
        <label v-for="entry in group.entries" :key="entry.name" :class="optionClass">
          <input type="checkbox" :checked="selected[group.field].includes(entry.name)" @change="emit('toggle', group.field, entry.name)" />
          <span class="min-w-0 flex-1 truncate" :title="entry.name">{{ entry.name }}</span>
          <span class="text-xs text-muted tabular-nums">{{ entry.count }}</span>
        </label>
      </div>
      <p v-if="!group.entries.length" class="text-sm text-muted">{{ group.searchable ? t('library.tagFilterNone') : t('common.none') }}</p>
    </section>

    <section v-if="licence" :class="groupClass">
      <h3 class="lm-overline">{{ t('filters.licence') }}</h3>
      <fieldset v-for="row in LICENCE" :key="row.field" class="flex items-center justify-between gap-3 px-2">
        <legend class="float-left text-sm">{{ t(row.label) }}</legend>
        <div class="flex rounded-sm bg-sunken p-[2px]">
          <label v-for="option in TRISTATE" :key="String(option.value)">
            <input
              type="radio"
              class="peer sr-only"
              :name="`${idPrefix}-${row.field}`"
              :checked="selected[row.field] === option.value"
              @change="emit('licence', row.field, option.value)"
            />
            <span :class="segment">{{ t(option.label) }}</span>
          </label>
        </div>
      </fieldset>
    </section>

    <div class="flex flex-wrap gap-4 [&_label]:inline-flex [&_label]:items-center [&_label]:gap-2 phone:[&_label]:min-h-touch">
      <slot />
    </div>
  </div>
</template>
