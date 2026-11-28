<script setup lang="ts">
/**
 * Generic model library (LoRAs, checkpoints, embeddings): folder tree,
 * filters, virtualised card grid or list, the quick-view panel, the
 * selection with the floating bulk bar and the detail drawer.
 *
 * Keyboard: the grid is one tab stop (VirtualGrid + useGridKeyboard moves the
 * focus); on a focused card Space selects, Enter opens, S sends, C copies the
 * syntax, F toggles the favourite and Delete deletes (the selection when the
 * card is part of it). D opens the download dialog, Alt+letter the alphabet.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { until, useEventListener, useLocalStorage, useMediaQuery, useTimeoutFn } from '@vueuse/core'
import AlphabetBar from '@/components/AlphabetBar.vue'
import AppIcon from '@/components/AppIcon.vue'
import BaseModelQuickFilter from '@/components/BaseModelQuickFilter.vue'
import DownloadDialog from '@/components/DownloadDialog.vue'
import DuplicatesDialog from '@/components/DuplicatesDialog.vue'
import ExcludedDialog from '@/components/ExcludedDialog.vue'
import FolderBreadcrumb from '@/components/FolderBreadcrumb.vue'
import FolderDialog from '@/components/FolderDialog.vue'
import FolderPanel from '@/components/FolderPanel.vue'
import ListHeader from '@/components/ListHeader.vue'
import MenuButton, { type MenuEntry } from '@/components/MenuButton.vue'
import PreviewDialog from '@/components/PreviewDialog.vue'
import TemplateDialog from '@/components/TemplateDialog.vue'
import InputDialog from '@/components/InputDialog.vue'
import ModelActionMenu, { type ModelAction } from '@/components/ModelActionMenu.vue'
import ModelCard from '@/components/ModelCard.vue'
import ModelRow from '@/components/ModelRow.vue'
import ModelDrawer from '@/components/ModelDrawer.vue'
import ModelInspector from '@/components/ModelInspector.vue'
import { cardTextLines, type CardDisplay } from '@/components/modelItemView'
import MoveDialog from '@/components/MoveDialog.vue'
import OrganizeDialog from '@/components/OrganizeDialog.vue'
import LibraryFilterPanel, { type FilterGroup } from '@/components/LibraryFilterPanel.vue'
import LibrarySelectionBar from '@/components/LibrarySelectionBar.vue'
import LibraryToolbar from '@/components/LibraryToolbar.vue'
import StateBlock from '@/components/StateBlock.vue'
import VirtualGrid from '@/components/VirtualGrid.vue'
import { cardTextHeight, type VirtualGridExposed } from '@/utils/gridLayout'
import { createModelApi } from '@/api/endpoints'
import type { CountEntry, FolderTree as FolderTreeData, ModelItem, ModelPrefix, TagEntry } from '@/api/types'
import { LIBRARIES } from '@/config/libraries'
import { SHORTCUTS } from '@/config/shortcuts'
import { GRID_PRIMARY, gridKeyOf } from '@/composables/useGridKeyboard'
import { useAppSettings } from '@/composables/useAppSettings'
import { useDismissLayer } from '@/composables/useDismiss'
import { copyText, useConfirm, useToasts } from '@/composables/useFeedback'
import { useFolderPanel } from '@/composables/useFolderPanel'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { useLibraryFilters } from '@/composables/useLibraryFilters'
import { usePageActions } from '@/composables/usePageActions'
import { usePageStatus } from '@/composables/usePageStatus'
import { useRefresh, useRefreshHandler, type RefreshContext } from '@/composables/useRefresh'
import { scanBeforeRefresh } from '@/composables/useLibraryScan'
import { runLibraryScan } from '@/utils/libraryScan'
import { systemApi } from '@/api/maintenance'
import { takeStashedItem } from '@/composables/useSearch'
import { queryParam } from '@/config/navigation'
import type { SuggestOption } from '@/utils/suggest'
import { useSendToWorkflow } from '@/composables/useSendToWorkflow'
import { useModelActions, type VersionFileTarget } from '@/composables/useModelActions'
import { useModelTools } from '@/composables/useModelTools'
import type { TemplateScope } from '@/api/endpoints'
import { sortBaseModels } from '@/utils/baseModelChips'
import { computeNav, type NavDirection } from '@/utils/drawerNav'
import { isVideoUrl } from '@/utils/format'
import { refreshInPlace } from '@/utils/refreshList'
import { altLetter, clearBrowseView, emptyStateKind, RESTORE_MAX_ITEMS, saveBrowseView, shouldHandleShortcut, takeBrowseView, unfilteredTotal, type BrowseViewState } from '@/utils/browse'
import { rekaLayerOpen } from '@/utils/dismiss'
import { hiddenSelectedCount, invertSelection, pruneSelection, selectRange, validateFileName } from '@/utils/modelActions'
import { withMountPrefix } from '@/utils/basePath'
import type { MenuPoint } from '@/composables/useCardInteractions'
import { createFolderActions, type FolderDialogRequest } from '@/utils/folderActions'
import {
  folderMenu,
  itemMenu,
  pageMenu,
  renamedFolderPath,
  runItemMenuAction,
  runSelectionMenuAction,
  selectionMenu,
  type ItemMenuDeps,
  type SelectionMenuDeps,
} from '@/utils/menuItems'
import { t, type MessageKey } from '@/i18n'

const props = defineProps<{ prefix: ModelPrefix }>()

const PAGE_SIZE = 60
const config = LIBRARIES[props.prefix]
const api = createModelApi(props.prefix)
const classicUrl = withMountPrefix(`/${config.classicPath}`)
const toasts = useToasts()
const { confirm } = useConfirm()
const route = useRoute()
const router = useRouter()
const { settings, load: loadSettings } = useAppSettings()
const filters = useLibraryFilters(config)
const { state } = filters

// Filters, search, folder and scroll survive a tab switch; a real deep link starts clean.
const deepLinked = route.query.q !== undefined || route.query.tag !== undefined || route.query.open !== undefined || route.query.folder !== undefined
if (deepLinked) clearBrowseView(props.prefix)
const restored = takeBrowseView(props.prefix)
if (restored) filters.restore(restored)
const folders = useFolderPanel(props.prefix)
const showFolders = folders.open
const foldersId = `folders-${props.prefix}`
const folderPanel = ref<InstanceType<typeof FolderPanel> | null>(null)
const foldersPanel = () => folderPanel.value?.root ?? null
const toolbar = ref<InstanceType<typeof LibraryToolbar> | null>(null)
const foldersToggle = () => toolbar.value?.foldersToggle ?? null
// On narrow viewports the folder panel overlays the grid: outside pointerdown or Escape closes it.
useDismissLayer({
  active: () => showFolders.value && folders.isOverlay(),
  close: (reason) => {
    folders.set(false)
    if (reason === 'escape') foldersToggle()?.focus()
  },
  outside: () => [foldersPanel(), foldersToggle()],
})
const workflow = useSendToWorkflow()

const list = useInfiniteList<ModelItem>((page, signal) =>
  api.list({ page, pageSize: PAGE_SIZE, ...filters.modelQuery(config.alphabet) }, signal),
)

const grid = ref<VirtualGridExposed | null>(null)
const drawer = ref<{ refresh(): Promise<void>; reloadVersions(): Promise<void> } | null>(null)
const tree = shallowRef<FolderTreeData>({})
const baseModels = ref<CountEntry[]>([])
const topTags = ref<TagEntry[]>([])
const modelTypes = ref<CountEntry[]>([])
const openItem = ref<ModelItem | null>(null)
// One selection: Ctrl/Cmd+click, Shift+click and Space select without a mode switch; the Select button (or B)
// shows the bulk bar before anything is selected. The bar shows while either is the case.
const selecting = ref(false)
const selected = ref<Set<string>>(new Set())
const selectionMode = computed(() => selecting.value || selected.value.size > 0)

const blurMature = computed(() => !!settings.value?.blur_mature_content)
const civitaiHost = computed(() => String(settings.value?.civitai_host || 'civitai.com'))

// View options that reach the cards; the grid adds the text lines under the image to every cell.
const cardDisplay = computed<CardDisplay>(() => ({ ...filters.show.value, fit: filters.fit.value }))
const cardExtraHeight = computed(() => cardTextHeight(cardTextLines(cardDisplay.value)))
const cardAspect = computed(() => (filters.shape.value === 'square' ? 1 : undefined))

/** Mature previews the user revealed on this visit ("Show" on a blurred card). */
const revealed = ref<Set<string>>(new Set())

