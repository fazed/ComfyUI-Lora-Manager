<script setup lang="ts">
/**
 * Recipe library (phase B2a): folder tree, search, sort, base-model / tag /
 * favorite / missing-LoRA filters, virtualised card grid, selection mode with
 * the bulk actions the backend supports, the detail drawer and the import,
 * batch import, move and duplicates dialogs.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
import LibraryFilterPanel, { type FilterGroup } from '@/components/LibraryFilterPanel.vue'
import LibrarySelectionBar from '@/components/LibrarySelectionBar.vue'
import LibraryToolbar from '@/components/LibraryToolbar.vue'
import StateBlock from '@/components/StateBlock.vue'
import VirtualGrid from '@/components/VirtualGrid.vue'
import { recipesApi } from '@/api/recipes'
import type { CountEntry, FolderTree as FolderTreeData, RecipeItem, TagEntry } from '@/api/types'
import type { SortOption } from '@/config/libraries'
import { queryParam } from '@/config/navigation'
import { useAppSettings } from '@/composables/useAppSettings'
import { useDismissLayer } from '@/composables/useDismiss'
import { useToasts } from '@/composables/useFeedback'
import { useFolderPanel } from '@/composables/useFolderPanel'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { useLibraryFilters } from '@/composables/useLibraryFilters'
import { recipeTitle, useRecipeActions } from '@/composables/useRecipeActions'
import { clearBrowseView, RESTORE_MAX_ITEMS, saveBrowseView, takeBrowseView, unfilteredTotal, type BrowseViewState } from '@/utils/browse'
import { hiddenSelectedCount, invertSelection, pruneSelection, selectRange } from '@/utils/modelActions'
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

// Filters, search, folder and scroll survive a tab switch; a real deep link starts clean.
const deepLinked = route.query.q !== undefined || route.query.open !== undefined
if (deepLinked) clearBrowseView('recipes')
const restored = takeBrowseView('recipes')
if (restored) {
  state.search = restored.search
  state.folder = restored.folder
  state.baseModels = [...restored.baseModels]
  state.tags = [...restored.tags]
  state.favoritesOnly = restored.favoritesOnly
  missingOnly.value = restored.missingOnly
}
const folders = useFolderPanel('recipes')
const showFolders = folders.open
const foldersPanel = ref<HTMLElement | null>(null)
const toolbar = ref<InstanceType<typeof LibraryToolbar> | null>(null)
const foldersToggle = () => toolbar.value?.foldersToggle ?? null
useDismissLayer({
  active: () => showFolders.value && folders.isOverlay(),
  close: (reason) => {
    folders.set(false)
    if (reason === 'escape') foldersToggle()?.focus()
  },
  outside: () => [foldersPanel.value, foldersToggle()],
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
const openItem = ref<RecipeItem | null>(null)
const selectionMode = ref(false)
const selected = ref<Set<string>>(new Set())
const blurMature = computed(() => !!settings.value?.blur_mature_content)

const chips = computed(() => [
  ...filters.chips.value,
  ...(missingOnly.value ? [{ key: 'missing', label: t('recipes.filter.missingOnly'), remove: () => (missingOnly.value = false) }] : []),
])
const panelCount = computed(() => filters.panelCount.value + (missingOnly.value ? 1 : 0))
const filterGroups = computed<FilterGroup[]>(() => [
  // The quick-filter row already offers the base models: do not repeat the group.
  { field: 'tags' as const, title: 'library.tags' as MessageKey, entries: topTags.value.map((entry) => ({ name: entry.tag, count: entry.count })) },
])

function clearAll(): void {
  filters.clear()
  missingOnly.value = false
}

// "N of total" while filtered: the total is the count seen the last time nothing was filtered.
const knownTotal = ref<number | null>(restored?.knownTotal ?? null)
watch(
  () => [list.loaded.value, list.total.value, chips.value.length] as const,
  ([loaded, total, active]) => {
    if (loaded && !active) knownTotal.value = total
  },
  { immediate: true },
)
const countText = computed(() => {
  const count = list.total.value
  const all = unfilteredTotal(count, knownTotal.value, chips.value.length > 0)
  return all === null
    ? t('recipes.count', { count: count.toLocaleString() })
    : t('recipes.countOf', { count: count.toLocaleString(), total: all.toLocaleString() })
})

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
async function restoreScroll(view: BrowseViewState): Promise<void> {
  // The list restarts at page 1: load as many pages as were loaded before, then jump back.
  for (let guard = 0; guard < 20 && list.hasMore.value && !list.error.value && list.items.value.length < Math.min(view.loadedCount, RESTORE_MAX_ITEMS); guard++) {
    await list.loadMore()
  }
  await nextTick()
  grid.value?.scrollTo(view.scrollTop)
}

onBeforeUnmount(() => {
  saveBrowseView('recipes', {
    search: state.search,
    folder: state.folder,
    baseModels: state.baseModels,
    tags: state.tags,
    favoritesOnly: state.favoritesOnly,
    updatesOnly: false,
    missingOnly: missingOnly.value,
    scrollTop: grid.value?.scrollOffset() ?? 0,
    loadedCount: list.items.value.length,
    knownTotal: knownTotal.value,
  })
})

onMounted(() => {
  void list.reset().then(() => (restored ? restoreScroll(restored) : undefined))
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

/** Last toggled card: the start of a Shift+click range. */
let anchor: string | null = null

