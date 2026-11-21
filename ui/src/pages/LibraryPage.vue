<script setup lang="ts">
/**
 * Generic model library (LoRAs, checkpoints, embeddings): folder tree,
 * filters, virtualised card grid, selection mode and the detail drawer.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { until, useEventListener, useTimeoutFn } from '@vueuse/core'
import AppIcon from '@/components/AppIcon.vue'
import BaseModelQuickFilter from '@/components/BaseModelQuickFilter.vue'
import DownloadDialog from '@/components/DownloadDialog.vue'
import DuplicatesDialog from '@/components/DuplicatesDialog.vue'
import ExcludedDialog from '@/components/ExcludedDialog.vue'
import FolderDialog from '@/components/FolderDialog.vue'
import MenuButton, { type MenuEntry } from '@/components/MenuButton.vue'
import PreviewDialog from '@/components/PreviewDialog.vue'
import TemplateDialog from '@/components/TemplateDialog.vue'
import FolderTree from '@/components/FolderTree.vue'
import InputDialog from '@/components/InputDialog.vue'
import ModelActionMenu, { type ModelAction } from '@/components/ModelActionMenu.vue'
import ModelCard from '@/components/ModelCard.vue'
import ModelDrawer from '@/components/ModelDrawer.vue'
import MoveDialog from '@/components/MoveDialog.vue'
import OrganizeDialog from '@/components/OrganizeDialog.vue'
import SearchCombobox from '@/components/SearchCombobox.vue'
import StateBlock from '@/components/StateBlock.vue'
import VirtualGrid from '@/components/VirtualGrid.vue'
import { createModelApi } from '@/api/endpoints'
import type { CountEntry, FolderTree as FolderTreeData, ModelItem, ModelPrefix, TagEntry } from '@/api/types'
import { LIBRARIES } from '@/config/libraries'
import { useAppSettings } from '@/composables/useAppSettings'
import { useDismissLayer } from '@/composables/useDismiss'
import { copyText, useToasts } from '@/composables/useFeedback'
import { useFolderPanel } from '@/composables/useFolderPanel'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { CARD_SIZE_MAX, CARD_SIZE_MIN, useLibraryFilters } from '@/composables/useLibraryFilters'
import { takeStashedItem } from '@/composables/useSearch'
import { LOCAL_PER_GROUP, MAX_TAGS } from '@/api/suggestSource'
import { queryParam } from '@/config/navigation'
import type { SuggestOption } from '@/utils/suggest'
import { useSendToWorkflow } from '@/composables/useSendToWorkflow'
import { useModelActions } from '@/composables/useModelActions'
import { useModelTools } from '@/composables/useModelTools'
import type { TemplateScope } from '@/api/endpoints'
import { sortBaseModels } from '@/utils/baseModelChips'
import { computeNav, type NavDirection } from '@/utils/drawerNav'
import { isVideoUrl } from '@/utils/format'
import { invertSelection, pruneSelection, validateFileName } from '@/utils/modelActions'
import { withMountPrefix } from '@/utils/basePath'
import { t, type MessageKey } from '@/i18n'

const props = defineProps<{ prefix: ModelPrefix }>()

const PAGE_SIZE = 60
const config = LIBRARIES[props.prefix]
const api = createModelApi(props.prefix)
const classicUrl = withMountPrefix(`/${config.classicPath}`)
const toasts = useToasts()
const route = useRoute()
const router = useRouter()
const { settings, load: loadSettings } = useAppSettings()
const filters = useLibraryFilters(config)
const { state } = filters
const folders = useFolderPanel(props.prefix)
const showFolders = folders.open
const foldersId = `folders-${props.prefix}`
const foldersPanel = ref<HTMLElement | null>(null)
const foldersToggle = ref<HTMLButtonElement | null>(null)
// On narrow viewports the folder panel overlays the grid: outside pointerdown or Escape closes it.
useDismissLayer({
  active: () => showFolders.value && folders.isOverlay(),
  close: (reason) => {
    folders.set(false)
    if (reason === 'escape') foldersToggle.value?.focus()
  },
  outside: () => [foldersPanel.value, foldersToggle.value],
})
const workflow = useSendToWorkflow()

const list = useInfiniteList<ModelItem>((page, signal) =>
  api.list(
    {
      page,
      pageSize: PAGE_SIZE,
      sortBy: filters.sort.value,
      search: state.search,
      folder: state.folder,
      baseModels: state.baseModels,
      tags: state.tags,
      favoritesOnly: state.favoritesOnly,
      updateAvailableOnly: state.updatesOnly,
    },
    signal,
  ),
)

const grid = ref<InstanceType<typeof VirtualGrid> | null>(null)
const tree = shallowRef<FolderTreeData>({})
const baseModels = ref<CountEntry[]>([])
const topTags = ref<TagEntry[]>([])
const showFilters = ref(false)
const openItem = ref<ModelItem | null>(null)
const selectionMode = ref(false)
const selected = ref<Set<string>>(new Set())

const blurMature = computed(() => !!settings.value?.blur_mature_content)
const civitaiHost = computed(() => String(settings.value?.civitai_host || 'civitai.com'))

/** The two chip groups of the filter panel. */
const filterGroups = computed(() => [
  { field: 'baseModels' as const, title: 'library.baseModels' as MessageKey, entries: sortBaseModels(baseModels.value) },
  {
    field: 'tags' as const,
    title: 'library.tags' as MessageKey,
    entries: topTags.value.map((entry) => ({ name: entry.tag, count: entry.count })),
  },
])

