<script setup lang="ts">
/**
 * Recipe library (phase B2a): folder tree, search, sort, base-model / tag /
 * favorite / missing-LoRA filters, virtualised card grid, selection mode with
 * the bulk actions the backend supports, the detail drawer and the import,
 * batch import, move and duplicates dialogs.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEventListener, useTimeoutFn } from '@vueuse/core'
import AppIcon from '@/components/AppIcon.vue'
import BaseModelQuickFilter from '@/components/BaseModelQuickFilter.vue'
import DownloadDialog from '@/components/DownloadDialog.vue'
import FolderTree from '@/components/FolderTree.vue'
import InputDialog from '@/components/InputDialog.vue'
import MenuButton, { type MenuEntry } from '@/components/MenuButton.vue'
import ModelActionMenu, { type ActionMenuItem } from '@/components/ModelActionMenu.vue'
import RecipeBatchImportDialog from '@/components/RecipeBatchImportDialog.vue'
import RecipeCard from '@/components/RecipeCard.vue'
import RecipeDrawer from '@/components/RecipeDrawer.vue'
import RecipeDuplicatesDialog from '@/components/RecipeDuplicatesDialog.vue'
import RecipeImportDialog from '@/components/RecipeImportDialog.vue'
import RecipeMoveDialog from '@/components/RecipeMoveDialog.vue'
import SearchCombobox from '@/components/SearchCombobox.vue'
import StateBlock from '@/components/StateBlock.vue'
import VirtualGrid from '@/components/VirtualGrid.vue'
import { LOCAL_PER_GROUP, MAX_TAGS } from '@/api/suggestSource'
import { recipesApi } from '@/api/recipes'
import type { CountEntry, FolderTree as FolderTreeData, RecipeItem, TagEntry } from '@/api/types'
import type { SortOption } from '@/config/libraries'
import { queryParam } from '@/config/navigation'
import { useAppSettings } from '@/composables/useAppSettings'
import { useDismissLayer } from '@/composables/useDismiss'
import { useToasts } from '@/composables/useFeedback'
import { useFolderPanel } from '@/composables/useFolderPanel'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { CARD_SIZE_MAX, CARD_SIZE_MIN, useLibraryFilters } from '@/composables/useLibraryFilters'
import { recipeTitle, useRecipeActions } from '@/composables/useRecipeActions'
import { sortBaseModels } from '@/utils/baseModelChips'
import { invertSelection, pruneSelection } from '@/utils/modelActions'
import { missingLoraTargets, missingLorasInput, parseTagInput } from '@/utils/recipes'
import type { SuggestOption } from '@/utils/suggest'
import { t, type MessageKey } from '@/i18n'

const PAGE_SIZE = 60
const SORTS: SortOption[] = [
  { value: 'date:desc', label: 'library.sort.dateDesc' },
  { value: 'date:asc', label: 'library.sort.dateAsc' },
  { value: 'name:asc', label: 'library.sort.nameAsc' },
  { value: 'name:desc', label: 'library.sort.nameDesc' },
  { value: 'loras_count:desc', label: 'recipes.sort.lorasDesc' },
  { value: 'opened:desc', label: 'recipes.sort.opened' },
]

const route = useRoute()
const router = useRouter()
const toasts = useToasts()
const { settings, load: loadSettings } = useAppSettings()
const filters = useLibraryFilters({ prefix: 'recipes', sortOptions: SORTS, defaultSort: 'date:desc' })
const { state } = filters
const missingOnly = ref(false)
const folders = useFolderPanel('recipes')
const showFolders = folders.open
const foldersPanel = ref<HTMLElement | null>(null)
const foldersToggle = ref<HTMLButtonElement | null>(null)
useDismissLayer({
  active: () => showFolders.value && folders.isOverlay(),
  close: (reason) => {
    folders.set(false)
    if (reason === 'escape') foldersToggle.value?.focus()
  },
  outside: () => [foldersPanel.value, foldersToggle.value],
})

const list = useInfiniteList<RecipeItem>((page, signal) =>
  recipesApi.list(
    {
      page,
      pageSize: PAGE_SIZE,
      sortBy: filters.sort.value,
      search: state.search,
      folder: state.folder,
      baseModels: state.baseModels,
      tags: state.tags,
      favoritesOnly: state.favoritesOnly,
      loraAvailability: missingOnly.value ? ['missing'] : [],
    },
    signal,
  ),
)

const grid = ref<InstanceType<typeof VirtualGrid> | null>(null)
const tree = shallowRef<FolderTreeData>({})
const baseModels = ref<CountEntry[]>([])
const topTags = ref<TagEntry[]>([])
const showFilters = ref(false)
const openItem = ref<RecipeItem | null>(null)
const selectionMode = ref(false)
const selected = ref<Set<string>>(new Set())
const blurMature = computed(() => !!settings.value?.blur_mature_content)

const chips = computed(() => [
  ...filters.chips.value,
  ...(missingOnly.value ? [{ key: 'missing', label: t('recipes.filter.missingOnly'), remove: () => (missingOnly.value = false) }] : []),
])
const panelCount = computed(() => filters.panelCount.value + (missingOnly.value ? 1 : 0))
const filterGroups = computed(() => [
  { field: 'baseModels' as const, title: 'library.baseModels' as MessageKey, entries: sortBaseModels(baseModels.value) },
  { field: 'tags' as const, title: 'library.tags' as MessageKey, entries: topTags.value.map((entry) => ({ name: entry.tag, count: entry.count })) },
])

function refreshMeta(): void {
  recipesApi.folderTree().then((value) => (tree.value = value)).catch(() => undefined)
  // The synthetic "Unknown" bucket filters by a marker value; it is left out of the chips.
  recipesApi
    .baseModels(100)
    .then((value) => (baseModels.value = value.filter((entry) => !entry.value)))
    .catch(() => undefined)
  recipesApi.topTags(40).then((value) => (topTags.value = value)).catch(() => undefined)
}

function reload(): void {
  grid.value?.scrollToTop()
  void list.reset()
}

watch([filters.signature, missingOnly], reload)
onMounted(() => {
  void list.reset()
  void loadSettings()
  refreshMeta()
})

function selectFolder(path: string): void {
  state.folder = state.folder === path ? '' : path
  if (folders.isOverlay()) folders.set(false)
}

// Local search: applies after a short pause or at once on Enter / a pick.
const searchText = ref(state.search)
const { start: applyLater, stop: cancelApply } = useTimeoutFn(() => (state.search = searchText.value.trim()), 250, { immediate: false })
function commitSearch(value: string): void {
  cancelApply()
  searchText.value = value
  state.search = value.trim()
}
watch(searchText, (value) => {
  cancelApply()
  if (value.trim() !== state.search) applyLater()
})
watch(
  () => state.search,
  (value) => {
    if (searchText.value.trim() !== value) searchText.value = value
  },
)

function onSearchChoose(option: SuggestOption): void {
  if (option.kind === 'item') openItem.value = option.item.payload as RecipeItem
  else if (option.kind === 'tag') {
    filters.include('tags', option.tag.tag)
    commitSearch('')
  }
}

/** ?open=<id> opens the drawer (deep link / import "Open recipe"); kept in sync with it. */
async function openById(id: string): Promise<void> {
  const loaded = list.items.value.find((item) => item.id === id)
  if (loaded) {
    openItem.value = loaded
    return
  }
  try {
    openItem.value = await recipesApi.detail(id)
  } catch {
    void router.replace({ query: { ...route.query, open: undefined } })
  }
}