function toggleSelect(item: RecipeItem, range = false): void {
  // Ctrl/Cmd+click on a card outside selection mode starts it with that card.
  if (!selectionMode.value) setSelectionMode(true)
  const next = new Set(selected.value)
  if (range && anchor) for (const inRange of selectRange(loadedKeys(), anchor, item.id)) next.add(inRange)
  else if (next.has(item.id)) next.delete(item.id)
  else next.add(item.id)
  anchor = item.id
  selected.value = next
}

function setSelectionMode(value: boolean): void {
  selectionMode.value = value
  anchor = null
  if (!value) selected.value = new Set()
}

// Escape leaves selection mode (only when no drawer, dialog or menu is above it).
useDismissLayer({ active: () => selectionMode.value, close: () => setSelectionMode(false) })

const loadedKeys = () => list.items.value.map((item) => item.id)
const hiddenSelected = computed(() => hiddenSelectedCount(selected.value, loadedKeys()))
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
      <LibraryToolbar
        ref="toolbar"
        v-model:search="searchText"
        v-model:sort="filters.sort.value"
        v-model:card-size="filters.cardSize.value"
        :title="t('recipes.title')"
        :count-text="countText"
        search-id="recipe-search"
        search-scope="recipes"
        :search-label="t('library.search', { section: t('nav.recipes') })"
        :search-placeholder="t('library.searchPlaceholder', { section: t('nav.recipes') })"
        :active-tags="state.tags"
        id-prefix="recipes"
        :sort-options="SORTS"
        folders-id="folders-recipes"
        :folders-open="showFolders"
        :folder-active="!!state.folder"
        :filter-count="panelCount"
        :chips="chips"
        :selection-mode="selectionMode"
        :tool-items="toolItems"
        :shortcuts="!openItem"
        @commit="commitSearch"
        @choose="onSearchChoose"
        @toggle-folders="folders.toggle()"
        @toggle-select="setSelectionMode(!selectionMode)"
        @tool="runTool"
        @clear-filters="clearAll"
      >
        <template #leading>
          <button type="button" class="lm-btn lm-btn--primary flex-none phone:min-h-touch" @click="importOpen = true">
            <AppIcon name="plus" :size="16" />{{ t('recipes.import.open') }}
          </button>
        </template>
        <template #quick>
          <BaseModelQuickFilter
            :entries="baseModels"
            :selected="state.baseModels"
            :limit="8"
            id-prefix="recipes"
            @toggle="filters.toggle('baseModels', $event)"
            @clear="filters.clearList('baseModels')"
          />
        </template>
        <template #filters>
          <LibraryFilterPanel :groups="filterGroups" :selected="state" id-prefix="recipes" @toggle="filters.toggle">
            <label><input v-model="state.favoritesOnly" class="accent-accent" type="checkbox" /> {{ t('library.favoritesOnly') }}</label>
            <label><input v-model="missingOnly" class="accent-accent" type="checkbox" /> {{ t('recipes.filter.missingOnly') }}</label>
          </LibraryFilterPanel>
        </template>
        <template #selection>
          <LibrarySelectionBar
            :count="selected.size"
            :hidden="hiddenSelected"
            :has-items="!!list.items.value.length"
            :hint="`${t('recipes.selection.hint')} ${t('selection.rangeHint')}`"
            @all="selected = new Set(loadedKeys())"
            @none="selected = new Set()"
            @invert="selected = invertSelection(selected, loadedKeys())"
            @done="setSelectionMode(false)"
          >
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
          </LibrarySelectionBar>
        </template>
      </LibraryToolbar>

      <StateBlock v-if="list.error.value && !list.items.value.length" kind="error" :message="list.error.value" @retry="reload" />
      <StateBlock
        v-else-if="list.loaded.value && !list.items.value.length"
        kind="empty"
        icon="book"
        :title="chips.length ? t('library.empty') : t('recipes.empty')"
        :message="chips.length ? '' : t('recipes.emptyHint')"
      >
        <button v-if="chips.length" type="button" class="lm-btn phone:min-h-touch" @click="clearAll">{{ t('library.clearFilters') }}</button>
      </StateBlock>

      <VirtualGrid
        v-show="list.items.value.length || (!list.loaded.value && !list.error.value)"
        ref="grid"
        :skeleton="!list.loaded.value && !list.error.value"
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
          <p v-else-if="list.loaded.value && !list.hasMore.value && list.items.value.length" class="mt-4 text-center text-sm text-muted">
            {{ t('recipes.end', { count: list.total.value.toLocaleString() }) }}
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