function reload(): void {
  grid.value?.scrollToTop()
  void list.reset()
}

watch(filters.signature, reload)

onMounted(() => {
  void list.reset()
  void loadSettings()
  api.folderTree().then((value) => (tree.value = value)).catch(() => undefined)
  api.baseModels(100).then((value) => (baseModels.value = value)).catch(() => undefined)
  api.topTags(40).then((value) => (topTags.value = value)).catch(() => undefined)
})

function selectFolder(path: string): void {
  state.folder = state.folder === path ? '' : path
  if (folders.isOverlay()) folders.set(false)
}

// Local search box: the text filters the grid after a short pause (or at once on Enter).
const SEARCH_DEBOUNCE_MS = 250
const searchText = ref(state.search)
const { start: applyLater, stop: cancelApply } = useTimeoutFn(
  () => (state.search = searchText.value.trim()),
  SEARCH_DEBOUNCE_MS,
  { immediate: false },
)

function commitSearch(value: string): void {
  cancelApply()
  searchText.value = value
  state.search = value.trim()
}

watch(searchText, (value) => {
  cancelApply()
  if (value.trim() !== state.search) applyLater()
})
// Chip removal / "Clear all" / route prefill update the box too.
watch(
  () => state.search,
  (value) => {
    if (searchText.value.trim() !== value) searchText.value = value
  },
)

function onSearchChoose(option: SuggestOption): void {
  if (option.kind === 'item') openItem.value = option.item.payload as ModelItem
  else if (option.kind === 'tag') {
    filters.include('tags', option.tag.tag)
    commitSearch('')
  }
}

