<script setup lang="ts">
/**
 * Chrome above a card grid, shared by the model libraries and the recipes.
 * At most three rows: the toolbar (folders, search with "Search in", the
 * Filters flyout, then View, Sort, Select, Refresh, Tools and the page's
 * primary action), the context row (breadcrumb and alphabet bar, `context`
 * slot) and the active-view strip: the result count, every active scope and
 * filter as a removable chip and one "Clear all" (reserved height on
 * desktop). The
 * optional base-model row (`quick` slot) only shows when the page turns it
 * on in the View options. Selection mode keeps the toolbar: the page's
 * selection bar floats at the bottom of the grid (LibrarySelectionBar.vue).
 * Model libraries also bind the Quick view toggle (`v-model:quick-view`,
 * from 1280px on devices with a mouse).
 *
 * The page name is the breadcrumb root; the toolbar's h1 is for screen
 * readers, the result count sits in the breadcrumb and the status bar.
 * Phones (<= 720px) keep one row with the search and a "Filters and sort"
 * button that opens a bottom sheet holding sort, view, folders, selection,
 * tools and the filter groups. Bare `f` toggles the filters, bare `b` the
 * selection (bulk bar) and Ctrl/Cmd+F focuses the search, outside text fields,
 * menus and dialogs; `r` is handled by the app shell.
 */
import { computed, ref } from 'vue'
import { useEventListener, useMediaQuery } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import BottomSheet from './BottomSheet.vue'
import FilterFlyout from './FilterFlyout.vue'
import type { IconName } from './icons'
import MenuButton, { type MenuEntry } from './MenuButton.vue'
import RefreshButton from './RefreshButton.vue'
import SearchCombobox from './SearchCombobox.vue'
import SearchOptions from './SearchOptions.vue'
import ViewPopover from './ViewPopover.vue'
import type { SearchIn } from '@/api/endpoints'
import type { CardFit, CardShape, CardShow, FilterChip, ViewMode } from '@/composables/useLibraryFilters'
import { CARD_SIZE_MAX, CARD_SIZE_MIN } from '@/composables/useLibraryFilters'
import type { SortOption } from '@/config/libraries'
import { SHORTCUTS } from '@/config/shortcuts'
import { LOCAL_PER_GROUP, MAX_TAGS } from '@/api/suggestSource'
import { shouldHandleShortcut } from '@/utils/browse'
import { rekaLayerOpen } from '@/utils/dismiss'
import type { SuggestOption } from '@/utils/suggest'
import { t, type MessageKey } from '@/i18n'

const props = withDefaults(
  defineProps<{
    title: string
    countText: string
    searchId: string
    searchScope: string
    searchLabel: string
    searchPlaceholder: string
    activeTags: string[]
    /** Prefix of the sort, view and filter flyout ids. */
    idPrefix: string
    sortOptions: SortOption[]
    foldersId: string
    foldersOpen: boolean
    filterCount: number
    chips: FilterChip[]
    selectionMode: boolean
    toolItems: MenuEntry[]
    /** Bare-letter shortcuts are active (off while a drawer is open). */
    shortcuts?: boolean
    /** Offer the grid / list view switch (model libraries; bind `v-model:view`). */
    viewToggle?: boolean
    /** The page has a base-model chip row (`quick` slot) that the View options can turn on. */
    quickRowOption?: boolean
    /** Offer the Quick view toggle (model libraries; bind `v-model:quick-view`). */
    quickViewOption?: boolean
  }>(),
  { shortcuts: true, viewToggle: false, quickRowOption: false, quickViewOption: false },
)

const search = defineModel<string>('search', { required: true })
const sort = defineModel<string>('sort', { required: true })
const cardSize = defineModel<number>('cardSize', { required: true })
const view = defineModel<ViewMode>('view', { default: 'grid' })
const quickRow = defineModel<boolean>('quickRow', { default: false })
/** "Search in" fields (model libraries); absent = no Search in button. */
const searchIn = defineModel<SearchIn>('searchIn')
const recursive = defineModel<boolean>('recursive', { default: true })
const shape = defineModel<CardShape>('shape', { default: 'portrait' })
const fit = defineModel<CardFit>('fit', { default: 'cover' })
/** "Show on cards" (model libraries); absent = no such group in the View popover. */
const show = defineModel<CardShow>('show')
/** Quick view panel (model libraries, with `quickViewOption`). */
const quickView = defineModel<boolean>('quickView', { default: false })

const VIEW_BUTTONS: { mode: ViewMode; icon: IconName; label: MessageKey }[] = [
  { mode: 'grid', icon: 'grid', label: 'library.view.grid' },
  { mode: 'list', icon: 'list', label: 'library.view.list' },
]