function toggleReveal(item: ModelItem): void {
  const next = new Set(revealed.value)
  if (!next.delete(item.file_path)) next.add(item.file_path)
  revealed.value = next
}

// Quick view: on by default, shown from 1280px on devices with a mouse. While it shows, a click focuses a
// card (the panel follows) and a double-click or Enter opens the drawer; otherwise a click opens the drawer.
// `focusedKey` is also the grid's keyboard cursor (its one tab stop), so the panel follows the arrow keys.
const inspectorOn = useLocalStorage('lm-ui.inspector', true, { writeDefaults: false })
const inspectorFits = useMediaQuery('(min-width: 1280px) and (hover: hover)')
const inspectorVisible = computed(() => inspectorOn.value && inspectorFits.value)
const focusedKey = ref<string | null>(null)
const focusedItem = computed(() => (focusedKey.value ? (list.items.value.find((item) => item.file_path === focusedKey.value) ?? null) : null))

/** Deleting a filter preset offers Undo. */
function deletePreset(name: string): void {
  const removed = filters.deletePreset(name)
  if (removed) toasts.push(t('filters.presetDeleted', { name }), 'info', 7000, { label: t('actions.undo'), run: () => filters.restorePreset(removed) })
}

/** Checkbox groups of the Filters flyout (the optional base-model row repeats the first one). */
const filterGroups = computed<FilterGroup[]>(() => [
  { field: 'baseModels', title: 'library.baseModels', entries: sortBaseModels(baseModels.value) },
  { field: 'tags', title: 'library.tags', entries: topTags.value.map((entry) => ({ name: entry.tag, count: entry.count })) },
  ...(modelTypes.value.length ? [{ field: 'modelTypes' as const, title: 'filters.modelType' as MessageKey, entries: modelTypes.value }] : []),
])