/** Opens the drawer for `?open=<file_path>` (global search pick or a reload). */
async function openByPath(path: string): Promise<void> {
  const stashed = takeStashedItem<ModelItem>(path)
  if (stashed) {
    openItem.value = stashed
    return
  }
  const fileName = (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
  try {
    const page = await api.list({ page: 1, pageSize: 50, search: fileName })
    const match = page.items.find((item) => item.file_path === path)
    if (match) openItem.value = match
    else void router.replace({ query: { ...route.query, open: undefined } })
  } catch {
    /* the grid still works; the deep link is just ignored */
  }
}

// Deep links: ?q= prefills the local search, ?tag= adds a tag filter (both are
// consumed), ?open= opens the drawer and is kept in sync with it.
watch(
  () => [route.query.q, route.query.tag, route.query.open],
  () => {
    const consumed: Record<string, undefined> = {}
    if (route.query.q !== undefined) {
      commitSearch(queryParam(route.query.q))
      consumed.q = undefined
    }
    const tag = queryParam(route.query.tag)
    if (route.query.tag !== undefined) {
      if (tag) filters.include('tags', tag)
      consumed.tag = undefined
    }
    const open = queryParam(route.query.open)
    if (open && openItem.value?.file_path !== open) void openByPath(open)
    if (Object.keys(consumed).length) void router.replace({ query: { ...route.query, ...consumed } })
  },
  { immediate: true },
)

watch(openItem, (item) => {
  const current = queryParam(route.query.open)
  const next = item?.file_path ?? ''
  if (current !== next) void router.replace({ query: { ...route.query, open: next || undefined } })
})

// --- Drawer prev/next: steps through the list as currently displayed (filters, sort, search applied) ---

const drawerNav = computed(() =>
  computeNav(
    list.items.value.map((item) => item.file_path),
    openItem.value?.file_path,
    { total: list.total.value, hasMore: list.hasMore.value && !list.error.value },
  ),
)
// Neighbours' preview images are warmed by the drawer (images only, never metadata).
const drawerPrefetch = computed(() => {
  const nav = drawerNav.value
  if (!nav) return []
  return [list.items.value[nav.index - 1], list.items.value[nav.index + 1]]
    .map((item) => item?.preview_url ?? '')
    .filter((url) => url && !isVideoUrl(url))
})

/** Steps are queued: rapid presses each move one model from where the previous one ended, even while a page loads. */
let navigating: Promise<void> = Promise.resolve()

function navigateDrawer(direction: NavDirection): void {
  navigating = navigating.then(() => stepDrawer(direction)).catch(() => undefined)
}

async function stepDrawer(direction: NavDirection): Promise<void> {
  const current = openItem.value
  if (!current) return
  const keys = () => list.items.value.map((item) => item.file_path)
  let index = keys().indexOf(current.file_path)
  if (index < 0) return
  if (direction === 'next' && index === list.items.value.length - 1 && list.hasMore.value) {
    // End of the loaded items: fetch the next page of the infinite scroll and keep going.
    await list.loadMore()
    await until(list.loading).toBe(false)
    if (list.error.value) toasts.error(list.error.value)
    index = keys().indexOf(current.file_path)
  }
  const target = list.items.value[direction === 'next' ? index + 1 : index - 1]
  if (!target || index < 0) return
  openItem.value = target
  grid.value?.scrollToIndex(index + (direction === 'next' ? 1 : -1))
}

function onUpdated(updated: ModelItem): void {
  list.updateItem((item) => item.file_path === updated.file_path, () => updated)
  if (openItem.value?.file_path === updated.file_path) openItem.value = updated
}

async function toggleFavorite(item: ModelItem): Promise<void> {
  const next = !item.favorite
  try {
    await api.saveMetadata(item.file_path, { favorite: next })
    onUpdated({ ...item, favorite: next })
    toasts.success(t(next ? 'detail.favoriteOn' : 'detail.favoriteOff'))
  } catch (error) {
    toasts.error((error as Error).message)
  }
}

function filterByTag(tag: string): void {
  filters.include('tags', tag)
  openItem.value = null
}

function sendToComfy(item: ModelItem, replace: boolean): void {
  void workflow.sendLora(item, { mode: replace ? 'replace' : 'append' })
}

function toggleSelect(item: ModelItem): void {
  const next = new Set(selected.value)
  if (next.has(item.file_path)) next.delete(item.file_path)
  else next.add(item.file_path)
  selected.value = next
}

function setSelectionMode(value: boolean): void {
  selectionMode.value = value
  if (!value) selected.value = new Set()
}

const loadedKeys = () => list.items.value.map((item) => item.file_path)
const selectedItems = computed(() => list.items.value.filter((item) => selected.value.has(item.file_path)))

function selectAllLoaded(): void {
  selected.value = new Set(loadedKeys())
}

function invertSelected(): void {
  selected.value = invertSelection(selected.value, loadedKeys())
}

// Ctrl/Cmd+A selects every loaded card while selection mode is on (not inside text fields or dialogs).
useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  if (!selectionMode.value || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"], dialog[open]') || openItem.value) return
  event.preventDefault()
  selectAllLoaded()
})

async function copySelectedNames(): Promise<void> {
  const names = selectedItems.value.map((item) => item.file_name)
  if (await copyText(names.join('\n'))) toasts.success(t('common.copied'))
  else toasts.error(t('common.copyFailed'))
}

// --- Model management actions ------------------------------------------------

function refreshFolders(): void {
  api.folderTree().then((value) => (tree.value = value)).catch(() => undefined)
}

