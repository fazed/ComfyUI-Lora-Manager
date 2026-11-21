<script setup lang="ts">
/**
 * Generic model library (LoRAs, checkpoints, embeddings): folder tree,
 * filters, virtualised card grid, selection mode and the detail drawer.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BaseModelQuickFilter from '@/components/BaseModelQuickFilter.vue'
import FolderTree from '@/components/FolderTree.vue'
import ModelCard from '@/components/ModelCard.vue'
import ModelDrawer from '@/components/ModelDrawer.vue'
import SearchCombobox from '@/components/SearchCombobox.vue'
import StateBlock from '@/components/StateBlock.vue'
import VirtualGrid from '@/components/VirtualGrid.vue'
import { createModelApi } from '@/api/endpoints'
import type { CountEntry, FolderTree as FolderTreeData, ModelItem, ModelPrefix, TagEntry } from '@/api/types'
import { LIBRARIES } from '@/config/libraries'
import { useAppSettings } from '@/composables/useAppSettings'
import { copyText, useToasts } from '@/composables/useFeedback'
import { useFolderPanel } from '@/composables/useFolderPanel'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { CARD_SIZE_MAX, CARD_SIZE_MIN, useLibraryFilters } from '@/composables/useLibraryFilters'
import { takeStashedItem } from '@/composables/useSearch'
import { LOCAL_PER_GROUP, MAX_TAGS } from '@/api/suggestSource'
import { queryParam } from '@/config/navigation'
import type { SuggestOption } from '@/utils/suggest'
import { useSendToWorkflow } from '@/composables/useSendToWorkflow'
import { sortBaseModels } from '@/utils/baseModelChips'
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
let searchTimer: ReturnType<typeof setTimeout> | null = null

function commitSearch(value: string): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
  searchText.value = value
  state.search = value.trim()
}

watch(searchText, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  if (value.trim() === state.search) return
  searchTimer = setTimeout(() => {
    searchTimer = null
    state.search = value.trim()
  }, SEARCH_DEBOUNCE_MS)
})
// Chip removal / "Clear all" / route prefill update the box too.
watch(
  () => state.search,
  (value) => {
    if (searchText.value.trim() !== value) searchText.value = value
  },
)
onBeforeUnmount(() => searchTimer && clearTimeout(searchTimer))

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

function selectAllLoaded(): void {
  selected.value = new Set(list.items.value.map((item) => item.file_path))
}

async function copySelectedNames(): Promise<void> {
  const names = list.items.value.filter((item) => selected.value.has(item.file_path)).map((item) => item.file_name)
  if (await copyText(names.join('\n'))) toasts.success(t('common.copied'))
  else toasts.error(t('common.copyFailed'))
}
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <aside
      v-show="showFolders"
      :id="foldersId"
      class="w-[240px] flex-none overflow-y-auto hairline-r border-border bg-surface px-3 py-4 narrow:absolute narrow:inset-y-0 narrow:left-0 narrow:z-20 narrow:w-[min(300px,85vw)] narrow:shadow-lg"
      :aria-label="t('library.folders')"
    >
      <div class="mb-2 flex items-center justify-between">
        <h2 class="lm-overline text-sm">{{ t('library.folders') }}</h2>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('library.hideFolders')" :title="t('library.hideFolders')" @click="folders.set(false)">
          <AppIcon name="close" :size="14" />
        </button>
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
            <AppIcon name="filter" :size="16" /><span class="phone:hidden">{{ t('library.filters') }}</span>
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
          <button type="button" class="lm-btn" :aria-pressed="selectionMode" @click="setSelectionMode(!selectionMode)">
            <AppIcon :name="selectionMode ? 'check' : 'checkSquare'" :size="16" />
            <span class="phone:hidden">{{ selectionMode ? t('library.selectDone') : t('library.select') }}</span>
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
        role="region"
        :aria-label="t('library.selected', { count: selected.size })"
      >
        <strong>{{ t('library.selected', { count: selected.size }) }}</strong>
        <button type="button" class="lm-btn lm-btn--sm" @click="selectAllLoaded">{{ t('library.selectAllLoaded') }}</button>
        <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="selected = new Set()">{{ t('library.clearSelection') }}</button>
        <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="copySelectedNames">
          <AppIcon name="copy" :size="14" />{{ t('library.copyNames') }}
        </button>
        <span class="text-xs text-muted">
          {{ t('library.bulkClassic') }} <a :href="classicUrl">{{ t('common.openClassic') }}</a>
        </span>
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
      @close="openItem = null"
      @filter-tag="filterByTag"
      @updated="onUpdated"
    />
  </div>
</template>