watch(
  () => [route.query.q, route.query.open],
  () => {
    if (route.query.q !== undefined) {
      commitSearch(queryParam(route.query.q))
      void router.replace({ query: { ...route.query, q: undefined } })
    }
    const open = queryParam(route.query.open)
    if (open && openItem.value?.id !== open) void openById(open)
  },
  { immediate: true },
)
watch(openItem, (item) => {
  const next = item?.id ?? ''
  if (queryParam(route.query.open) !== next) void router.replace({ query: { ...route.query, open: next || undefined } })
})

// --- Actions -----------------------------------------------------------------

function onUpdated(updated: RecipeItem): void {
  list.updateItem((item) => item.id === updated.id, (item) => ({ ...item, ...updated }))
  if (openItem.value?.id === updated.id) openItem.value = { ...openItem.value, ...updated }
}

const actions = useRecipeActions({
  removed: (ids) => {
    const gone = new Set(ids)
    list.removeWhere((item) => gone.has(item.id))
    selected.value = pruneSelection(selected.value, ids)
    if (openItem.value && gone.has(openItem.value.id)) openItem.value = null
  },
  updated: onUpdated,
  changed: () => {
    reload()
    refreshMeta()
  },
})

function toggleSelect(item: RecipeItem): void {
  const next = new Set(selected.value)
  if (next.has(item.id)) next.delete(item.id)
  else next.add(item.id)
  selected.value = next
}