// "N of total" while filtered: the total is the count seen the last time nothing was filtered.
const knownTotal = ref<number | null>(restored?.knownTotal ?? null)
watch(
  () => [list.loaded.value, list.total.value, filters.chips.value.length] as const,
  ([loaded, total, chips]) => {
    if (loaded && !chips) knownTotal.value = total
  },
  { immediate: true },
)
const countText = computed(() => {
  const count = list.total.value
  const all = unfilteredTotal(count, knownTotal.value, filters.chips.value.length > 0)
  return all === null
    ? t('library.count', { count: count.toLocaleString() })
    : t('library.countOf', { count: count.toLocaleString(), total: all.toLocaleString() })
})

function reload(): void {
  grid.value?.scrollToTop()
  void list.reset()
}

watch(filters.signature, reload)

async function restoreScroll(view: BrowseViewState): Promise<void> {
  // The list restarts at page 1: load as many pages as were loaded before, then jump back.
  for (let guard = 0; guard < 20 && list.hasMore.value && !list.error.value && list.items.value.length < Math.min(view.loadedCount, RESTORE_MAX_ITEMS); guard++) {
    await list.loadMore()
  }
  await nextTick()
  grid.value?.scrollTo(view.scrollTop)
}

usePageStatus(() => ({ count: countText.value, selected: selected.value.size }))

// Empty results: which state to show; a library scan in progress on an empty list shows the skeleton instead.
const refreshState = useRefresh()
const scanning = computed(() => refreshState.phase.value === 'scanning' && !list.items.value.length)
const showSkeleton = computed(() => (!list.loaded.value && !list.error.value) || scanning.value)
const emptyKind = computed(() => emptyStateKind(filters.chips.value.map((chip) => chip.key)))

onBeforeUnmount(() => {
  saveBrowseView(props.prefix, {
    ...filters.browseFilters(),
    missingOnly: false,
    scrollTop: grid.value?.scrollOffset() ?? 0,
    loadedCount: list.items.value.length,
    knownTotal: knownTotal.value,
  })
})

/** Folder tree, base-model chips and tag filters: failures keep the previous data (as on the first load). */
function loadSecondary(): Promise<unknown> {
  return Promise.allSettled([
    api.folderTree().then((value) => (tree.value = value)),
    api.baseModels(100).then((value) => (baseModels.value = value)),
    api.topTags(40).then((value) => (topTags.value = value)),
    api.modelTypes().then((value) => (modelTypes.value = value.map((entry) => ({ name: entry.type, count: entry.count })))),
  ])
}

onMounted(() => {
  void list.reset().then(() => (restored ? restoreScroll(restored) : undefined))
  void loadSettings()
  void loadSecondary()
})

// --- Refresh (toolbar button, `r`, tab visible again): re-read in place, keep filters, sort, folder,
// selection, scroll and the open drawer. A manual refresh first runs the quick library rescan
// (GET /api/lm/<prefix>/scan) so files added or removed outside LoRA Manager show up; the silent
// tab-return refresh only re-reads.
const REFRESH_MAX_PAGES = Math.ceil(RESTORE_MAX_ITEMS / PAGE_SIZE)

async function refreshPage(context: RefreshContext): Promise<void> {
  await scanBeforeRefresh(context, { initStatus: () => systemApi.initStatus(props.prefix), scan: () => api.scan() })
  const secondary = loadSecondary()
  await refreshInPlace(list, grid.value, (item) => item.file_path, REFRESH_MAX_PAGES)
  // The open drawer shows the refreshed copy of its model (when it is among the loaded items) and re-reads its metadata.
  const open = openItem.value
  const fresh = open && list.items.value.find((item) => item.file_path === open.file_path)
  if (fresh) openItem.value = fresh
  await Promise.all([secondary, drawer.value?.refresh()])
}

useRefreshHandler({ run: refreshPage, onVisible: true })

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

// Deep links: ?q= prefills the local search, ?tag= adds a tag filter, ?folder= selects a
// folder (command palette; these are consumed), ?open= opens the drawer and is kept in sync with it.
watch(
  () => [route.query.q, route.query.tag, route.query.open, route.query.folder],
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
    if (route.query.folder !== undefined) {
      state.folder = queryParam(route.query.folder)
      consumed.folder = undefined
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

/** Copy / send use the model's usage-tip strength unless the quick view's stepper passes another one. */
function copySyntax(item: ModelItem, strength?: number): void {
  void workflow.copyLora(item, { strength })
}

function filterByTag(tag: string): void {
  filters.include('tags', tag)
  openItem.value = null
}

function sendToComfy(item: ModelItem, replace: boolean, strength?: number): void {
  void workflow.sendLora(item, { mode: replace ? 'replace' : 'append', strength })
}

/** Last toggled card: the start of a Shift+click range. */
let anchor: string | null = null

function toggleSelect(item: ModelItem, range = false): void {
  const key = item.file_path
  const next = new Set(selected.value)
  if (range && anchor) for (const inRange of selectRange(loadedKeys(), anchor, key)) next.add(inRange)
  else if (next.has(key)) next.delete(key)
  else next.add(key)
  anchor = key
  selected.value = next
}

function setSelectionMode(value: boolean): void {
  selecting.value = value
  anchor = null
  if (!value) selected.value = new Set()
}

/** "None" in the bulk bar: keeps the bar open. */
function selectNone(): void {
  selecting.value = true
  selected.value = new Set()
}

// Escape clears the selection (only when no drawer, dialog or menu is above it: those close first).
useDismissLayer({ active: () => selectionMode.value, close: () => setSelectionMode(false) })

const loadedKeys = () => list.items.value.map((item) => item.file_path)
const hiddenSelected = computed(() => hiddenSelectedCount(selected.value, loadedKeys()))
const selectedItems = computed(() => list.items.value.filter((item) => selected.value.has(item.file_path)))

function selectAllLoaded(): void {
  selected.value = new Set(loadedKeys())
}

function invertSelected(): void {
  selected.value = invertSelection(selected.value, loadedKeys())
}

// Page keys outside the grid: D opens the download dialog, Alt+letter picks the alphabet letter (LoRAs).
useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  const overlay = rekaLayerOpen()
  if (shouldHandleShortcut(event, 'd', overlay)) {
    event.preventDefault()
    downloadInput.value = ''
    return
  }
  const letter = config.alphabet ? altLetter(event, overlay) : null
  if (letter) {
    event.preventDefault()
    state.letter = state.letter === letter ? '' : letter
  }
})

