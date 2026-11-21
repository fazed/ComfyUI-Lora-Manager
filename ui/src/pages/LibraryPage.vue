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
import { t } from '@/i18n'

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
  <div class="library">
    <aside v-if="showFolders" class="library__folders" :aria-label="t('library.folders')">
      <div class="library__folders-head">
        <h2>{{ t('library.folders') }}</h2>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('common.close')" @click="showFolders = false">
          <AppIcon name="close" :size="14" />
        </button>
      </div>
      <button type="button" class="library__all" :class="{ 'is-selected': !state.folder }" @click="state.folder = ''">
        <AppIcon name="grid" :size="15" />{{ t('library.allFolders') }}
      </button>
      <FolderTree :tree="tree" :selected="state.folder" @select="selectFolder" />
    </aside>

    <section class="library__main">
      <div class="library__toolbar">
        <div class="library__title">
          <h1>{{ t(config.title) }}</h1>
          <span class="lm-muted library__count" aria-live="polite">{{ t('library.count', { count: list.total.value.toLocaleString() }) }}</span>
        </div>
        <div class="library__controls">
          <button
            type="button"
            class="lm-btn"
            :class="{ 'lm-chip--active': showFolders }"
            :aria-pressed="showFolders"
            @click="showFolders = !showFolders"
          >
            <AppIcon name="folder" :size="16" /><span class="library__btn-text">{{ t('library.folders') }}</span>
          </button>
          <label class="visually-hidden" :for="`sort-${prefix}`">{{ t('library.sort') }}</label>
          <select :id="`sort-${prefix}`" v-model="filters.sort.value" class="lm-select library__sort">
            <option v-for="option in config.sortOptions" :key="option.value" :value="option.value">{{ t(option.label) }}</option>
          </select>
          <button type="button" class="lm-btn" :aria-expanded="showFilters" aria-controls="library-filters" @click="showFilters = !showFilters">
            <AppIcon name="filter" :size="16" /><span class="library__btn-text">{{ t('library.filters') }}</span>
            <span v-if="filters.panelCount.value" class="lm-badge lm-badge--accent">{{ filters.panelCount.value }}</span>
          </button>
          <label class="library__size">
            <span class="visually-hidden">{{ t('library.cardSize') }}</span>
            <AppIcon name="grid" :size="16" />
            <input v-model.number="filters.cardSize.value" type="range" :min="CARD_SIZE_MIN" :max="CARD_SIZE_MAX" step="10" :aria-label="t('library.cardSize')" />
          </label>
          <button type="button" class="lm-btn" :aria-pressed="selectionMode" @click="setSelectionMode(!selectionMode)">
            <AppIcon :name="selectionMode ? 'check' : 'checkSquare'" :size="16" />
            <span class="library__btn-text">{{ selectionMode ? t('library.selectDone') : t('library.select') }}</span>
          </button>
        </div>
      </div>

      <div v-if="showFilters" id="library-filters" class="library__filters lm-panel">
        <div class="library__filter-group">
          <h3>{{ t('library.baseModels') }}</h3>
          <div class="library__chip-list">
            <button
              v-for="entry in baseModels"
              :key="entry.name"
              type="button"
              class="lm-chip"
              :class="{ 'lm-chip--active': state.baseModels.includes(entry.name) }"
              :aria-pressed="state.baseModels.includes(entry.name)"
              @click="filters.toggle('baseModels', entry.name)"
            >
              {{ entry.name }} <span class="lm-muted">{{ entry.count }}</span>
            </button>
          </div>
        </div>
        <div class="library__filter-group">
          <h3>{{ t('library.tags') }}</h3>
          <div class="library__chip-list">
            <button
              v-for="entry in topTags"
              :key="entry.tag"
              type="button"
              class="lm-chip"
              :class="{ 'lm-chip--active': state.tags.includes(entry.tag) }"
              :aria-pressed="state.tags.includes(entry.tag)"
              @click="filters.toggle('tags', entry.tag)"
            >
              {{ entry.tag }} <span class="lm-muted">{{ entry.count }}</span>
            </button>
          </div>
        </div>
        <div class="library__filter-group library__filter-toggles">
          <label><input v-model="state.favoritesOnly" type="checkbox" /> {{ t('library.favoritesOnly') }}</label>
          <label v-if="config.supportsUpdates"><input v-model="state.updatesOnly" type="checkbox" /> {{ t('library.updatesOnly') }}</label>
        </div>
      </div>

      <div v-if="filters.chips.value.length" class="library__chips" :aria-label="t('library.filters')">
        <span v-for="chip in filters.chips.value" :key="chip.key" class="lm-chip lm-chip--active">
          {{ chip.label }}
          <button type="button" class="library__chip-x" :aria-label="t('library.removeFilter', { name: chip.label })" @click="chip.remove()">
            <AppIcon name="close" :size="12" />
          </button>
        </span>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm" @click="filters.clear()">{{ t('library.clearFilters') }}</button>
      </div>

      <div v-if="selectionMode" class="library__selection" role="region" :aria-label="t('library.selected', { count: selected.size })">
        <strong>{{ t('library.selected', { count: selected.size }) }}</strong>
        <button type="button" class="lm-btn lm-btn--sm" @click="selectAllLoaded">{{ t('library.selectAllLoaded') }}</button>
        <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="selected = new Set()">{{ t('library.clearSelection') }}</button>
        <button type="button" class="lm-btn lm-btn--sm" :disabled="!selected.size" @click="copySelectedNames">
          <AppIcon name="copy" :size="14" />{{ t('library.copyNames') }}
        </button>
        <span class="lm-muted library__selection-hint">
          {{ t('library.bulkClassic') }} <a :href="classicUrl">{{ t('common.openClassic') }}</a>
        </span>
      </div>

      <StateBlock v-if="list.error.value && !list.items.value.length" kind="error" :message="list.error.value" @retry="reload" />
      <StateBlock v-else-if="list.loaded.value && !list.items.value.length" kind="empty" :message="t('library.empty')" />
      <div v-else-if="!list.loaded.value" class="library__skeletons" aria-hidden="true">
        <div v-for="n in 12" :key="n" class="lm-skeleton library__skeleton"></div>
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
          <p v-if="list.loading.value && list.items.value.length" class="library__more lm-muted">{{ t('library.loadMore') }}</p>
          <p v-else-if="list.error.value && list.items.value.length" class="library__more">
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

