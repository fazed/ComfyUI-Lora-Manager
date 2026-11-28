<script setup lang="ts">
/**
 * "Search in" next to the library search box: which fields the text search
 * looks in (file name, model name, tags, creator, trigger words) and whether
 * a selected folder includes its subfolders. Native checkboxes in a Popover;
 * the choices are remembered per library (useLibraryFilters).
 */
import AppIcon from './AppIcon.vue'
import { SEARCH_FIELDS, type SearchField, type SearchIn } from '@/api/endpoints'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { t, type MessageKey } from '@/i18n'

const searchIn = defineModel<SearchIn>('searchIn', { required: true })
const recursive = defineModel<boolean>('recursive', { required: true })

const LABELS: Record<SearchField, MessageKey> = {
  filename: 'search.in.filename',
  modelname: 'search.in.modelname',
  tags: 'search.in.tags',
  creator: 'search.in.creator',
  triggerWords: 'search.in.triggerWords',
}

function set(field: SearchField, value: boolean): void {
  searchIn.value = { ...searchIn.value, [field]: value }
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button type="button" class="lm-btn lm-btn--icon flex-none" :aria-label="t('search.options')" :title="t('search.options')">
        <AppIcon name="sliders" :size="16" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-[15rem] p-2" :aria-label="t('search.options')">
      <fieldset class="grid">
        <legend class="lm-label px-2 pb-1">{{ t('search.options') }}</legend>
        <label v-for="field in SEARCH_FIELDS" :key="field" class="lm-check lm-row min-h-control-sm px-2">
          <input type="checkbox" :checked="searchIn[field]" @change="set(field, ($event.target as HTMLInputElement).checked)" />
          {{ t(LABELS[field]) }}
        </label>
      </fieldset>
      <label class="lm-check lm-row mt-1 min-h-control-sm hairline-t border-border px-2 pt-1">
        <input v-model="recursive" type="checkbox" />
        {{ t('folders.includeSubfolders') }}
      </label>
    </PopoverContent>
  </Popover>
</template>