// Ctrl/Cmd+A selects every loaded card and shows the bulk bar (not inside text fields, menus or dialogs).
useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'a' || !list.items.value.length) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"], dialog[open], [role="dialog"]') || openItem.value || rekaLayerOpen()) return
  event.preventDefault()
  selecting.value = true
  selectAllLoaded()
})

async function copySelectedNames(): Promise<void> {
  const names = selectedItems.value.map((item) => item.file_name)
  if (await copyText(names.join('\n'))) toasts.success(t('common.copied'))
  else toasts.error(t('common.copyFailed'))
}

/** Syntax of every selected LoRA at its usage-tip strength, joined like the bulk send. */
async function copySelectedSyntax(items: ModelItem[]): Promise<void> {
  await loadSettings()
  if (await copyText(items.map((item) => workflow.syntaxFor(item)).join(', '))) toasts.success(t('workflow.syntaxCopied'))
  else toasts.error(t('common.copyFailed'))
}

/** No bulk endpoint: one metadata save per model, four at a time; cards update in place. */
async function favoriteItems(items: ModelItem[]): Promise<void> {
  const queue = items.filter((item) => !item.favorite)
  let failed = 0
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        await api.saveMetadata(item.file_path, { favorite: true })
        onUpdated({ ...item, favorite: true })
      } catch {
        failed += 1
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  if (failed) toasts.warning(t('selection.favoritePartial', { ok: items.length - failed, failed }))
  else toasts.success(t('selection.favoriteDone', { count: items.length }))
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

/**
 * Drawer Versions tab: delete one local file of a version through the same
 * delete + Undo flow as the cards. Deleting the file the drawer shows switches
 * to a sibling file of the model (or closes the drawer); Undo reopens the
 * restored file. Otherwise the open drawer re-reads its versions.
 */
async function deleteVersionFile(request: { file: VersionFileTarget; isCurrent: boolean; siblingPath: string | null }): Promise<void> {
  const deleted = request.file.filePath
  const ok = await actions.deleteVersionFile(request.file, {
    onUndone: () => {
      if (request.isCurrent) void openByPath(deleted)
      else void drawer.value?.reloadVersions()
    },
  })
  if (!ok) return
  if (request.isCurrent) {
    // hooks.removed already closed the drawer; continue on a sibling of this model when there is one.
    if (request.siblingPath) void openByPath(request.siblingPath)
  } else {
    void drawer.value?.reloadVersions()
  }
}

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
const folderDialog = ref<FolderDialogRequest | null>(null)

const template = computed(() => {
  const templates = settings.value?.download_path_templates
  return templates && typeof templates === 'object' ? String((templates as Record<string, unknown>)[config.singular] ?? '') : ''
})

const filenameTemplate = computed(() => {
  const templates = settings.value?.download_filename_templates
  return templates && typeof templates === 'object' ? String((templates as Record<string, unknown>)[config.singular] ?? '') : ''
})

const toolItems = computed<MenuEntry[]>(() => [
  { id: 'organize', label: t('organize.open'), icon: 'wand' },
  { id: 'duplicates', label: t('tools.duplicates'), icon: 'files' },
  { id: 'excluded', label: t('tools.excluded'), icon: 'eyeOff' },
  { id: 'fetchAll', label: t('tools.fetchAll.open'), icon: 'refresh' },
  { id: 'rebuild', label: t('tools.rebuild.open'), icon: 'reload' },
])

/** Full cache rebuild (every root is walked again); a scan that is already running is left alone. */
async function rebuildCache(): Promise<void> {
  const ok = await confirm({ title: t('tools.rebuild.title'), message: t('tools.rebuild.message'), confirmLabel: t('tools.rebuild.confirm') })
  if (!ok) return
  toasts.push(t('tools.rebuild.started'))
  const outcome = await runLibraryScan({ initStatus: () => systemApi.initStatus(props.prefix), scan: () => api.rebuildCache() }).catch(
    (error: Error) => ({ kind: 'failed' as const, message: error.message }),
  )
  if (outcome.kind === 'busy') toasts.push(t('refresh.scanBusy'))
  else if (outcome.kind === 'not-ready') toasts.push(t('refresh.scanNotReady'))
  else if (outcome.kind === 'failed') toasts.error(t('refresh.scanFailed', { message: outcome.message }))
  else {
    toasts.success(t('tools.rebuild.done'))
    reload()
    void loadSecondary()
  }
}

function runTool(id: string): void {
  if (id === 'organize') organizeOpen.value = true
  else if (id === 'duplicates') duplicatesOpen.value = true
  else if (id === 'excluded') excludedOpen.value = true
  else if (id === 'fetchAll') void tools.fetchAll(t(config.title))
  else if (id === 'rebuild') void rebuildCache()
}

// Command palette: the toolbar's actions on this library.
usePageActions(() => [
  { id: 'download', label: t('download.open'), icon: 'download', shortcut: SHORTCUTS.download.keys[0], run: () => (downloadInput.value = '') },
  { id: 'select', label: t('library.select'), icon: 'checkSquare', shortcut: SHORTCUTS.select.keys[0], run: () => setSelectionMode(true) },
  { id: 'folders', label: t('palette.action.toggleFolders'), icon: 'folder', run: () => folders.toggle() },
  ...toolItems.value.map((item) => ({ id: item.id, label: item.label, icon: item.icon ?? 'wrench', run: () => runTool(item.id) })),
])

// Folder panel view options: the actions of the selected folder (or the root). Tree rows open the same entries for the pointed folder.
const folderItems = computed<MenuEntry[]>(() =>
  folderMenu(state.folder).map((entry) => ({ id: entry.action, label: entry.label, icon: entry.icon, danger: entry.danger, disabled: entry.disabled })),
)

const isInside = (path: string, folder: string) => !!folder && (path === folder || path.startsWith(`${folder}/`))

const folderActions = createFolderActions({
  api,
  tools,
  toasts,
  openDialog: (request) => (folderDialog.value = request),
  openTemplate: (folderPaths, path) => {
    templateTarget.value = { scope: { folderPaths }, label: t('tools.template.scopeFolder', { folder: path }) }
  },
  // A deleted folder that held the selection (or was above it) clears the folder filter.
  deleted: (path) => {
    if (isInside(state.folder, path)) state.folder = ''
  },
})

function runFolderAction(id: string, path: string = state.folder): void {
  void folderActions.run(id, path)
}

function onFolderDone(name: string): void {
  // A renamed folder that holds the selection keeps the selection on its new name.
  const dialog = folderDialog.value
  if (dialog?.mode === 'rename') state.folder = renamedFolderPath(state.folder, dialog.path, name)
}

async function submitRelink(value: string): Promise<string | null> {
  const item = relinkTarget.value
  return item ? tools.relink(item, value) : null
}

// --- Shared context menu: one model, the selection, or a folder of the tree ---

type MenuTarget = { kind: 'item'; item: ModelItem } | { kind: 'selection' } | { kind: 'folder'; path: string } | { kind: 'page' }
const menu = ref<(MenuTarget & MenuPoint & { opener: HTMLElement | null }) | null>(null)
const renameTarget = ref<ModelItem | null>(null)
const moveTargets = ref<ModelItem[] | null>(null)
const tagTargets = ref<ModelItem[] | null>(null)
const organizeOpen = ref(false)

/**
 * Right-click / "..." on a card. In selection mode a selected card opens the
 * selection menu (bulk actions on everything selected); an unselected card
 * opens its own item menu and leaves the selection untouched.
 */
function openMenu(item: ModelItem, point: MenuPoint, opener: HTMLElement | null): void {
  const target: MenuTarget = selectionMode.value && selected.value.has(item.file_path) ? { kind: 'selection' } : { kind: 'item', item }
  menu.value = { ...target, ...point, opener }
}

/** Right-click on the grid background (a card's own handler ran first and took the event). */
function openPageMenu(event: MouseEvent): void {
  if (event.defaultPrevented) return
  event.preventDefault()
  menu.value = { kind: 'page', x: event.clientX, y: event.clientY, opener: null }
}

function openFolderMenu(path: string, point: MenuPoint, opener: HTMLElement | null): void {
  menu.value = { kind: 'folder', path, ...point, opener }
}

function closeMenu(reason: 'escape' | 'outside' | 'select'): void {
  const opener = menu.value?.opener
  menu.value = null
  if (reason === 'escape') opener?.focus()
}

const menuContext = computed(() => ({ canSend: !!config.sendToComfy, isLora: props.prefix === 'loras', civitaiHost: civitaiHost.value }))

const menuView = computed(() => {
  const current = menu.value
  if (!current) return null
  if (current.kind === 'item') {
    return { items: itemMenu(current.item, menuContext.value), label: t('actions.menu', { name: current.item.model_name || current.item.file_name }) }
  }
  if (current.kind === 'selection') {
    const count = selected.value.size
    return { items: selectionMenu(count, menuContext.value), label: t('menu.selection', { count }), heading: t('library.selected', { count }) }
  }
  if (current.kind === 'page') return { items: pageMenu(toolItems.value), label: t('menu.page', { section: t(config.title) }) }
  return { items: folderMenu(current.path), label: t('folders.menu', { name: current.path.split('/').pop() ?? current.path }) }
})

const itemMenuDeps: ItemMenuDeps = {
  actions,
  tools,
  open: (item) => (openItem.value = item),
  send: sendToComfy,
  copySyntax,
  toggleFavorite: (item) => void toggleFavorite(item),
  dialog: (kind, item) => {
    if (kind === 'rename') renameTarget.value = item
    else if (kind === 'move') moveTargets.value = [item]
    else if (kind === 'template') templateTarget.value = { scope: { filePaths: [item.file_path] }, label: item.model_name || item.file_name }
    else if (kind === 'preview' || kind === 'rating') previewTarget.value = { item, mode: kind }
    else relinkTarget.value = item
  },
}

// Bulk actions: shared by the selection bar and the selection menu.
const bulk: SelectionMenuDeps = {
  move: (items) => (moveTargets.value = items),
  tags: (items) => (tagTargets.value = items),
  template: (items) => {
    templateTarget.value = { scope: { filePaths: items.map((item) => item.file_path) }, label: t('tools.template.scopeFiles', { count: items.length }) }
  },
  favorite: (items) => void favoriteItems(items),
  send: (items) => void workflow.sendLoras(items, 'append'),
  copySyntax: (items) => void copySelectedSyntax(items),
  copyNames: () => void copySelectedNames(),
  delete: (items) => void actions.deleteItems(items),
}

/** Model actions of the drawer's More actions menu. */
function runAction(action: ModelAction, item: ModelItem): void {
  runItemMenuAction(action, item, itemMenuDeps)
}

function onMenuSelect(action: string): void {
  const current = menu.value
  if (!current) return
  if (current.kind === 'item') runItemMenuAction(action, current.item, itemMenuDeps)
  else if (current.kind === 'selection') runSelectionMenuAction(action, selectedItems.value, bulk)
  else if (current.kind === 'folder') runFolderAction(action, current.path)
  else if (action === 'download') downloadInput.value = ''
  else if (action === 'selectAll') {
    selecting.value = true
    selectAllLoaded()
  } else runTool(action)
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

/** Keys on a focused card or row; the arrows are VirtualGrid's (useGridKeyboard.ts). */
function onGridKey(event: KeyboardEvent): void {
  const key = gridKeyOf(event.target)
  const target = event.target as HTMLElement
  if (key === null || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
  if (target.closest('input, textarea, select')) return
  const item = list.items.value.find((entry) => entry.file_path === key)
  if (!item) return
  const primary = target.hasAttribute(GRID_PRIMARY)
  // A card inside the selection acts for the whole selection (like its context menu).
  const targets = selected.value.has(key) ? selectedItems.value : [item]
  switch (event.key.toLowerCase()) {
    case ' ':
      if (!primary) return
      toggleSelect(item, event.shiftKey)
      break
    case 'enter':
      if (!primary) return
      openItem.value = item
      break
    case 's':
      if (!config.sendToComfy) return
      if (targets.length > 1) void workflow.sendLoras(targets, event.shiftKey ? 'replace' : 'append')
      else sendToComfy(item, event.shiftKey)
      break
    case 'c':
      if (!config.sendToComfy || event.shiftKey) return
      copySyntax(item)
      break
    case 'f':
      if (event.shiftKey) return
      void toggleFavorite(item)
      break
    case 'delete':
      void actions.deleteItems(targets)
      break
    default:
      return
  }
  event.preventDefault()
}

/** Space activates a button on key up: the grid's Space selects instead. */
function onGridKeyup(event: KeyboardEvent): void {
  if (event.key === ' ' && (event.target as HTMLElement).hasAttribute?.(GRID_PRIMARY)) event.preventDefault()
}

function bulkSend(event: MouseEvent): void {
  void workflow.sendLoras(selectedItems.value, event.shiftKey ? 'replace' : 'append')
}

// Bulk bar: Move, Add tags, Send and Delete are inline; the other selection actions sit behind "More".
const BULK_INLINE = new Set(['move', 'tags', 'send', 'delete'])
const bulkMoreItems = computed<MenuEntry[]>(() =>
  selectionMenu(selected.value.size, menuContext.value)
    .filter((entry) => !BULK_INLINE.has(entry.action))
    .map((entry) => ({ id: entry.action, label: entry.label, icon: entry.icon, disabled: entry.disabled })),
)
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <FolderPanel
      v-show="showFolders"
      :id="foldersId"
      ref="folderPanel"
      v-model:recursive="state.recursive"
      :tree="tree"
      :selected="state.folder"
      :actions="folderItems"
      @select="selectFolder"
      @menu="openFolderMenu"
      @action="runFolderAction"
      @close="folders.set(false)"
    />

    <section class="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <LibraryToolbar
        ref="toolbar"
        v-model:search="searchText"
        v-model:sort="filters.sort.value"
        v-model:card-size="filters.cardSize.value"
        v-model:view="filters.view.value"
        v-model:quick-row="filters.quickRow.value"
        v-model:shape="filters.shape.value"
        v-model:fit="filters.fit.value"
        v-model:show="filters.show.value"
        v-model:quick-view="inspectorOn"
        v-model:search-in="state.searchIn"
        v-model:recursive="state.recursive"
        view-toggle
        quick-view-option
        :quick-row-option="config.quickBaseModels > 0"
        :title="t(config.title)"
        :count-text="countText"
        :search-id="`library-search-${prefix}`"
        :search-scope="prefix"
        :search-label="t('library.search', { section: t(config.title) })"
        :search-placeholder="t('library.searchPlaceholder', { section: t(config.title) })"
        :active-tags="state.tags"
        :id-prefix="prefix"
        :sort-options="config.sortOptions"
        :folders-id="foldersId"
        :folders-open="showFolders"
        :filter-count="filters.panelCount.value"
        :chips="filters.chips.value"
        :selection-mode="selectionMode"
        :tool-items="toolItems"
        :shortcuts="!openItem"
        @commit="commitSearch"
        @choose="onSearchChoose"
        @toggle-folders="folders.toggle()"
        @toggle-select="setSelectionMode(!selectionMode)"
        @tool="runTool"
        @clear-filters="filters.clear()"
        @clear-panel="filters.clearPanel()"
      >
        <template #leading>
          <button type="button" class="lm-btn lm-btn--primary flex-none phone:min-h-touch" :aria-keyshortcuts="SHORTCUTS.download.aria" @click="downloadInput = ''">
            <AppIcon name="download" :size="16" /><span class="max-[1279px]:sr-only">{{ t('download.open') }}</span>
          </button>
        </template>
        <template #context>
          <FolderBreadcrumb :section="t(config.title)" :folder="state.folder" :tree="tree" @select="state.folder = $event" />
          <AlphabetBar v-if="config.alphabet" v-model="state.letter" :id-prefix="prefix" />
        </template>
        <template #quick>
          <BaseModelQuickFilter
            v-if="config.quickBaseModels > 0"
            :entries="baseModels"
            :selected="state.baseModels"
            :limit="config.quickBaseModels"
            :id-prefix="prefix"
            @toggle="filters.toggle('baseModels', $event)"
            @clear="filters.clearList('baseModels')"
          />
        </template>
        <template #filters>
          <LibraryFilterPanel
            :groups="filterGroups"
            :selected="state"
            :id-prefix="prefix"
            tag-logic
            licence
            :presets="filters.presets.value"
            @toggle="filters.toggle"
            @tag-logic="state.tagLogic = $event"
            @licence="(field, value) => (state[field] = value)"
            @apply-preset="filters.applyPreset"
            @save-preset="filters.savePreset"
            @delete-preset="deletePreset"
          >
            <label><input v-model="state.favoritesOnly" class="accent-accent" type="checkbox" /> {{ t('library.favoritesOnly') }}</label>
            <!-- `contents`: the label stays on the checkbox row, the help text takes its own line below. -->
            <span v-if="config.supportsUpdates" class="contents" data-testid="updates-flag-filter">
              <label :title="t('library.updatesFlagHint')">
                <input
                  v-model="state.updatesOnly"
                  class="accent-accent"
                  type="checkbox"
                  :aria-describedby="`${prefix}-updates-flag-hint`"
                />
                {{ t('library.updatesOnly') }}
              </label>
              <span :id="`${prefix}-updates-flag-hint`" class="-mt-2 basis-full text-xs text-muted">
                {{ t('library.updatesFlagHint') }}
                <RouterLink to="/updates" class="font-medium text-accent underline underline-offset-2 hover:no-underline">{{ t('library.openUpdates') }}</RouterLink>
              </span>
            </span>
          </LibraryFilterPanel>
        </template>
      </LibraryToolbar>

      <StateBlock v-if="list.error.value && !list.items.value.length" kind="error" :message="list.error.value" @retry="reload" />
      <StateBlock
        v-else-if="list.loaded.value && !list.items.value.length && !scanning"
        kind="empty"
        :icon="emptyKind === 'favorites' ? 'star' : emptyKind === 'noMatch' ? 'search' : 'folder'"
        :title="t(`states.${emptyKind}.title`)"
        :message="emptyKind === 'folder' ? t('states.folder.body', { folder: state.folder }) : t(`states.${emptyKind}.body`)"
        :data-empty="emptyKind"
      >
        <div class="mt-2 flex flex-wrap justify-center gap-2">
          <template v-if="emptyKind === 'library'">
            <RouterLink to="/settings/library" class="lm-btn phone:min-h-touch"><AppIcon name="folder" :size="16" />{{ t('states.library.folders') }}</RouterLink>
            <button type="button" class="lm-btn phone:min-h-touch" :disabled="refreshState.busy.value" @click="refreshState.run()">
              <AppIcon name="refresh" :size="16" />{{ t('states.library.scan') }}
            </button>
            <button type="button" class="lm-btn lm-btn--primary phone:min-h-touch" @click="downloadInput = ''">
              <AppIcon name="download" :size="16" />{{ t('download.open') }}
            </button>
          </template>
          <button v-else-if="emptyKind === 'folder'" type="button" class="lm-btn phone:min-h-touch" @click="state.folder = ''">{{ t('states.folder.all') }}</button>
          <button v-else-if="emptyKind === 'favorites'" type="button" class="lm-btn phone:min-h-touch" @click="state.favoritesOnly = false">{{ t('states.favorites.all') }}</button>
          <button v-else type="button" class="lm-btn phone:min-h-touch" @click="filters.clear()">{{ t('library.clearFilters') }}</button>
        </div>
      </StateBlock>

      <ListHeader
        v-if="filters.view.value === 'list' && list.items.value.length"
        v-model:sort="filters.sort.value"
        :selection-mode="selectionMode"
        :can-send="config.sendToComfy"
      />
      <!-- Item keys of the focused card (the grid's own arrow keys run first). -->
      <div class="contents" @keydown="onGridKey" @keyup="onGridKeyup" @contextmenu="openPageMenu">
        <VirtualGrid
          v-show="list.items.value.length || showSkeleton"
          ref="grid"
          v-model:active-key="focusedKey"
          :class="{ 'pb-[5rem]!': selectionMode }"
          :aspect="cardAspect"
          :extra-height="cardExtraHeight"
          :skeleton="showSkeleton"
          :skeleton-label="scanning ? t('states.scanning') : undefined"
          :items="list.items.value"
          :item-key="(item: ModelItem) => item.file_path"
          :min-item-width="filters.cardSize.value"
          :layout="filters.view.value"
          :label="t(config.title)"
          @reach-end="list.loadMore()"
        >
          <template #default="{ item, tabbable }">
            <!-- Explicit branches (not <component :is>) so vue-tsc checks every prop and handler on both views. -->
            <ModelRow
              v-if="filters.view.value === 'list'"
              :item="item"
              :selection-mode="selectionMode"
              :selected="selected.has(item.file_path)"
              :blur-mature="blurMature"
              :can-send="config.sendToComfy"
              :quick-view="inspectorVisible"
              :focused="inspectorVisible && focusedKey === item.file_path"
              :revealed="revealed.has(item.file_path)"
              :display="cardDisplay"
              :civitai-host="civitaiHost"
              :tabbable="tabbable"
              @open="openItem = $event"
              @focus="focusedKey = $event.file_path"
              @send="sendToComfy"
              @copy="copySyntax"
              @reveal="toggleReveal"
              @toggle-select="toggleSelect"
              @toggle-favorite="toggleFavorite"
              @menu="openMenu"
            />
            <ModelCard
              v-else
              :item="item"
              :selection-mode="selectionMode"
              :selected="selected.has(item.file_path)"
              :blur-mature="blurMature"
              :can-send="config.sendToComfy"
              :quick-view="inspectorVisible"
              :focused="inspectorVisible && focusedKey === item.file_path"
              :revealed="revealed.has(item.file_path)"
              :display="cardDisplay"
              :civitai-host="civitaiHost"
              :tabbable="tabbable"
              @open="openItem = $event"
              @focus="focusedKey = $event.file_path"
              @send="sendToComfy"
              @copy="copySyntax"
              @reveal="toggleReveal"
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
            <p v-else-if="list.loaded.value && !list.hasMore.value && list.items.value.length" class="mt-4 text-center text-sm text-muted">
              {{ t('library.end', { count: list.total.value.toLocaleString() }) }}
            </p>
          </template>
        </VirtualGrid>
      </div>
      <LibrarySelectionBar
        v-if="selectionMode"
        :count="selected.size"
        :hidden="hiddenSelected"
        :has-items="!!list.items.value.length"
        :hint="`${t('selection.hint')} ${t('selection.rangeHint')}`"
        @all="selectAllLoaded"
        @none="selectNone"
        @invert="invertSelected"
        @done="setSelectionMode(false)"
      >
        <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="bulk.move(selectedItems)">
          <AppIcon name="folderMove" :size="14" />{{ t('selection.move') }}
        </button>
        <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="bulk.tags(selectedItems)">
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
        <MenuButton
          :label="t('selection.more')"
          compact
          button-class="lm-btn lm-btn--sm lm-btn--icon"
          :items="bulkMoreItems"
          @select="runSelectionMenuAction($event, selectedItems, bulk)"
        />
        <button type="button" class="lm-btn lm-btn--sm lm-btn--danger" :disabled="!selected.size" @click="bulk.delete(selectedItems)">
          <AppIcon name="trash" :size="14" />{{ t('selection.delete') }}
        </button>
      </LibrarySelectionBar>
    </section>

    <ModelInspector
      v-if="inspectorVisible"
      :item="focusedItem"
      :can-send="config.sendToComfy"
      :blur-mature="blurMature"
      :revealed="!!focusedItem && revealed.has(focusedItem.file_path)"
      @open="openItem = $event"
      @send="sendToComfy"
      @copy="copySyntax"
      @reveal="toggleReveal"
      @filter-tag="filterByTag"
      @close="inspectorOn = false"
    />

    <ModelDrawer
      v-if="openItem"
      ref="drawer"
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
      @delete-file="deleteVersionFile"
    />

    <ModelActionMenu
      v-if="menu && menuView"
      :x="menu.x"
      :y="menu.y"
      :label="menuView.label"
      :heading="menuView.heading"
      :items="menuView.items"
      @select="onMenuSelect"
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