const actions = useModelActions(api, {
  removed: (paths) => {
    const gone = new Set(paths)
    list.removeWhere((item) => gone.has(item.file_path))
    selected.value = pruneSelection(selected.value, paths)
    if (openItem.value && gone.has(openItem.value.file_path)) openItem.value = null
  },
  changed: () => {
    grid.value?.scrollToTop()
    // Paths changed (rename/move/undo): keep only selected keys that still exist.
    void list.reset().then(() => {
      const present = new Set(loadedKeys())
      selected.value = new Set([...selected.value].filter((key) => present.has(key)))
    })
    refreshFolders()
  },
  moved: (moves) => {
    // Keep an open drawer on the moved model (its path and folder changed).
    const current = openItem.value
    const move = current && moves.find((entry) => entry.from === current.file_path)
    if (!current || !move) return
    const dir = move.to.replace(/\/[^/]*$/, '')
    const oldDir = current.file_path.replace(/\/[^/]*$/, '')
    const root = current.folder && oldDir.endsWith(`/${current.folder}`) ? oldDir.slice(0, -current.folder.length - 1) : oldDir
    const folder = dir.toLowerCase().startsWith(root.toLowerCase() + '/') ? dir.slice(root.length + 1) : dir === root ? '' : current.folder
    openItem.value = { ...current, file_path: move.to, folder }
  },
})

// --- Phase B1: download dialog and model tools -------------------------------

const tools = useModelTools(api, {
  updated: onUpdated,
  changed: () => {
    grid.value?.scrollToTop()
    void list.reset()
    refreshFolders()
  },
})

const downloadInput = ref<string | null>(null)
const duplicatesOpen = ref(false)
const excludedOpen = ref(false)
const previewTarget = ref<{ item: ModelItem; mode: 'preview' | 'rating' } | null>(null)
const relinkTarget = ref<ModelItem | null>(null)
const templateTarget = ref<{ scope: TemplateScope; label: string } | null>(null)
const folderDialog = ref<{ mode: 'create' | 'rename'; locations: string[]; currentName?: string } | null>(null)

const template = computed(() => {
  const templates = settings.value?.download_path_templates
  return templates && typeof templates === 'object' ? String((templates as Record<string, unknown>)[config.singular] ?? '') : ''
})

const filenameTemplate = computed(() => {
  const templates = settings.value?.download_filename_templates
  return templates && typeof templates === 'object' ? String((templates as Record<string, unknown>)[config.singular] ?? '') : ''
})

const toolItems = computed<MenuEntry[]>(() => [
  { id: 'download', label: t('download.open'), icon: 'download' },
  { id: 'duplicates', label: t('tools.duplicates'), icon: 'files' },
  { id: 'excluded', label: t('tools.excluded'), icon: 'eyeOff' },
  { id: 'fetchAll', label: t('tools.fetchAll.open'), icon: 'refresh' },
])

function runTool(id: string): void {
  if (id === 'download') downloadInput.value = ''
  else if (id === 'duplicates') duplicatesOpen.value = true
  else if (id === 'excluded') excludedOpen.value = true
  else if (id === 'fetchAll') void tools.fetchAll(t(config.title))
}

const folderLabel = computed(() => state.folder.split('/').pop() ?? state.folder)
const folderItems = computed<MenuEntry[]>(() => [
  { id: 'create', label: t('folders.new'), icon: 'folderPlus' },
  { id: 'rename', label: t('folders.rename'), icon: 'pencil', disabled: !state.folder },
  { id: 'template', label: t('folders.template'), icon: 'type', disabled: !state.folder },
  { id: 'delete', label: t('folders.delete'), icon: 'trash', danger: true, disabled: !state.folder },
])

/** Absolute paths of the selected folder (one per root that holds it). */
async function folderCandidates(): Promise<string[] | null> {
  try {
    const candidates = await api.resolveFolder(state.folder)
    if (!candidates.length) {
      toasts.error(t('folders.refused.missing', { name: folderLabel.value }))
      return null
    }
    return candidates.map((candidate) => candidate.folder_path)
  } catch (error) {
    toasts.error(t('folders.resolveFailed', { error: (error as Error).message }))
    return null
  }
}

async function runFolderAction(id: string): Promise<void> {
  if (id === 'create') {
    const locations = state.folder ? await folderCandidates() : await api.roots().catch(() => null)
    if (locations?.length) folderDialog.value = { mode: 'create', locations }
    return
  }
  if (!state.folder) {
    toasts.error(t('folders.noFolder'))
    return
  }
  const locations = await folderCandidates()
  if (!locations) return
  if (id === 'rename') folderDialog.value = { mode: 'rename', locations, currentName: folderLabel.value }
  else if (id === 'template') {
    templateTarget.value = { scope: { folderPaths: locations }, label: t('tools.template.scopeFolder', { folder: state.folder }) }
  } else if (id === 'delete') {
    if (locations.length > 1) {
      toasts.error(t('folders.refused.refused', { name: folderLabel.value, error: locations.join(', ') }))
      return
    }
    if (await tools.deleteFolder(locations[0], folderLabel.value)) state.folder = ''
  }
}

