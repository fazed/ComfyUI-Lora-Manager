<script setup lang="ts">
/** Recursive folder tree (from the unified-folder-tree endpoint). */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { FolderTree } from '@/api/types'

defineOptions({ name: 'FolderTree' })

const props = withDefaults(defineProps<{ tree: FolderTree; selected: string; parent?: string; depth?: number }>(), {
  parent: '',
  depth: 0,
})
const emit = defineEmits<{ select: [path: string] }>()

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
</script>

<template>
  <ul class="tree" :role="depth === 0 ? 'tree' : 'group'">
    <li v-for="entry in entries" :key="entry.path" role="treeitem" :aria-expanded="entry.hasChildren ? isOpen(entry.path) : undefined" :aria-selected="selected === entry.path">
      <div class="tree__row" :class="{ 'is-selected': selected === entry.path }" :style="{ paddingLeft: `calc(${depth} * var(--lm-space-3))` }">
        <button
          v-if="entry.hasChildren"
          type="button"
          class="tree__toggle"
          :aria-label="`${isOpen(entry.path) ? 'Collapse' : 'Expand'} ${entry.name}`"
          @click="toggle(entry.path)"
        >
          <AppIcon :name="isOpen(entry.path) ? 'chevronDown' : 'chevronRight'" :size="14" />
        </button>
        <span v-else class="tree__toggle-spacer"></span>
        <button type="button" class="tree__label" @click="emit('select', entry.path)">
          <AppIcon name="folder" :size="15" />
          <span>{{ entry.name }}</span>
        </button>
      </div>
      <FolderTree
        v-if="entry.hasChildren && isOpen(entry.path)"
        :tree="entry.children"
        :selected="selected"
        :parent="entry.path"
        :depth="depth + 1"
        @select="emit('select', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.tree {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tree__row {
  display: flex;
  align-items: center;
  border-radius: var(--lm-radius-sm);
}

.tree__row:hover {
  background: var(--lm-color-sunken);
}

.tree__row.is-selected {
  background: var(--lm-color-accent-soft);
  color: var(--lm-color-accent);
}

.tree__toggle,
.tree__toggle-spacer {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 28px;
  border: 0;
  background: transparent;
  color: var(--lm-color-muted);
  cursor: pointer;
}

.tree__label {
  display: flex;
  align-items: center;
  gap: var(--lm-space-2);
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 var(--lm-space-1);
  border: 0;
  background: transparent;
  color: inherit;
  font-size: var(--lm-font-size-sm);
  text-align: left;
  cursor: pointer;
  border-radius: var(--lm-radius-sm);
}

.tree__label span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
