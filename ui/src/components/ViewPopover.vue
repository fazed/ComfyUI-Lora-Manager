<script setup lang="ts">
/**
 * View options of a browse page in a Popover: layout (grid / list, where the
 * page offers it), and for the grid the card size, shape (Portrait / Square),
 * image fit (Fill / Whole image) and "Show on cards" (model libraries); the
 * base-model chip row (decision D2: off by default) and Reset view. Stored
 * per library next to the sort (useLibraryFilters). "Original" shape and
 * "Group by" need backend work and are not offered (D5).
 */
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  CARD_SHOW_FIELDS,
  CARD_SIZE_DEFAULT,
  CARD_SIZE_MAX,
  CARD_SIZE_MIN,
  DEFAULT_CARD_SHOW,
  type CardFit,
  type CardShape,
  type CardShow,
  type ViewMode,
} from '@/composables/useLibraryFilters'
import { t, type MessageKey } from '@/i18n'

const props = defineProps<{ idPrefix: string; viewToggle: boolean; quickRowOption: boolean }>()
const view = defineModel<ViewMode>('view', { required: true })
const cardSize = defineModel<number>('cardSize', { required: true })
const quickRow = defineModel<boolean>('quickRow', { required: true })
const shape = defineModel<CardShape>('shape', { required: true })
const fit = defineModel<CardFit>('fit', { required: true })
/** Absent: the page's cards have no optional lines (recipes). */
const show = defineModel<CardShow | undefined>('show')

const LAYOUTS: { mode: ViewMode; icon: IconName; label: MessageKey }[] = [
  { mode: 'grid', icon: 'grid', label: 'library.view.grid' },
  { mode: 'list', icon: 'list', label: 'library.view.list' },
]
const SHAPES: { value: CardShape; label: MessageKey }[] = [
  { value: 'portrait', label: 'view.shape.portrait' },
  { value: 'square', label: 'view.shape.square' },
]
const FITS: { value: CardFit; label: MessageKey }[] = [
  { value: 'cover', label: 'view.fit.cover' },
  { value: 'contain', label: 'view.fit.contain' },
]
const segment =
  'flex cursor-pointer items-center justify-center gap-2 rounded-sm px-2 py-1 text-sm text-muted peer-checked:bg-surface peer-checked:text-fg peer-checked:shadow-sm peer-focus-visible:focus-ring'

function toggleShow(field: keyof CardShow): void {
  if (show.value) show.value = { ...show.value, [field]: !show.value[field] }
}

function reset(): void {
  view.value = 'grid'
  cardSize.value = CARD_SIZE_DEFAULT
  quickRow.value = false
  shape.value = 'portrait'
  fit.value = 'cover'
  if (show.value) show.value = { ...DEFAULT_CARD_SHOW }
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button type="button" class="lm-btn flex-none">
        <AppIcon :name="view === 'list' ? 'list' : 'grid'" :size="16" /><span class="max-[1279px]:sr-only">{{ t('library.view') }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" class="grid max-h-[calc(100vh-6rem)] w-[18rem] gap-4 overflow-y-auto" :aria-label="t('library.view')">
      <fieldset v-if="viewToggle" class="min-w-0">
        <legend class="lm-label">{{ t('view.layout') }}</legend>
        <div class="flex rounded-sm bg-sunken p-[2px]">
          <label v-for="entry in LAYOUTS" :key="entry.mode" class="flex-1">
            <input v-model="view" type="radio" :name="`${props.idPrefix}-layout`" :value="entry.mode" class="peer sr-only" />
            <span :class="segment"><AppIcon :name="entry.icon" :size="16" />{{ t(entry.label) }}</span>
          </label>
        </div>
      </fieldset>
      <template v-if="view !== 'list'">
        <label class="grid gap-1">
          <span class="lm-label">{{ t('library.cardSize') }}</span>
          <input v-model.number="cardSize" class="w-full accent-accent" type="range" :min="CARD_SIZE_MIN" :max="CARD_SIZE_MAX" step="10" />
        </label>
        <fieldset class="min-w-0">
          <legend class="lm-label">{{ t('view.shape') }}</legend>
          <div class="flex rounded-sm bg-sunken p-[2px]">
            <label v-for="entry in SHAPES" :key="entry.value" class="flex-1">
              <input v-model="shape" type="radio" :name="`${props.idPrefix}-shape`" :value="entry.value" class="peer sr-only" />
              <span :class="segment">{{ t(entry.label) }}</span>
            </label>
          </div>
        </fieldset>
        <fieldset class="min-w-0">
          <legend class="lm-label">{{ t('view.fit') }}</legend>
          <div class="flex rounded-sm bg-sunken p-[2px]">
            <label v-for="entry in FITS" :key="entry.value" class="flex-1">
              <input v-model="fit" type="radio" :name="`${props.idPrefix}-fit`" :value="entry.value" class="peer sr-only" />
              <span :class="segment">{{ t(entry.label) }}</span>
            </label>
          </div>
        </fieldset>
        <fieldset v-if="show" class="grid min-w-0 gap-1">
          <legend class="lm-label">{{ t('view.show') }}</legend>
          <label v-for="field in CARD_SHOW_FIELDS" :key="field" class="lm-check">
            <input type="checkbox" :checked="show[field]" @change="toggleShow(field)" />
            {{ t(`view.show.${field}`) }}
          </label>
        </fieldset>
      </template>
      <label v-if="quickRowOption" class="lm-check">
        <input v-model="quickRow" type="checkbox" />
        {{ t('view.quickRow') }}
      </label>
      <div class="flex justify-end hairline-t border-border pt-3">
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm" @click="reset">{{ t('view.reset') }}</button>
      </div>
    </PopoverContent>
  </Popover>
</template>
