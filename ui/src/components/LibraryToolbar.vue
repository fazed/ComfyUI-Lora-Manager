<script setup lang="ts">
/**
 * Chrome above a card grid, shared by the model libraries and the recipes:
 * title and count, search, sort, filters, folders, selection and one Tools
 * menu, then the quick-filter row, the filter panel and the active-filter
 * chips. In selection mode the page's selection bar replaces the toolbar row
 * at the same height.
 *
 * Layout: one fixed 68px row from 901px up (search shrinks instead of
 * wrapping), search drops to its own row at 900px and below, and on phones
 * (<= 720px) a "Filters and sort" button opens a bottom sheet holding sort,
 * folders, selection, tools and the filter groups. Bare `f` / `s` toggle the
 * filters and selection mode outside text fields, menus and dialogs.
 */
import { ref } from 'vue'
import { useEventListener, useMediaQuery } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import BottomSheet from './BottomSheet.vue'
import MenuButton, { type MenuEntry } from './MenuButton.vue'
import SearchCombobox from './SearchCombobox.vue'
import type { FilterChip } from '@/composables/useLibraryFilters'
import { CARD_SIZE_MAX, CARD_SIZE_MIN } from '@/composables/useLibraryFilters'
import type { SortOption } from '@/config/libraries'
import { LOCAL_PER_GROUP, MAX_TAGS } from '@/api/suggestSource'
import { shouldHandleShortcut } from '@/utils/browse'
import type { SuggestOption } from '@/utils/suggest'
import { t } from '@/i18n'

const props = withDefaults(
  defineProps<{
    title: string
    countText: string
    searchId: string
    searchScope: string
    searchLabel: string
    searchPlaceholder: string
    activeTags: string[]
    /** Prefix of the sort select and filter panel ids. */
    idPrefix: string
    sortOptions: SortOption[]
    foldersId: string
    foldersOpen: boolean
    /** A folder is selected while the panel is hidden: show a dot on the button. */
    folderActive: boolean
    filterCount: number
    chips: FilterChip[]
    selectionMode: boolean
    toolItems: MenuEntry[]
    /** Bare-letter shortcuts are active (off while a drawer is open). */
    shortcuts?: boolean
  }>(),
  { shortcuts: true },
)

const search = defineModel<string>('search', { required: true })
const sort = defineModel<string>('sort', { required: true })
const cardSize = defineModel<number>('cardSize', { required: true })

const emit = defineEmits<{
  commit: [value: string]
  choose: [option: SuggestOption]
  'toggle-folders': []
  'toggle-select': []
  tool: [id: string]
  'clear-filters': []
}>()

defineSlots<{
  /** Primary page action (Import on recipes). */
  leading?(): unknown
  /** Quick-filter row under the toolbar. */
  quick?(): unknown
  /** Filter panel content (inline panel, or inside the phone sheet). */
  filters?(): unknown
  selection?(): unknown
}>()

const isPhone = useMediaQuery('(max-width: 720px)')
const panelOpen = ref(false)
const sheetOpen = ref(false)
const foldersToggle = ref<HTMLButtonElement | null>(null)
const filtersId = `${props.idPrefix}-filters`

function toggleFilters(): void {
  if (isPhone.value) sheetOpen.value = !sheetOpen.value
  else panelOpen.value = !panelOpen.value
}

function fromSheet(action: () => void): void {
  sheetOpen.value = false
  action()
}

const SEARCH_PANEL = 'left-0 top-[calc(100%+var(--lm-space-1))] w-[min(420px,calc(100vw-24px))] phone:right-0 phone:w-auto'

useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  if (!props.shortcuts) return
  const overlay = !!document.querySelector('dialog[open], [role="menu"]') && !sheetOpen.value
  if (shouldHandleShortcut(event, 'f', overlay)) {
    event.preventDefault()
    toggleFilters()
  } else if (shouldHandleShortcut(event, 's', overlay || sheetOpen.value)) {
    event.preventDefault()
    emit('toggle-select')
  }
})

