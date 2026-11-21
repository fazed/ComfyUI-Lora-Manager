<script setup lang="ts">
/**
 * Recursive folder tree (from the unified-folder-tree endpoint). Right-click
 * (or the context-menu key) on a row emits `menu` with that row's path, so the
 * page can open the folder menu for the pointed folder.
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { FolderTree } from '@/api/types'
import { menuPointFor, type MenuPoint } from '@/composables/useCardInteractions'
import { t } from '@/i18n'

defineOptions({ name: 'FolderTree' })

const props = withDefaults(defineProps<{ tree: FolderTree; selected: string; parent?: string; depth?: number }>(), {
  parent: '',
  depth: 0,
})
const emit = defineEmits<{
  select: [path: string]
  /** Open the folder menu for `path`; `opener` gets focus back when it closes. */
  menu: [path: string, point: MenuPoint, opener: HTMLElement | null]
}>()

/** Chevron button and the spacer that keeps leaf rows aligned with it. */
const toggleClass = 'inline-grid h-[28px] w-[22px] flex-none cursor-pointer place-items-center text-muted'

// Explicit user choices; folders without one open when they contain the selection.
const expanded = ref<Map<string, boolean>>(new Map())
const entries = computed(() =>
  Object.keys(props.tree)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .map((name) => {
      const path = props.parent ? `${props.parent}/${name}` : name
      return { name, path, children: props.tree[name] ?? {}, hasChildren: Object.keys(props.tree[name] ?? {}).length > 0 }
    }),
)

function isOpen(path: string): boolean {
  const explicit = expanded.value.get(path)
  if (explicit !== undefined) return explicit
  return props.selected.startsWith(path + '/')
}

function toggle(path: string): void {
  const next = new Map(expanded.value)
  next.set(path, !isOpen(path))
  expanded.value = next
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
  <ul :role="depth === 0 ? 'tree' : 'group'">
    <li
      v-for="entry in entries"
      :key="entry.path"
      role="treeitem"
      :aria-expanded="entry.hasChildren ? isOpen(entry.path) : undefined"
      :aria-selected="selected === entry.path"
    >
      <div
        class="lm-row flex items-center"
        :class="{ 'is-selected': selected === entry.path }"
        :style="{ paddingLeft: `calc(${depth} * var(--lm-space-3))` }"
        :data-folder-path="entry.path"
        @contextmenu="openMenu(entry.path, $event)"
      >
        <button
          v-if="entry.hasChildren"
          type="button"
          :class="toggleClass"
          :aria-label="t(isOpen(entry.path) ? 'folders.collapse' : 'folders.expand', { name: entry.name })"
          @click="toggle(entry.path)"
        >
          <AppIcon :name="isOpen(entry.path) ? 'chevronDown' : 'chevronRight'" :size="14" />
        </button>
        <span v-else :class="toggleClass"></span>
        <button
          type="button"
          data-folder-select
          class="flex h-[28px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1 text-left text-sm"
          @click="emit('select', entry.path)"
        >
          <AppIcon name="folder" :size="15" />
          <span class="truncate">{{ entry.name }}</span>
        </button>
      </div>
      <FolderTree
        v-if="entry.hasChildren && isOpen(entry.path)"
        :tree="entry.children"
        :selected="selected"
        :parent="entry.path"
        :depth="depth + 1"
        @select="emit('select', $event)"
        @menu="(path, point, opener) => emit('menu', path, point, opener)"
      />
    </li>
  </ul>
</template>