function setSelectionMode(value: boolean): void {
  selectionMode.value = value
  if (!value) selected.value = new Set()
}

const loadedKeys = () => list.items.value.map((item) => item.id)
const selectedItems = computed(() => list.items.value.filter((item) => selected.value.has(item.id)))

useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  if (!selectionMode.value || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"], dialog[open]') || openItem.value) return
  event.preventDefault()
  selected.value = new Set(loadedKeys())
})

const importOpen = ref(false)
const batchOpen = ref(false)
const duplicatesOpen = ref(false)
const downloadInput = ref<string | null>(null)
const moveTargets = ref<RecipeItem[] | null>(null)
const tagTargets = ref<RecipeItem[] | null>(null)
const renameTarget = ref<RecipeItem | null>(null)
const menu = ref<{ item: RecipeItem; x: number; y: number; opener: HTMLElement | null } | null>(null)

const toolItems = computed<MenuEntry[]>(() => [
  { id: 'batch', label: t('recipes.batch.open'), icon: 'files' },
  { id: 'duplicates', label: t('recipes.duplicates.open'), icon: 'layers' },
])

function runTool(id: string): void {
  if (id === 'batch') batchOpen.value = true
  else if (id === 'duplicates') duplicatesOpen.value = true
}

const MENU_ITEMS = computed<ActionMenuItem[]>(() => [
  { action: 'send', label: t('recipes.send'), icon: 'send' },
  { action: 'copy', label: t('recipes.copySyntax'), icon: 'copy' },
  { action: 'rename', label: t('recipes.rename.open'), icon: 'pencil' },
  { action: 'move', label: t('actions.move'), icon: 'folderMove' },
  { action: 'missing', label: t('recipes.missing.downloadShort'), icon: 'download' },
  { action: 'delete', label: t('actions.delete'), icon: 'trash', danger: true },
])

function runAction(action: string, item: RecipeItem): void {
  if (action === 'send') void actions.sendToComfy(item)
  else if (action === 'copy') void actions.copySyntax(item)
  else if (action === 'rename') renameTarget.value = item
  else if (action === 'move') moveTargets.value = [item]
  else if (action === 'missing') downloadMissing([item])
  else if (action === 'delete') void actions.deleteRecipes([item])
}

function closeMenu(reason: 'escape' | 'outside' | 'select'): void {
  const opener = menu.value?.opener
  menu.value = null
  if (reason === 'escape') opener?.focus()
}

/** Missing LoRAs of the given recipes into the B1 download dialog (deduplicated). */
function downloadMissing(recipes: RecipeItem[]): void {
  const { targets, withoutVersion } = missingLoraTargets(recipes)
  if (withoutVersion) toasts.warning(t('recipes.missing.withoutVersion', { count: withoutVersion }))
  if (targets.length) downloadInput.value = missingLorasInput(targets)
  else if (!withoutVersion) toasts.success(t('recipes.missing.none'))
}

async function submitTags(value: string): Promise<string | null> {
  await actions.addTags(tagTargets.value ?? [], parseTagInput(value))
  refreshMeta()
  return null
}

async function submitRename(value: string): Promise<string | null> {
  return renameTarget.value ? actions.rename(renameTarget.value, value) : null
}

function onImported(id: string): void {
  reload()
  refreshMeta()
  toasts.success(t('recipes.import.savedToast'))
  void id
}

function openFromDialog(id: string): void {
  importOpen.value = false
  duplicatesOpen.value = false
  void openById(id)
}

