<script setup lang="ts">
/**
 * Folder panel of the browse pages (library and recipes): header with New
 * folder, Collapse all and the view options (tree / list, include subfolders,
 * the folder actions of the selected folder), a "Find a folder" box and the
 * tree in its own scroll container. Tree or list is remembered across
 * libraries (`lm-ui.folders.view`). The tree endpoint returns neither counts
 * nor an "empty" flag, so there are no folder counts and no "show empty".
 */
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import FolderTree from './FolderTree.vue'
import MenuButton, { type MenuEntry } from './MenuButton.vue'
import type { FolderTree as FolderTreeData } from '@/api/types'
import type { MenuPoint } from '@/composables/useCardInteractions'
import { flattenFolderTree } from '@/utils/modelActions'
import { readStorage, writeStorage } from '@/utils/storage'
import { t } from '@/i18n'

const FOLDER_VIEW_KEY = 'lm-ui.folders.view'

const props = withDefaults(
  defineProps<{
    id: string
    tree: FolderTreeData
    selected: string
    /** Folder actions of the selected folder (model libraries); the first one ('create') is also the New folder button. */
    actions?: MenuEntry[]
  }>(),
  { actions: () => [] },
)
const recursive = defineModel<boolean>('recursive', { required: true })
const emit = defineEmits<{
  select: [path: string]
  menu: [path: string, point: MenuPoint, opener: HTMLElement | null]
  action: [id: string]
  close: []
}>()

const flat = ref(readStorage(FOLDER_VIEW_KEY) === 'list')
watch(flat, (value) => writeStorage(FOLDER_VIEW_KEY, value ? 'list' : 'tree'))

const query = ref('')
const expanded = ref<Map<string, boolean>>(new Map())
const root = ref<HTMLElement | null>(null)

function toggle(path: string, open: boolean): void {
  expanded.value = new Map(expanded.value).set(path, open)
}

function collapseAll(): void {
  expanded.value = new Map(flattenFolderTree(props.tree).map((path) => [path, false]))
}

const canCreate = computed(() => props.actions.some((entry) => entry.id === 'create'))
const viewItems = computed<MenuEntry[]>(() => [
  { id: 'view:tree', label: t('folders.treeView'), checked: !flat.value },
  { id: 'view:list', label: t('folders.listView'), checked: flat.value },
  { id: 'view:recursive', label: t('folders.includeSubfolders'), checked: recursive.value, separator: true },
  ...props.actions.map((entry, index) => ({ ...entry, separator: index === 0 })),
])

function onViewItem(id: string): void {
  if (id === 'view:tree') flat.value = false
  else if (id === 'view:list') flat.value = true
  else if (id === 'view:recursive') recursive.value = !recursive.value
  else emit('action', id)
}

const empty = computed(() => !!query.value.trim() && !flattenFolderTree(props.tree).some((path) => path.toLowerCase().includes(query.value.trim().toLowerCase())))
const headerButton = 'lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm'

defineExpose({ root })
</script>

<template>
  <aside
    :id="id"
    ref="root"
    class="flex w-folders flex-none flex-col hairline-r border-border bg-surface narrow:absolute narrow:inset-y-0 narrow:left-0 narrow:z-20 narrow:w-[min(18.5rem,85vw)] narrow:shadow-lg"
    :aria-label="t('library.folders')"
  >
    <div class="flex items-center gap-1 px-3 pt-3 pb-2">
      <h2 class="min-w-0 flex-1 text-sm font-bold">{{ t('library.folders') }}</h2>
      <button v-if="canCreate" type="button" :class="headerButton" :aria-label="t('folders.newShort')" :title="t('folders.newShort')" @click="emit('action', 'create')">
        <AppIcon name="folderPlus" :size="16" />
      </button>
      <button type="button" :class="headerButton" :aria-label="t('folders.collapseAll')" :title="t('folders.collapseAll')" :disabled="flat" @click="collapseAll">
        <AppIcon name="collapse" :size="16" />
      </button>
      <MenuButton :label="t('folders.viewOptions')" icon="sliders" compact align="right" :button-class="headerButton" :items="viewItems" @select="onViewItem" />
      <button type="button" :class="headerButton" :aria-label="t('library.hideFolders')" :title="t('library.hideFolders')" @click="emit('close')">
        <AppIcon name="close" :size="14" />
      </button>
    </div>
    <label class="mx-3 mb-2 flex items-center gap-2 rounded-md hairline border-field-border bg-field px-2 text-muted focus-within:border-field-border-hover">
      <AppIcon name="search" :size="14" />
      <span class="sr-only">{{ t('folders.find') }}</span>
      <input v-model="query" type="search" class="h-control-sm min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-placeholder" :placeholder="t('folders.find')" autocomplete="off" />
    </label>
    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <button
        type="button"
        class="lm-row flex h-[1.875rem] w-full cursor-pointer items-center gap-2 px-2 text-sm"
        :class="{ 'is-selected': !selected }"
        @click="emit('select', '')"
      >
        <AppIcon name="grid" :size="15" />{{ t('library.allFolders') }}
      </button>
      <FolderTree
        :tree="tree"
        :selected="selected"
        :expanded="expanded"
        :flat="flat"
        :query="query"
        :label="t('library.folders')"
        @select="emit('select', $event)"
        @toggle="toggle"
        @menu="(path, point, opener) => emit('menu', path, point, opener)"
      />
      <p v-if="empty" class="px-2 py-3 text-sm text-muted">{{ t('folders.noMatch') }}</p>
    </div>
  </aside>
</template>
