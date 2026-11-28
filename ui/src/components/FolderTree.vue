<script setup lang="ts">
/**
 * Folder tree (from the unified-folder-tree endpoint), rendered as one flat
 * list of the visible rows. The expansion state is lifted to the parent
 * (`expanded`: explicit choices; a folder without one is open while it holds
 * the selection), so the folder panel can collapse everything. `flat` lists
 * every folder as a full path without chevrons; `query` narrows that list to
 * matching paths.
 *
 * Keyboard (WAI-ARIA tree): one tab stop with a roving tabindex, Up / Down /
 * Home / End move, Right opens or steps into a folder, Left closes or steps
 * to the parent, Enter / Space select. Right-click, the context-menu key and
 * Shift+F10 emit `menu` with that row's path.
 */
import { computed, nextTick, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { FolderTree } from '@/api/types'
import { menuPointFor, type MenuPoint } from '@/composables/useCardInteractions'
import { flattenFolderTree } from '@/utils/modelActions'
import { t } from '@/i18n'

const props = withDefaults(
  defineProps<{ tree: FolderTree; selected: string; expanded?: Map<string, boolean>; flat?: boolean; query?: string; label?: string }>(),
  { expanded: () => new Map(), flat: false, query: '', label: '' },
)
const emit = defineEmits<{
  select: [path: string]
  /** Open (true) or close a folder. */
  toggle: [path: string, open: boolean]
  /** Open the folder menu for `path`; `opener` gets focus back when it closes. */
  menu: [path: string, point: MenuPoint, opener: HTMLElement | null]
}>()

interface Row {
  path: string
  name: string
  depth: number
  hasChildren: boolean
  open: boolean
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

function isOpen(path: string): boolean {
  return props.expanded.get(path) ?? props.selected.startsWith(path + '/')
}

function treeRows(tree: FolderTree, parent: string, depth: number): Row[] {
  return Object.keys(tree)
    .sort(byName)
    .flatMap((name) => {
      const path = parent ? `${parent}/${name}` : name
      const children = tree[name] ?? {}
      const hasChildren = Object.keys(children).length > 0
      const open = hasChildren && isOpen(path)
      return [{ path, name, depth, hasChildren, open }, ...(open ? treeRows(children, path, depth + 1) : [])]
    })
}

const rows = computed<Row[]>(() => {
  const query = props.query.trim().toLowerCase()
  if (!props.flat && !query) return treeRows(props.tree, '', 0)
  return flattenFolderTree(props.tree)
    .filter((path) => !query || path.toLowerCase().includes(query))
    .map((path) => ({ path, name: path, depth: 0, hasChildren: false, open: false }))
})

const list = ref<HTMLElement | null>(null)
const active = ref('')
/** The row that takes the single tab stop: the last focused one, else the selection, else the first row. */
const tabStop = computed(() => {
  const paths = rows.value.map((row) => row.path)
  if (paths.includes(active.value)) return active.value
  return paths.includes(props.selected) ? props.selected : (paths[0] ?? '')
})

/** Chevron button and the spacer that keeps leaf rows aligned with it. */
const toggleClass = 'inline-grid h-[1.75rem] w-[1.375rem] flex-none cursor-pointer place-items-center text-muted'

function focusRow(path: string): void {
  active.value = path
  void nextTick(() =>
    [...(list.value?.querySelectorAll<HTMLElement>('[data-folder-path]') ?? [])]
      .find((element) => element.dataset.folderPath === path)
      ?.querySelector<HTMLElement>('[data-folder-select]')
      ?.focus(),
  )
}

function onKey(event: KeyboardEvent): void {
  const index = rows.value.findIndex((row) => row.path === tabStop.value)
  const row = rows.value[index]
  if (!row) return
  const move = (next: number) => {
    const target = rows.value[Math.max(0, Math.min(rows.value.length - 1, next))]
    if (target) focusRow(target.path)
  }
  if (event.key === 'ArrowDown') move(index + 1)
  else if (event.key === 'ArrowUp') move(index - 1)
  else if (event.key === 'Home') move(0)
  else if (event.key === 'End') move(rows.value.length - 1)
  else if (event.key === 'ArrowRight') {
    if (row.hasChildren && !row.open) emit('toggle', row.path, true)
    else if (row.open) move(index + 1)
  } else if (event.key === 'ArrowLeft') {
    const parent = row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : ''
    if (row.open) emit('toggle', row.path, false)
    else if (parent && !props.flat && !props.query.trim()) focusRow(parent)
  } else return
  event.preventDefault()
}

function openMenu(path: string, event: MouseEvent): void {
  event.preventDefault()
  const row = event.currentTarget as HTMLElement
  const opener = row.querySelector<HTMLElement>('[data-folder-select]')
  const fromKeyboard = event.clientX === 0 && event.clientY === 0 && event.button !== 2
  emit('menu', path, fromKeyboard && opener ? menuPointFor(opener, false) : { x: event.clientX, y: event.clientY }, opener)
}
</script>

<template>
  <ul ref="list" role="tree" :aria-label="label || undefined" @keydown="onKey">
    <li v-for="row in rows" :key="row.path" role="none">
      <div
        class="lm-row flex items-center"
        :class="{ 'is-selected': selected === row.path }"
        :style="{ paddingLeft: `calc(${row.depth} * var(--lm-space-3))` }"
        :data-folder-path="row.path"
        @contextmenu="openMenu(row.path, $event)"
      >
        <!-- Mouse affordance only: the keyboard opens and closes with Right / Left on the row. -->
        <button
          v-if="row.hasChildren"
          type="button"
          tabindex="-1"
          aria-hidden="true"
          :class="toggleClass"
          :aria-label="t(row.open ? 'folders.collapse' : 'folders.expand', { name: row.name })"
          @click="emit('toggle', row.path, !row.open)"
        >
          <AppIcon :name="row.open ? 'chevronDown' : 'chevronRight'" :size="14" />
        </button>
        <span v-else-if="!flat && !query.trim()" :class="toggleClass"></span>
        <button
          type="button"
          role="treeitem"
          data-folder-select
          class="flex h-[1.75rem] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1 text-left text-sm"
          :tabindex="row.path === tabStop ? 0 : -1"
          :aria-level="row.depth + 1"
          :aria-expanded="row.hasChildren ? row.open : undefined"
          :aria-selected="selected === row.path"
          :title="flat || query.trim() ? row.path : undefined"
          @focus="active = row.path"
          @click="emit('select', row.path)"
        >
          <AppIcon name="folder" :size="15" />
          <span class="truncate">{{ row.name }}</span>
        </button>
      </div>
    </li>
  </ul>
</template>