function onFolderDone(name: string): void {
  // A renamed selected folder keeps the selection on its new name.
  if (folderDialog.value?.mode === 'rename' && state.folder) {
    const parent = state.folder.includes('/') ? state.folder.slice(0, state.folder.lastIndexOf('/')) : ''
    state.folder = parent ? `${parent}/${name}` : name
  }
}

async function submitRelink(value: string): Promise<string | null> {
  const item = relinkTarget.value
  return item ? tools.relink(item, value) : null
}

const menu = ref<{ item: ModelItem; x: number; y: number; opener: HTMLElement | null } | null>(null)
const renameTarget = ref<ModelItem | null>(null)
const moveTargets = ref<ModelItem[] | null>(null)
const tagTargets = ref<ModelItem[] | null>(null)
const organizeOpen = ref(false)

function openMenu(item: ModelItem, point: { x: number; y: number }, opener: HTMLElement | null): void {
  menu.value = { item, ...point, opener }
}

function closeMenu(reason: 'escape' | 'outside' | 'select'): void {
  const opener = menu.value?.opener
  menu.value = null
  if (reason === 'escape') opener?.focus()
}

function runAction(action: ModelAction, item: ModelItem): void {
  if (action === 'rename') renameTarget.value = item
  else if (action === 'move') moveTargets.value = [item]
  else if (action === 'exclude') void actions.excludeItem(item)
  else if (action === 'template') {
    templateTarget.value = { scope: { filePaths: [item.file_path] }, label: item.model_name || item.file_name }
  } else if (action === 'preview' || action === 'rating') previewTarget.value = { item, mode: action }
  else if (action === 'refresh') void tools.refreshFromCivitai(item)
  else if (action === 'relink') relinkTarget.value = item
  else void actions.deleteItems([item])
}

const extensionOf = (item: ModelItem) => item.file_path.match(/(\.[^./\\]+)$/)?.[1] ?? ''

async function submitRename(value: string): Promise<string | null> {
  const item = renameTarget.value
  if (!item) return null
  const error = await actions.renameItem(item, value)
  if (!error && openItem.value?.file_path === item.file_path) {
    // Keep the drawer on the renamed model (the grid reloads behind it).
    const name = value.trim()
    const dir = item.file_path.slice(0, item.file_path.length - item.file_name.length - extensionOf(item).length)
    openItem.value = { ...item, file_name: name, file_path: `${dir}${name}${extensionOf(item)}` }
  }
  return error
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
}

async function submitTags(value: string): Promise<string | null> {
  const items = tagTargets.value ?? []
  await actions.addTags(items, parseTags(value))
  return null
}

function onMoveClosed(): void {
  moveTargets.value = null
}

function onOrganized(prefix: ModelPrefix): void {
  if (prefix === props.prefix) {
    reload()
    refreshFolders()
  }
}

