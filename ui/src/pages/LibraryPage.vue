<script setup lang="ts">
/**
 * Generic model library (LoRAs, checkpoints, embeddings): folder tree,
 * filters, virtualised card grid, selection mode and the detail drawer.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import FolderTree from '@/components/FolderTree.vue'
import ModelCard from '@/components/ModelCard.vue'
import ModelDrawer from '@/components/ModelDrawer.vue'
import StateBlock from '@/components/StateBlock.vue'
import VirtualGrid from '@/components/VirtualGrid.vue'
import { createModelApi } from '@/api/endpoints'
import type { CountEntry, FolderTree as FolderTreeData, ModelItem, ModelPrefix, TagEntry } from '@/api/types'
import { LIBRARIES } from '@/config/libraries'
import { useAppSettings } from '@/composables/useAppSettings'
import { copyText, useToasts } from '@/composables/useFeedback'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { CARD_SIZE_MAX, CARD_SIZE_MIN, useLibraryFilters } from '@/composables/useLibraryFilters'
import { useSearch } from '@/composables/useSearch'
import { withMountPrefix } from '@/utils/basePath'
import { t, type MessageKey } from '@/i18n'

const props = defineProps<{ prefix: ModelPrefix }>()

const PAGE_SIZE = 60
const config = LIBRARIES[props.prefix]
const api = createModelApi(props.prefix)
const classicUrl = withMountPrefix(`/${config.classicPath}`)
const toasts = useToasts()
const { debounced: search } = useSearch()
const { settings, load: loadSettings } = useAppSettings()
const filters = useLibraryFilters(config)
const { state } = filters

const list = useInfiniteList<ModelItem>((page, signal) =>
  api.list(
    {
      page,
      pageSize: PAGE_SIZE,
      sortBy: filters.sort.value,
      search: search.value,
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
const showFolders = ref(typeof window !== 'undefined' ? window.innerWidth > 1100 : true)
const openItem = ref<ModelItem | null>(null)
const selectionMode = ref(false)
const selected = ref<Set<string>>(new Set())

const blurMature = computed(() => !!settings.value?.blur_mature_content)
const civitaiHost = computed(() => String(settings.value?.civitai_host || 'civitai.com'))

/** The two chip groups of the filter panel. */
const filterGroups = computed(() => [
  { field: 'baseModels' as const, title: 'library.baseModels' as MessageKey, entries: baseModels.value },
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

watch([filters.signature, search], reload)

onMounted(() => {
  void list.reset()
  void loadSettings()
  api.folderTree().then((value) => (tree.value = value)).catch(() => undefined)
  api.baseModels(30).then((value) => (baseModels.value = value)).catch(() => undefined)
  api.topTags(40).then((value) => (topTags.value = value)).catch(() => undefined)
})

function selectFolder(path: string): void {
  state.folder = state.folder === path ? '' : path
  if (window.innerWidth <= 1100) showFolders.value = false
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
      v-if="showFolders"
      class="w-[240px] flex-none overflow-y-auto hairline-r border-border bg-surface px-3 py-4 narrow:absolute narrow:inset-y-0 narrow:left-0 narrow:z-20 narrow:w-[min(300px,85vw)] narrow:shadow-lg"
      :aria-label="t('library.folders')"
    >
      <div class="mb-2 flex items-center justify-between">
        <h2 class="lm-overline text-sm">{{ t('library.folders') }}</h2>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('common.close')" @click="showFolders = false">
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
          <button
            type="button"
            class="lm-btn"
            :class="{ 'lm-chip--active': showFolders }"
            :aria-pressed="showFolders"
            @click="showFolders = !showFolders"
          >
            <AppIcon name="folder" :size="16" /><span class="phone:hidden">{{ t('library.folders') }}</span>
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
            @open="openItem = $event"
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
      @close="openItem = null"
      @updated="onUpdated"
    />
  </div>
</template>