const emit = defineEmits<{
  commit: [value: string]
  choose: [option: SuggestOption]
  'toggle-folders': []
  'toggle-select': []
  tool: [id: string]
  /** Every scope and filter (chips row, phone sheet). */
  'clear-filters': []
  /** The Filters flyout's groups only. */
  'clear-panel': []
}>()

defineSlots<{
  /** Primary page action (Download on model libraries, Import on recipes). */
  leading?(): unknown
  /** Optional base-model chip row under the toolbar. */
  quick?(): unknown
  /** Breadcrumb and alphabet bar (one row). */
  context?(): unknown
  /** Filter groups (Filters flyout, or inside the phone sheet). */
  filters?(): unknown
}>()

const isPhone = useMediaQuery('(max-width: 720px)')
const flyoutOpen = ref(false)
const sheetOpen = ref(false)
const foldersToggle = ref<HTMLButtonElement | null>(null)
const filtersId = `${props.idPrefix}-filters`

const sortLabel = computed(() => {
  const current = props.sortOptions.find((option) => option.value === sort.value)
  return current ? t(current.label) : t('library.sort')
})
const sortItems = computed<MenuEntry[]>(() =>
  props.sortOptions.map((option) => ({ id: option.value, label: t(option.label), checked: option.value === sort.value })),
)

function toggleFilters(): void {
  if (isPhone.value) sheetOpen.value = !sheetOpen.value
  else flyoutOpen.value = !flyoutOpen.value
}

function fromSheet(action: () => void): void {
  sheetOpen.value = false
  action()
}

const SEARCH_PANEL = 'left-0 top-[calc(100%+var(--lm-space-1))] w-[min(26.25rem,calc(100vw-1.5rem))] phone:right-0 phone:w-auto'

useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  if (!props.shortcuts) return
  // The open flyout / sheet answers its own `f` (closing it); other dialogs and menus own their keys.
  const overlay = (rekaLayerOpen() || !!document.querySelector('[role="menu"]')) && !sheetOpen.value && !flyoutOpen.value
  if (shouldHandleShortcut(event, 'f', overlay)) {
    event.preventDefault()
    toggleFilters()
  } else if (shouldHandleShortcut(event, 'b', overlay || sheetOpen.value || flyoutOpen.value)) {
    event.preventDefault()
    emit('toggle-select')
  } else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f' && !overlay && !sheetOpen.value) {
    event.preventDefault()
    document.getElementById(props.searchId)?.focus()
  }
})

defineExpose({ foldersToggle })
</script>