defineExpose({ foldersToggle })
</script>

<template>
  <!-- Selection mode: the bar takes the place of the toolbar row. -->
  <div v-if="selectionMode" class="px-6 pt-5 pb-3 phone:px-3 phone:pt-4 phone:pb-2">
    <slot name="selection" />
  </div>

  <!-- Phone: title and one button on the first row, full-width search below. -->
  <div v-else-if="isPhone" class="grid gap-2 px-3 pt-4 pb-2" role="toolbar" :aria-label="t('library.toolbar', { section: title })">
    <div class="flex items-center gap-2">
      <div class="lm-toolbar-title mr-auto min-w-0">
        <h1 class="truncate">{{ title }}</h1>
        <span class="flex-none truncate text-sm text-muted tabular-nums" aria-live="polite">{{ countText }}</span>
      </div>
      <slot name="leading" />
      <button
        type="button"
        class="lm-btn min-h-touch flex-none"
        aria-haspopup="dialog"
        :aria-label="t('library.filtersAndSort')"
        aria-keyshortcuts="F"
        @click="toggleFilters"
      >
        <AppIcon name="filter" :size="16" />{{ t('library.filters') }}
        <span v-if="filterCount" class="lm-badge lm-badge--accent">{{ filterCount }}</span>
      </button>
    </div>
    <SearchCombobox
      :id="searchId"
      v-model="search"
      :scope="searchScope"
      class="w-full"
      input-class="min-h-touch"
      :label="searchLabel"
      :placeholder="searchPlaceholder"
      :max-per-group="LOCAL_PER_GROUP"
      :max-tags="MAX_TAGS"
      :active-tags="activeTags"
      :panel-class="SEARCH_PANEL"
      @commit="emit('commit', $event)"
      @choose="emit('choose', $event)"
    />
  </div>

  <!-- Desktop / tablet. -->
  <div
    v-else
    class="flex flex-wrap items-center gap-2 px-6 pt-5 pb-3 min-[901px]:flex-nowrap"
    role="toolbar"
    :aria-label="t('library.toolbar', { section: title })"
  >
    <div class="lm-toolbar-title mr-auto min-w-0 shrink">
      <h1 class="min-w-0 truncate">{{ title }}</h1>
      <span class="min-w-0 truncate text-sm text-muted tabular-nums" aria-live="polite">{{ countText }}</span>
    </div>
    <slot name="leading" />
    <SearchCombobox
      :id="searchId"
      v-model="search"
      :scope="searchScope"
      class="w-[320px] min-w-[120px] shrink max-[900px]:order-last max-[900px]:w-full"
      :label="searchLabel"
      :placeholder="searchPlaceholder"
      :max-per-group="LOCAL_PER_GROUP"
      :max-tags="MAX_TAGS"
      :active-tags="activeTags"
      :panel-class="SEARCH_PANEL"
      @commit="emit('commit', $event)"
      @choose="emit('choose', $event)"
    />
    <label class="sr-only" :for="`sort-${idPrefix}`">{{ t('library.sort') }}</label>
    <select :id="`sort-${idPrefix}`" v-model="sort" class="lm-select w-auto min-w-[130px] flex-none">
      <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ t(option.label) }}</option>
    </select>
    <button
      type="button"
      class="lm-btn flex-none"
      :aria-expanded="panelOpen"
      :aria-controls="panelOpen ? filtersId : undefined"
      aria-keyshortcuts="F"
      :title="`${t('library.filters')} (F)`"
      @click="toggleFilters"
    >
      <AppIcon name="filter" :size="16" />{{ t('library.filters') }}
      <span v-if="filterCount" class="lm-badge lm-badge--accent">{{ filterCount }}</span>
    </button>
    <label class="hidden flex-none items-center gap-2 px-1 text-muted min-[1280px]:inline-flex">
      <span class="sr-only">{{ t('library.cardSize') }}</span>
      <AppIcon name="grid" :size="16" />
      <input v-model.number="cardSize" class="w-[96px] accent-accent" type="range" :min="CARD_SIZE_MIN" :max="CARD_SIZE_MAX" step="10" :aria-label="t('library.cardSize')" />
    </label>
    <button
      ref="foldersToggle"
      type="button"
      class="lm-btn flex-none"
      :class="{ 'lm-chip--active': foldersOpen }"
      :aria-expanded="foldersOpen"
      :aria-controls="foldersId"
      :title="t(foldersOpen ? 'library.hideFolders' : 'library.showFolders')"
      @click="emit('toggle-folders')"
    >
      <AppIcon name="folder" :size="16" />{{ t('library.folders') }}
      <span v-if="folderActive && !foldersOpen" class="size-[6px] rounded-pill bg-accent" aria-hidden="true"></span>
    </button>
    <button
      type="button"
      class="lm-btn flex-none"
      aria-keyshortcuts="S"
      :title="`${t('library.select')} (S)`"
      @click="emit('toggle-select')"
    >
      <AppIcon name="checkSquare" :size="16" />{{ t('library.select') }}
    </button>
    <MenuButton :label="t('library.toolsMenu')" icon="wrench" align="right" :items="toolItems" @select="emit('tool', $event)" />
  </div>

  <slot name="quick" />

  <div v-if="panelOpen && !isPhone" :id="filtersId" class="lm-panel mx-6 mb-3 p-4">
    <slot name="filters" />
  </div>

  <!-- Reserved height on desktop: a chip appearing does not push the grid down. -->
  <div
    v-if="chips.length || !isPhone"
    class="flex min-h-[32px] flex-wrap items-center gap-2 px-6 pb-2 phone:min-h-0 phone:px-3"
    role="group"
    :aria-label="t('library.filters')"
  >
    <template v-if="chips.length">
      <span v-for="chip in chips" :key="chip.key" class="lm-chip lm-chip--active">
        {{ chip.label }}
        <button type="button" class="lm-icon-btn phone:min-h-touch phone:min-w-touch" :aria-label="t('library.removeFilter', { name: chip.label })" @click="chip.remove()">
          <AppIcon name="close" :size="12" />
        </button>
      </span>
      <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm phone:min-h-touch" @click="emit('clear-filters')">{{ t('library.clearFilters') }}</button>
    </template>
  </div>

  <BottomSheet v-if="sheetOpen" :title="t('library.filtersAndSort')" title-id="library-sheet-title" @close="sheetOpen = false">
    <div class="grid gap-4 pt-1 pb-2">
      <div class="grid gap-1">
        <label class="lm-label" :for="`sheet-sort-${idPrefix}`">{{ t('library.sort') }}</label>
        <select :id="`sheet-sort-${idPrefix}`" v-model="sort" class="lm-select min-h-touch w-full">
          <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ t(option.label) }}</option>
        </select>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="lm-btn min-h-touch" :aria-controls="foldersId" @click="fromSheet(() => emit('toggle-folders'))">
          <AppIcon name="folder" :size="16" />{{ t(foldersOpen ? 'library.hideFolders' : 'library.showFolders') }}
        </button>
        <button type="button" class="lm-btn min-h-touch" @click="fromSheet(() => emit('toggle-select'))">
          <AppIcon name="checkSquare" :size="16" />{{ t('library.select') }}
        </button>
      </div>
      <div v-if="toolItems.length" class="grid gap-1" role="group" :aria-label="t('library.tools')">
        <button
          v-for="entry in toolItems"
          :key="entry.id"
          type="button"
          class="lm-btn min-h-touch justify-start"
          :disabled="entry.disabled"
          @click="fromSheet(() => emit('tool', entry.id))"
        >
          <AppIcon v-if="entry.icon" :name="entry.icon" :size="16" />{{ entry.label }}
        </button>
      </div>
      <slot name="filters" />
    </div>
    <template #footer>
      <button type="button" class="lm-btn lm-btn--primary min-h-touch w-full" @click="sheetOpen = false">{{ t('library.sheetDone') }}</button>
    </template>
  </BottomSheet>
</template>