function filterByTag(tag: string): void {
  filters.include('tags', tag)
  openItem.value = null
}
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <aside
      v-show="showFolders"
      id="folders-recipes"
      ref="foldersPanel"
      class="w-[240px] flex-none overflow-y-auto hairline-r border-border bg-surface px-3 py-4 narrow:absolute narrow:inset-y-0 narrow:left-0 narrow:z-20 narrow:w-[min(300px,85vw)] narrow:shadow-lg"
      :aria-label="t('library.folders')"
    >
      <div class="mb-2 flex items-center justify-between">
        <h2 class="lm-overline text-sm">{{ t('library.folders') }}</h2>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('library.hideFolders')" :title="t('library.hideFolders')" @click="folders.set(false)">
          <AppIcon name="close" :size="14" />
        </button>
      </div>
      <button type="button" class="lm-row flex h-[30px] w-full cursor-pointer items-center gap-2 px-2 text-sm" :class="{ 'is-selected': !state.folder }" @click="state.folder = ''">
        <AppIcon name="grid" :size="15" />{{ t('library.allFolders') }}
      </button>
      <FolderTree :tree="tree" :selected="state.folder" @select="selectFolder" />
    </aside>

    <section class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div class="lm-toolbar pb-3 phone:pb-2">
        <div class="lm-toolbar-title">
          <h1>{{ t('recipes.title') }}</h1>
          <span class="text-sm text-muted tabular-nums" aria-live="polite">{{ t('library.count', { count: list.total.value.toLocaleString() }) }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2 phone:w-full">
          <SearchCombobox
            id="recipe-search"
            v-model="searchText"
            scope="recipes"
            class="w-[260px] narrow:w-[200px] phone:w-full"
            :label="t('library.search', { section: t('nav.recipes') })"
            :placeholder="t('library.searchPlaceholder', { section: t('nav.recipes') })"
            :max-per-group="LOCAL_PER_GROUP"
            :max-tags="MAX_TAGS"
            :active-tags="state.tags"
            panel-class="left-0 top-[calc(100%+var(--lm-space-1))] w-[min(420px,calc(100vw-24px))] phone:right-0 phone:w-auto"
            @commit="commitSearch"
            @choose="onSearchChoose"
          />
          <button type="button" class="lm-btn lm-btn--primary" @click="importOpen = true">
            <AppIcon name="plus" :size="16" /><span class="phone:sr-only">{{ t('recipes.import.open') }}</span>
          </button>
          <button
            ref="foldersToggle"
            type="button"
            class="lm-btn"
            :class="{ 'lm-chip--active': showFolders }"
            :aria-expanded="showFolders"
            aria-controls="folders-recipes"
            :title="t(showFolders ? 'library.hideFolders' : 'library.showFolders')"
            @click="folders.toggle()"
          >
            <AppIcon name="folder" :size="16" /><span class="phone:sr-only">{{ t('library.folders') }}</span>
            <span v-if="state.folder && !showFolders" class="size-[6px] rounded-pill bg-accent" aria-hidden="true"></span>
          </button>
          <label class="sr-only" for="recipe-sort">{{ t('library.sort') }}</label>
          <select id="recipe-sort" v-model="filters.sort.value" class="lm-select w-auto min-w-[150px] phone:min-w-0 phone:flex-1">
            <option v-for="option in SORTS" :key="option.value" :value="option.value">{{ t(option.label) }}</option>
          </select>
          <button type="button" class="lm-btn" :aria-expanded="showFilters" aria-controls="recipe-filters" @click="showFilters = !showFilters">
            <AppIcon name="filter" :size="16" /><span class="phone:sr-only">{{ t('library.filters') }}</span>
            <span v-if="panelCount" class="lm-badge lm-badge--accent">{{ panelCount }}</span>
          </button>
          <label class="inline-flex items-center gap-2 px-2 text-muted phone:hidden">
            <span class="sr-only">{{ t('library.cardSize') }}</span>
            <AppIcon name="grid" :size="16" />
            <input v-model.number="filters.cardSize.value" class="w-[110px] accent-accent" type="range" :min="CARD_SIZE_MIN" :max="CARD_SIZE_MAX" step="10" :aria-label="t('library.cardSize')" />
          </label>
          <MenuButton :label="t('tools.menu')" icon="wrench" align="right" :items="toolItems" @select="runTool" />
          <button type="button" class="lm-btn" :aria-pressed="selectionMode" @click="setSelectionMode(!selectionMode)">
            <AppIcon :name="selectionMode ? 'check' : 'checkSquare'" :size="16" />
            <span class="phone:sr-only">{{ selectionMode ? t('library.selectDone') : t('library.select') }}</span>
          </button>
        </div>
      </div>

      <BaseModelQuickFilter
        :entries="baseModels"
        :selected="state.baseModels"
        :limit="8"
        id-prefix="recipes"
        @toggle="filters.toggle('baseModels', $event)"
        @clear="filters.clearList('baseModels')"
      />

      <div v-if="showFilters" id="recipe-filters" class="lm-panel mx-6 mb-3 grid gap-4 p-4 phone:mx-3">
        <div v-for="group in filterGroups" :key="group.field">
          <h3 class="lm-overline mb-2">{{ t(group.title) }}</h3>
          <div class="flex max-h-[120px] flex-wrap gap-1 overflow-y-auto">
            <button
              v-for="entry in group.entries"
              :key="entry.name"
              type="button"
              class="lm-chip"
              :class="{ 'lm-chip--active': state[group.field].includes(entry.name) }"
              :aria-pressed="state[group.field].includes(entry.name)"
              @click="filters.toggle(group.field, entry.name)"
            >
              {{ entry.name }} <span class="lm-muted">{{ entry.count }}</span>
            </button>
            <p v-if="!group.entries.length" class="text-sm text-muted">{{ t('common.none') }}</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-4">
          <label><input v-model="state.favoritesOnly" class="accent-accent" type="checkbox" /> {{ t('library.favoritesOnly') }}</label>
          <label><input v-model="missingOnly" class="accent-accent" type="checkbox" /> {{ t('recipes.filter.missingOnly') }}</label>
        </div>
      </div>

      <div v-if="chips.length" class="flex flex-wrap items-center gap-2 px-6 pb-3 phone:px-3" :aria-label="t('library.filters')">
        <span v-for="chip in chips" :key="chip.key" class="lm-chip lm-chip--active">
          {{ chip.label }}
          <button type="button" class="lm-icon-btn" :aria-label="t('library.removeFilter', { name: chip.label })" @click="chip.remove()">
            <AppIcon name="close" :size="12" />
          </button>
        </span>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm" @click="filters.clear(); missingOnly = false">{{ t('library.clearFilters') }}</button>
      </div>

      <div
        v-if="selectionMode"
        class="mx-6 mb-3 flex flex-wrap items-center gap-2 rounded-md bg-accent-soft px-3 py-2 phone:mx-3"
        role="toolbar"
        :aria-label="t('selection.toolbar', { count: selected.size })"
      >
        <strong class="tabular-nums" aria-live="polite">{{ t('library.selected', { count: selected.size }) }}</strong>
        <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="t('library.select')">
          <button type="button" class="lm-btn lm-btn--sm" :title="t('recipes.selection.hint')" @click="selected = new Set(loadedKeys())">{{ t('selection.all') }}</button>
          <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="selected = new Set()">{{ t('selection.none') }}</button>
          <button type="button" class="lm-btn lm-btn--sm" :disabled="!list.items.value.length" @click="selected = invertSelection(selected, loadedKeys())">{{ t('selection.invert') }}</button>
        </div>
        <span class="mx-1 h-[20px] hairline-l border-border-strong phone:hidden" aria-hidden="true"></span>
        <div class="flex flex-wrap items-center gap-1">
          <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="moveTargets = selectedItems">
            <AppIcon name="folderMove" :size="14" />{{ t('selection.move') }}
          </button>
          <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="tagTargets = selectedItems">
            <AppIcon name="tag" :size="14" />{{ t('selection.tags') }}
          </button>
          <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="downloadMissing(selectedItems)">
            <AppIcon name="download" :size="14" />{{ t('recipes.missing.downloadShort') }}
          </button>
          <button type="button" class="lm-btn lm-btn--sm lm-btn--danger" :disabled="!selected.size" @click="actions.deleteRecipes(selectedItems)">
            <AppIcon name="trash" :size="14" />{{ t('selection.delete') }}
          </button>
        </div>
      </div>

      <StateBlock v-if="list.error.value && !list.items.value.length" kind="error" :message="list.error.value" @retry="reload" />
      <StateBlock
        v-else-if="list.loaded.value && !list.items.value.length"
        kind="empty"
        icon="book"
        :title="chips.length ? t('library.empty') : t('recipes.empty')"
        :message="chips.length ? '' : t('recipes.emptyHint')"
      />
      <div v-else-if="!list.loaded.value" class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-card overflow-hidden px-6 phone:px-3" aria-hidden="true">
        <div v-for="n in 12" :key="n" class="lm-skeleton aspect-card rounded-md"></div>
      </div>

      <VirtualGrid
        v-show="list.items.value.length"
        ref="grid"
        :items="list.items.value"
        :item-key="(item: RecipeItem) => item.id"
        :min-item-width="filters.cardSize.value"
        :label="t('recipes.title')"
        @reach-end="list.loadMore()"
      >
        <template #default="{ item }">
          <RecipeCard
            :item="item"
            :selection-mode="selectionMode"
            :selected="selected.has(item.id)"
            :blur-mature="blurMature"
            @open="openItem = $event"
            @send="(recipe, replace) => actions.sendToComfy(recipe, replace ? 'replace' : 'append')"
            @toggle-select="toggleSelect"
            @toggle-favorite="actions.toggleFavorite"
            @menu="(recipe, point, opener) => (menu = { item: recipe, ...point, opener })"
          />
        </template>
        <template #footer>
          <p v-if="list.loading.value && list.items.value.length" class="mt-4 flex items-center justify-center gap-2 text-sm text-muted">{{ t('library.loadMore') }}</p>
          <p v-else-if="list.error.value && list.items.value.length" class="mt-4 flex items-center justify-center gap-2 text-sm">
            <span class="lm-error-text">{{ list.error.value }}</span>
            <button type="button" class="lm-btn lm-btn--sm" @click="list.loadMore()">{{ t('common.retry') }}</button>
          </p>
        </template>
      </VirtualGrid>
    </section>

    <RecipeDrawer
      v-if="openItem"
      :item="openItem"
      :actions="actions"
      :blur-mature="blurMature"
      @close="openItem = null"
      @filter-tag="filterByTag"
      @rename="renameTarget = $event"
      @move="moveTargets = [$event]"
      @delete="actions.deleteRecipes([$event])"
      @download="downloadInput = $event"
    />
    <ModelActionMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="MENU_ITEMS"
      :label="t('actions.menu', { name: recipeTitle(menu.item) })"
      @select="runAction($event, menu!.item)"
      @close="closeMenu"
    />
    <RecipeImportDialog v-if="importOpen" @close="importOpen = false" @saved="onImported" @open="openFromDialog" @download="downloadInput = $event" />
    <RecipeBatchImportDialog v-if="batchOpen" @close="batchOpen = false" @imported="reload(); refreshMeta()" />
    <RecipeDuplicatesDialog v-if="duplicatesOpen" :actions="actions" @close="duplicatesOpen = false" @open="openFromDialog" />
    <RecipeMoveDialog v-if="moveTargets" :items="moveTargets" :actions="actions" @close="moveTargets = null" />
    <InputDialog
      v-if="tagTargets"
      :title="t('recipes.tags.title', { count: tagTargets.length })"
      :label="t('actions.tags.label')"
      :hint="t('recipes.tags.hint')"
      initial=""
      :confirm-label="t('actions.tags.confirm')"
      :validate="(value) => (parseTagInput(value).length ? null : t('actions.tags.errorEmpty'))"
      :submit="submitTags"
      @close="tagTargets = null"
    />
    <InputDialog
      v-if="renameTarget"
      :title="t('recipes.rename.title')"
      :label="t('recipes.rename.label')"
      :initial="renameTarget.title ?? ''"
      :confirm-label="t('recipes.rename.confirm')"
      :validate="(value) => (value.trim() ? null : t('recipes.rename.errorEmpty'))"
      :submit="submitRename"
      @close="renameTarget = null"
    />
    <DownloadDialog v-if="downloadInput !== null" prefix="loras" :initial-input="downloadInput" @close="downloadInput = null" />
  </div>
</template>