<template>
  <!-- Phone: one row with the search and a single "Filters and sort" button. The bottom bar names the
       library, so the title is read by screen readers only; the count shows in the chips row while filtered. -->
  <div v-if="isPhone" class="px-3 pt-3 pb-2" role="toolbar" :aria-label="t('library.toolbar', { section: title })">
    <h1 class="sr-only">{{ title }}</h1>
    <span class="sr-only" aria-live="polite">{{ countText }}</span>
    <div class="flex items-center gap-2">
      <SearchCombobox
        :id="searchId"
        v-model="search"
        :scope="searchScope"
        class="min-w-0 flex-1"
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
      <slot name="leading" />
      <button
        type="button"
        class="lm-btn min-h-touch flex-none"
        aria-haspopup="dialog"
        :aria-label="t('library.filtersAndSort')"
        :aria-keyshortcuts="SHORTCUTS.filters.aria"
        @click="toggleFilters"
      >
        <AppIcon name="filter" :size="16" />{{ t('library.filters') }}
        <span v-if="filterCount" class="lm-badge lm-badge--accent">{{ filterCount }}</span>
      </button>
    </div>
  </div>

  <!-- Desktop / tablet: one row; the search shrinks first and the row wraps when the folder panel and quick view leave little room. -->
  <div
    v-else
    class="flex flex-wrap items-center gap-2 hairline-b border-border px-4 py-3"
    role="toolbar"
    :aria-label="t('library.toolbar', { section: title })"
  >
    <h1 class="sr-only">{{ title }}</h1>
    <button
      ref="foldersToggle"
      type="button"
      class="lm-btn lm-btn--icon flex-none"
      :class="{ 'lm-chip--active': foldersOpen }"
      :aria-expanded="foldersOpen"
      :aria-controls="foldersId"
      :aria-label="t('library.folders')"
      :title="t(foldersOpen ? 'library.hideFolders' : 'library.showFolders')"
      @click="emit('toggle-folders')"
    >
      <AppIcon name="folder" :size="16" />
    </button>
    <div class="flex max-w-[34rem] min-w-[12rem] flex-[1_1_16rem] items-center gap-1">
      <SearchCombobox
        :id="searchId"
        v-model="search"
        :scope="searchScope"
        class="min-w-0 flex-1"
        :label="searchLabel"
        :placeholder="searchPlaceholder"
        :max-per-group="LOCAL_PER_GROUP"
        :max-tags="MAX_TAGS"
        :active-tags="activeTags"
        :panel-class="SEARCH_PANEL"
        @commit="emit('commit', $event)"
        @choose="emit('choose', $event)"
      />
      <SearchOptions v-if="searchIn" v-model:search-in="searchIn" v-model:recursive="recursive" />
    </div>
    <FilterFlyout :id="filtersId" v-model:open="flyoutOpen" :count="filterCount" @clear="emit('clear-panel')">
      <slot name="filters" />
    </FilterFlyout>
    <span class="flex-1" aria-hidden="true"></span>
    <ViewPopover
      v-model:view="view"
      v-model:card-size="cardSize"
      v-model:quick-row="quickRow"
      v-model:shape="shape"
      v-model:fit="fit"
      v-model:show="show"
      :id-prefix="idPrefix"
      :view-toggle="viewToggle"
      :quick-row-option="quickRowOption"
    />
    <MenuButton :label="sortLabel" :hint="t('library.sortBy', { sort: sortLabel })" icon="sort" align="right" button-class="lm-btn flex-none max-[1279px]:[&>span]:sr-only" :items="sortItems" @select="sort = $event" />
    <button
      v-if="quickViewOption"
      type="button"
      class="lm-btn lm-btn--icon flex-none max-[1279px]:hidden touch:hidden"
      :class="{ 'lm-chip--active': quickView }"
      :aria-pressed="quickView"
      :aria-label="t('inspector.toggle')"
      :title="t('inspector.toggle')"
      @click="quickView = !quickView"
    >
      <AppIcon name="panelRight" :size="16" />
    </button>
    <button
      type="button"
      class="lm-btn flex-none"
      :class="{ 'lm-chip--active': selectionMode }"
      :aria-pressed="selectionMode"
      :aria-keyshortcuts="SHORTCUTS.select.aria"
      :title="`${t('library.select')} (B)`"
      @click="emit('toggle-select')"
    >
      <AppIcon name="checkSquare" :size="16" /><span class="max-[1279px]:sr-only">{{ t('library.select') }}</span>
    </button>
    <RefreshButton :hint="t('refresh.scanTooltip')" />
    <MenuButton :label="t('library.toolsMenu')" icon="wrench" compact align="right" button-class="lm-btn lm-btn--icon flex-none" :items="toolItems" @select="emit('tool', $event)" />
    <slot name="leading" />
  </div>

  <div v-if="$slots.context && !isPhone" class="flex min-h-[2.5rem] flex-wrap items-center gap-x-4 gap-y-1 hairline-b border-border px-4 py-1">
    <slot name="context" />
  </div>

  <slot v-if="quickRow" name="quick" />

  <!-- Active-view strip. Reserved height on desktop: a chip appearing does not push the grid down. -->
  <div
    v-if="chips.length || !isPhone"
    class="flex min-h-[2.5rem] flex-wrap items-center gap-2 px-4 py-1 phone:min-h-0 phone:px-3"
    role="group"
    :aria-label="t('library.activeView')"
    data-testid="active-view"
  >
    <span class="text-sm text-muted tabular-nums phone:text-xs" aria-hidden="true">{{ countText }}</span>
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
      <div v-if="viewToggle" class="grid grid-cols-2 gap-2" role="group" :aria-label="t('library.view')">
        <button
          v-for="entry in VIEW_BUTTONS"
          :key="entry.mode"
          type="button"
          class="lm-btn min-h-touch"
          :class="{ 'lm-chip--active': view === entry.mode }"
          :aria-pressed="view === entry.mode"
          @click="view = entry.mode"
        >
          <AppIcon :name="entry.icon" :size="16" />{{ t(entry.label) }}
        </button>
      </div>
      <div v-if="view !== 'list'" class="grid gap-1">
        <label class="lm-label" :for="`sheet-size-${idPrefix}`">{{ t('library.cardSize') }}</label>
        <input
          :id="`sheet-size-${idPrefix}`"
          v-model.number="cardSize"
          class="min-h-touch w-full accent-accent"
          type="range"
          :min="CARD_SIZE_MIN"
          :max="CARD_SIZE_MAX"
          step="10"
        />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="lm-btn min-h-touch" :aria-controls="foldersId" @click="fromSheet(() => emit('toggle-folders'))">
          <AppIcon name="folder" :size="16" />{{ t(foldersOpen ? 'library.hideFolders' : 'library.showFolders') }}
        </button>
        <button type="button" class="lm-btn min-h-touch" @click="fromSheet(() => emit('toggle-select'))">
          <AppIcon name="checkSquare" :size="16" />{{ t('library.select') }}
        </button>
      </div>
      <!-- Stays open while refreshing, so the busy state is visible. -->
      <RefreshButton variant="row" :hint="t('refresh.scanTooltip')" />
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