<style scoped>
.library {
  display: flex;
  flex: 1;
  min-height: 0;
}

.library__folders {
  flex: none;
  width: 240px;
  padding: var(--lm-space-4) var(--lm-space-3);
  border-right: var(--lm-border-width) solid var(--lm-color-border);
  background: var(--lm-color-surface);
  overflow-y: auto;
}

.library__folders-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--lm-space-2);
}

.library__folders-head h2 {
  font-size: var(--lm-font-size-sm);
  color: var(--lm-color-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.library__all {
  display: flex;
  align-items: center;
  gap: var(--lm-space-2);
  width: 100%;
  height: 30px;
  padding: 0 var(--lm-space-2);
  border: 0;
  border-radius: var(--lm-radius-sm);
  background: transparent;
  font-size: var(--lm-font-size-sm);
  cursor: pointer;
}

.library__all:hover {
  background: var(--lm-color-sunken);
}

.library__all.is-selected {
  background: var(--lm-color-accent-soft);
  color: var(--lm-color-accent);
}

.library__main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.library__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--lm-space-3);
  padding: var(--lm-space-5) var(--lm-space-6) var(--lm-space-3);
}

.library__title {
  display: flex;
  align-items: baseline;
  gap: var(--lm-space-3);
}

.library__title h1 {
  font-size: var(--lm-font-size-2xl);
}

.library__count {
  font-size: var(--lm-font-size-sm);
  font-variant-numeric: tabular-nums;
}

.library__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lm-space-2);
}

.library__sort {
  width: auto;
  min-width: 150px;
}

.library__size {
  display: inline-flex;
  align-items: center;
  gap: var(--lm-space-2);
  padding: 0 var(--lm-space-2);
  color: var(--lm-color-muted);
}

.library__size input {
  width: 110px;
  accent-color: var(--lm-color-accent);
}

.library__filters {
  display: grid;
  gap: var(--lm-space-4);
  margin: 0 var(--lm-space-6) var(--lm-space-3);
  padding: var(--lm-space-4);
}

.library__filter-group h3 {
  margin-bottom: var(--lm-space-2);
  font-size: var(--lm-font-size-xs);
  color: var(--lm-color-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.library__chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lm-space-1);
  max-height: 120px;
  overflow-y: auto;
}

.library__filter-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lm-space-4);
}

.library__filter-toggles input {
  accent-color: var(--lm-color-accent);
}

.library__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lm-space-2);
  padding: 0 var(--lm-space-6) var(--lm-space-3);
}

.library__chip-x {
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.library__selection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lm-space-2);
  margin: 0 var(--lm-space-6) var(--lm-space-3);
  padding: var(--lm-space-2) var(--lm-space-3);
  border-radius: var(--lm-radius-md);
  background: var(--lm-color-accent-soft);
}

.library__selection-hint {
  font-size: var(--lm-font-size-xs);
}

.library__skeletons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--lm-card-gap);
  padding: 0 var(--lm-space-6);
  overflow: hidden;
}

.library__skeleton {
  aspect-ratio: var(--lm-card-aspect);
  border-radius: var(--lm-radius-md);
}

.library__more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--lm-space-2);
  margin: var(--lm-space-4) 0 0;
  font-size: var(--lm-font-size-sm);
}

@media (max-width: 1100px) {
  .library__folders {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 20;
    width: min(300px, 85vw);
    box-shadow: var(--lm-shadow-lg);
  }
}

@media (max-width: 720px) {
  .library__toolbar {
    padding: var(--lm-space-4) var(--lm-space-3) var(--lm-space-2);
  }

  .library__filters,
  .library__selection {
    margin-left: var(--lm-space-3);
    margin-right: var(--lm-space-3);
  }

  .library__chips,
  .library__skeletons {
    padding-left: var(--lm-space-3);
    padding-right: var(--lm-space-3);
  }

  .library__btn-text {
    display: none;
  }

  .library__size {
    display: none;
  }

  .library__sort {
    min-width: 0;
    flex: 1;
  }

  .library__controls {
    width: 100%;
  }
}
</style>
