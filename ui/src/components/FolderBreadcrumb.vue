<script setup lang="ts">
/**
 * Folder breadcrumb above the grid: "All <library>", then one button per
 * segment of the selected folder; a chevron after a segment lists that
 * folder's siblings (from the loaded tree) in the shared action menu. The
 * visible page name lives here (the toolbar's h1 is screen-reader only).
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import ModelActionMenu from './ModelActionMenu.vue'
import type { FolderTree } from '@/api/types'
import { menuPointFor, type MenuPoint } from '@/composables/useCardInteractions'
import type { ActionMenuItem } from '@/utils/menuItems'
import { t } from '@/i18n'

const props = defineProps<{ section: string; folder: string; tree: FolderTree }>()
const emit = defineEmits<{ select: [path: string] }>()

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

const segments = computed(() => {
  const names = props.folder ? props.folder.split('/') : []
  let level: FolderTree | undefined = props.tree
  return names.map((name, index) => {
    const parent = names.slice(0, index).join('/')
    const siblings = Object.keys(level ?? {}).sort(byName)
    level = level?.[name]
    return { name, path: parent ? `${parent}/${name}` : name, parent, siblings }
  })
})

const menu = ref<(MenuPoint & { parent: string; name: string; items: ActionMenuItem[]; opener: HTMLElement }) | null>(null)

function openSiblings(segment: (typeof segments.value)[number], event: MouseEvent): void {
  const opener = event.currentTarget as HTMLElement
  const items = segment.siblings.map((name) => ({ action: name, label: name, icon: 'folder' as const, disabled: name === segment.name }))
  menu.value = { ...menuPointFor(opener, false), parent: segment.parent, name: segment.name, items, opener }
}

function onPick(name: string): void {
  const parent = menu.value?.parent ?? ''
  emit('select', parent ? `${parent}/${name}` : name)
}

function closeMenu(reason: 'escape' | 'outside' | 'select'): void {
  const opener = menu.value?.opener
  menu.value = null
  if (reason !== 'outside') opener?.focus()
}

const crumbClass = 'inline-flex min-h-[1.75rem] min-w-0 cursor-pointer items-center rounded-sm px-1 text-sm hover:bg-sunken hover:text-fg'
</script>

<template>
  <nav class="flex min-w-0 flex-1 items-center gap-3" :aria-label="t('crumbs.label')">
    <ol class="flex min-w-0 flex-wrap items-center gap-px text-muted">
      <li class="flex min-w-0 items-center">
        <button
          type="button"
          :class="[crumbClass, !folder && 'font-bold text-fg']"
          :aria-current="folder ? undefined : 'location'"
          @click="emit('select', '')"
        >
          {{ t('crumbs.all', { section }) }}
        </button>
      </li>
      <li v-for="(segment, index) in segments" :key="segment.path" class="flex min-w-0 items-center">
        <span class="px-px" aria-hidden="true">/</span>
        <button
          type="button"
          :class="[crumbClass, index === segments.length - 1 && 'font-bold text-fg']"
          :aria-current="index === segments.length - 1 ? 'location' : undefined"
          @click="emit('select', segment.path)"
        >
          <span class="truncate">{{ segment.name }}</span>
        </button>
        <button
          v-if="segment.siblings.length > 1"
          type="button"
          class="inline-grid size-[1.5rem] cursor-pointer place-items-center rounded-sm hover:bg-sunken hover:text-fg"
          aria-haspopup="menu"
          :aria-label="t('crumbs.siblings', { name: segment.name })"
          :title="t('crumbs.siblings', { name: segment.name })"
          @click="openSiblings(segment, $event)"
        >
          <AppIcon name="chevronDown" :size="14" />
        </button>
      </li>
    </ol>
    <ModelActionMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :label="t('crumbs.siblings', { name: menu.name })"
      :items="menu.items"
      @select="onPick"
      @close="closeMenu"
    />
  </nav>
</template>