function bulkSend(event: MouseEvent): void {
  void workflow.sendLoras(selectedItems.value, event.shiftKey ? 'replace' : 'append')
}
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <aside
      v-show="showFolders"
      :id="foldersId"
      ref="foldersPanel"
      class="w-[240px] flex-none overflow-y-auto hairline-r border-border bg-surface px-3 py-4 narrow:absolute narrow:inset-y-0 narrow:left-0 narrow:z-20 narrow:w-[min(300px,85vw)] narrow:shadow-lg"
      :aria-label="t('library.folders')"
    >
      <div class="mb-2 flex items-center justify-between">
        <h2 class="lm-overline text-sm">{{ t('library.folders') }}</h2>
        <div class="flex items-center gap-1">
          <MenuButton
            :label="t('folders.manage')"
            icon="more"
            compact
            align="right"
            button-class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm"
            :items="folderItems"
            @select="runFolderAction"
          />
          <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('library.hideFolders')" :title="t('library.hideFolders')" @click="folders.set(false)">
            <AppIcon name="close" :size="14" />
          </button>
        </div>
      </div>
      <button
        type="button"
        class="lm-row flex h-[30px] w-full cursor-pointer items-center gap-2 px-2 text-sm"
        :class="{ 'is-selected': !state.folder }"
        @click="state.folder = ''"
      >
        <AppIcon name="grid" :size="15" />{{ t('library.allFolders') }}
      </button>
      <FolderTree :tree="tree" :selected="state.folder" @select="selectFolder" />
    </aside>

    <section class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div class="lm-toolbar pb-3 phone:pb-2">
        <div class="lm-toolbar-title">
          <h1>{{ t(config.title) }}</h1>
          <span class="text-sm text-muted tabular-nums" aria-live="polite">{{ t('library.count', { count: list.total.value.toLocaleString() }) }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2 phone:w-full">
          <SearchCombobox
            :id="`library-search-${prefix}`"
            v-model="searchText"
            :scope="prefix"
            class="w-[260px] narrow:w-[200px] phone:w-full"
            :label="t('library.search', { section: t(config.title) })"
            :placeholder="t('library.searchPlaceholder', { section: t(config.title) })"
            :max-per-group="LOCAL_PER_GROUP"
            :max-tags="MAX_TAGS"
            :active-tags="state.tags"
            panel-class="left-0 top-[calc(100%+var(--lm-space-1))] w-[min(420px,calc(100vw-24px))] phone:right-0 phone:w-auto"
            @commit="commitSearch"
            @choose="onSearchChoose"
          />
          <button
            ref="foldersToggle"
            type="button"
            class="lm-btn"
            :class="{ 'lm-chip--active': showFolders }"
            :aria-expanded="showFolders"
            :aria-controls="foldersId"
            :title="t(showFolders ? 'library.hideFolders' : 'library.showFolders')"
            @click="folders.toggle()"
          >
            <AppIcon name="folder" :size="16" /><span class="phone:sr-only">{{ t('library.folders') }}</span>
            <span v-if="state.folder && !showFolders" class="size-[6px] rounded-pill bg-accent" aria-hidden="true"></span>
          </button>
          <label class="sr-only" :for="`sort-${prefix}`">{{ t('library.sort') }}</label>
          <select :id="`sort-${prefix}`" v-model="filters.sort.value" class="lm-select w-auto min-w-[150px] phone:min-w-0 phone:flex-1">
            <option v-for="option in config.sortOptions" :key="option.value" :value="option.value">{{ t(option.label) }}</option>
          </select>
          <button type="button" class="lm-btn" :aria-expanded="showFilters" aria-controls="library-filters" @click="showFilters = !showFilters">
            <AppIcon name="filter" :size="16" /><span class="phone:sr-only">{{ t('library.filters') }}</span>
            <span v-if="filters.panelCount.value" class="lm-badge lm-badge--accent">{{ filters.panelCount.value }}</span>
          </button>
          <label class="inline-flex items-center gap-2 px-2 text-muted phone:hidden">
            <span class="sr-only">{{ t('library.cardSize') }}</span>
            <AppIcon name="grid" :size="16" />
            <input
              v-model.number="filters.cardSize.value"
              class="w-[110px] accent-accent"
              type="range"
              :min="CARD_SIZE_MIN"
              :max="CARD_SIZE_MAX"
              step="10"
              :aria-label="t('library.cardSize')"
            />
          </label>
          <button type="button" class="lm-btn" @click="organizeOpen = true">
            <AppIcon name="wand" :size="16" /><span class="phone:sr-only">{{ t('organize.open') }}</span>
          </button>
          <MenuButton :label="t('tools.menu')" icon="wrench" align="right" :items="toolItems" @select="runTool" />
          <button type="button" class="lm-btn" :aria-pressed="selectionMode" @click="setSelectionMode(!selectionMode)">
            <AppIcon :name="selectionMode ? 'check' : 'checkSquare'" :size="16" />
            <span class="phone:sr-only">{{ selectionMode ? t('library.selectDone') : t('library.select') }}</span>
          </button>
        </div>
      </div>

      <BaseModelQuickFilter
        v-if="config.quickBaseModels > 0"
        :entries="baseModels"
        :selected="state.baseModels"
        :limit="config.quickBaseModels"
        :id-prefix="prefix"
        @toggle="filters.toggle('baseModels', $event)"
        @clear="filters.clearList('baseModels')"
      />

      <div v-if="showFilters" id="library-filters" class="lm-panel mx-6 mb-3 grid gap-4 p-4 phone:mx-3">
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
          </div>
        </div>
        <div class="flex flex-wrap gap-4">
          <label><input v-model="state.favoritesOnly" class="accent-accent" type="checkbox" /> {{ t('library.favoritesOnly') }}</label>
          <label v-if="config.supportsUpdates"><input v-model="state.updatesOnly" class="accent-accent" type="checkbox" /> {{ t('library.updatesOnly') }}</label>
        </div>
      </div>

      <div v-if="filters.chips.value.length" class="flex flex-wrap items-center gap-2 px-6 pb-3 phone:px-3" :aria-label="t('library.filters')">
        <span v-for="chip in filters.chips.value" :key="chip.key" class="lm-chip lm-chip--active">
          {{ chip.label }}
          <button type="button" class="lm-icon-btn" :aria-label="t('library.removeFilter', { name: chip.label })" @click="chip.remove()">
            <AppIcon name="close" :size="12" />
          </button>
        </span>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm" @click="filters.clear()">{{ t('library.clearFilters') }}</button>
      </div>

      <div
        v-if="selectionMode"
        class="mx-6 mb-3 flex flex-wrap items-center gap-2 rounded-md bg-accent-soft px-3 py-2 phone:mx-3"
        role="toolbar"
        :aria-label="t('selection.toolbar', { count: selected.size })"
      >
        <strong class="tabular-nums" aria-live="polite">{{ t('library.selected', { count: selected.size }) }}</strong>
        <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="t('library.select')">
          <button type="button" class="lm-btn lm-btn--sm" :title="t('selection.hint')" @click="selectAllLoaded">{{ t('selection.all') }}</button>
          <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="selected = new Set()">{{ t('selection.none') }}</button>
          <button type="button" class="lm-btn lm-btn--sm" :disabled="!list.items.value.length" @click="invertSelected">{{ t('selection.invert') }}</button>
        </div>
        <span class="mx-1 h-[20px] hairline-l border-border-strong phone:hidden" aria-hidden="true"></span>
        <div class="flex flex-wrap items-center gap-1">
          <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="moveTargets = selectedItems">
            <AppIcon name="folderMove" :size="14" />{{ t('selection.move') }}
          </button>
          <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="tagTargets = selectedItems">
            <AppIcon name="tag" :size="14" />{{ t('selection.tags') }}
          </button>
          <button
            v-if="config.sendToComfy"
            type="button"
            class="lm-btn lm-btn--sm"
            :disabled="!selected.size"
            :title="t('card.sendHint')"
            @click="bulkSend"
          >
            <AppIcon name="send" :size="14" />{{ t('selection.send') }}
          </button>
          <button
            type="button"
            class="lm-btn lm-btn--sm"
            :disabled="!selected.size"
            @click="templateTarget = { scope: { filePaths: selectedItems.map((item) => item.file_path) }, label: t('tools.template.scopeFiles', { count: selectedItems.length }) }"
          >
            <AppIcon name="type" :size="14" />{{ t('selection.template') }}
          </button>
          <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="copySelectedNames">
            <AppIcon name="copy" :size="14" />{{ t('selection.copyNames') }}
          </button>
          <button type="button" class="lm-btn lm-btn--sm lm-btn--danger" :disabled="!selected.size" @click="actions.deleteItems(selectedItems)">
            <AppIcon name="trash" :size="14" />{{ t('selection.delete') }}
          </button>
        </div>
      </div>

      <StateBlock v-if="list.error.value && !list.items.value.length" kind="error" :message="list.error.value" @retry="reload" />
      <StateBlock v-else-if="list.loaded.value && !list.items.value.length" kind="empty" :message="t('library.empty')" />
      <div
        v-else-if="!list.loaded.value"
        class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-card overflow-hidden px-6 phone:px-3"
        aria-hidden="true"
      >
        <div v-for="n in 12" :key="n" class="lm-skeleton aspect-card rounded-md"></div>
      </div>

      <VirtualGrid
        v-show="list.items.value.length"
        ref="grid"
        :items="list.items.value"
        :item-key="(item: ModelItem) => item.file_path"
        :min-item-width="filters.cardSize.value"
        :label="t(config.title)"
        @reach-end="list.loadMore()"
      >
        <template #default="{ item }">
          <ModelCard
            :item="item"
            :selection-mode="selectionMode"
            :selected="selected.has(item.file_path)"
            :blur-mature="blurMature"
            :can-send="config.sendToComfy"
            @open="openItem = $event"
            @send="sendToComfy"
            @toggle-select="toggleSelect"
            @toggle-favorite="toggleFavorite"
            @menu="openMenu"
          />
        </template>
        <template #footer>
          <p v-if="list.loading.value && list.items.value.length" class="mt-4 flex items-center justify-center gap-2 text-sm text-muted">
            {{ t('library.loadMore') }}
          </p>
          <p v-else-if="list.error.value && list.items.value.length" class="mt-4 flex items-center justify-center gap-2 text-sm">
            <span class="lm-error-text">{{ list.error.value }}</span>
            <button type="button" class="lm-btn lm-btn--sm" @click="list.loadMore()">{{ t('common.retry') }}</button>
          </p>
        </template>
      </VirtualGrid>
    </section>

    <ModelDrawer
      v-if="openItem"
      :item="openItem"
      :api="api"
      :classic-url="classicUrl"
      :civitai-host="civitaiHost"
      :can-send="config.sendToComfy"
      :blur-mature="blurMature"
      :nav="drawerNav"
      :prefetch="drawerPrefetch"
      @close="openItem = null"
      @navigate="navigateDrawer"
      @filter-tag="filterByTag"
      @updated="onUpdated"
      @action="runAction($event, openItem!)"
      @download="downloadInput = $event"
    />

    <ModelActionMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :label="t('actions.menu', { name: menu.item.model_name || menu.item.file_name })"
      @select="runAction($event as ModelAction, menu!.item)"
      @close="closeMenu"
    />
    <InputDialog
      v-if="renameTarget"
      :title="t('actions.rename.title')"
      :label="t('actions.rename.label')"
      :hint="t('actions.rename.hint', { ext: extensionOf(renameTarget) || '.safetensors' })"
      :initial="renameTarget.file_name"
      :confirm-label="t('actions.rename.confirm')"
      :validate="(value) => { const key = validateFileName(value, renameTarget!.file_name); return key ? t(key) : null }"
      :submit="submitRename"
      @close="renameTarget = null"
    />
    <InputDialog
      v-if="tagTargets"
      :title="t('actions.tags.title', { count: tagTargets.length })"
      :label="t('actions.tags.label')"
      :hint="t('actions.tags.hint')"
      initial=""
      :confirm-label="t('actions.tags.confirm')"
      :validate="(value) => (parseTags(value).length ? null : t('actions.tags.errorEmpty'))"
      :submit="submitTags"
      @close="tagTargets = null"
    />
    <MoveDialog
      v-if="moveTargets"
      :items="moveTargets"
      :api="api"
      :actions="actions"
      :default-root="String(settings?.[`default_${config.singular}_root`] ?? '')"
      :template="template"
      @close="onMoveClosed"
    />
    <OrganizeDialog v-if="organizeOpen" :prefix="prefix" @close="organizeOpen = false" @organized="onOrganized" />
    <DownloadDialog v-if="downloadInput !== null" :prefix="prefix" :initial-input="downloadInput" @close="downloadInput = null" />
    <DuplicatesDialog
      v-if="duplicatesOpen"
      :api="api"
      :actions="actions"
      :blur-mature="blurMature"
      @close="duplicatesOpen = false"
      @open="(item) => { duplicatesOpen = false; openItem = item }"
    />
    <ExcludedDialog v-if="excludedOpen" :api="api" :tools="tools" @close="excludedOpen = false" />
    <PreviewDialog v-if="previewTarget" :item="previewTarget.item" :mode="previewTarget.mode" :tools="tools" @close="previewTarget = null" />
    <InputDialog
      v-if="relinkTarget"
      :title="t('tools.relink.title')"
      :label="t('tools.relink.label')"
      :hint="t('tools.relink.hint')"
      initial=""
      :confirm-label="t('tools.relink.confirm')"
      :validate="(value) => (value.trim() ? null : t('tools.relink.invalid'))"
      :submit="submitRelink"
      @close="relinkTarget = null"
    />
    <TemplateDialog
      v-if="templateTarget"
      :tools="tools"
      :scope="templateTarget.scope"
      :scope-label="templateTarget.label"
      :template="filenameTemplate"
      @close="templateTarget = null"
    />
    <FolderDialog
      v-if="folderDialog"
      :mode="folderDialog.mode"
      :locations="folderDialog.locations"
      :current-name="folderDialog.currentName"
      :tools="tools"
      @done="onFolderDone"
      @close="folderDialog = null"
    />
  </div>
</template>
