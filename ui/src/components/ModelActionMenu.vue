<script lang="ts">
import type { IconName } from './AppIcon.vue'
import type { MessageKey } from '@/i18n'

export type ModelAction =
  | 'move'
  | 'rename'
  | 'template'
  | 'preview'
  | 'rating'
  | 'refresh'
  | 'relink'
  | 'exclude'
  | 'delete'

export interface ActionMenuItem {
  action: string
  label: string
  icon: IconName
  danger?: boolean
  /** External link: rendered as an anchor that opens in a new tab (no select event). */
  href?: string
  /** Draws a separator line above the entry. */
  divider?: boolean
}


/** The model actions of the card menu and the drawer's "More actions" menu, in this order. */
export const MODEL_ITEMS: { action: ModelAction; label: MessageKey; icon: IconName; danger?: boolean }[] = [
  { action: 'move', label: 'actions.move', icon: 'folderMove' },
  { action: 'rename', label: 'actions.rename', icon: 'pencil' },
  { action: 'template', label: 'tools.template.open', icon: 'type' },
  { action: 'preview', label: 'tools.preview.open', icon: 'image' },
  { action: 'rating', label: 'tools.nsfw.open', icon: 'shield' },
  { action: 'refresh', label: 'tools.refresh.open', icon: 'refresh' },
  { action: 'relink', label: 'tools.relink.open', icon: 'link' },
  { action: 'exclude', label: 'actions.exclude', icon: 'eyeOff' },
  { action: 'delete', label: 'actions.delete', icon: 'trash', danger: true },
]
</script>

<script setup lang="ts">
/**
 * Per-model action menu (card "…" button or right-click). One instance lives
 * on the library page, positioned at a viewport point and kept inside the
 * viewport. WAI-ARIA menu: arrow keys / Home / End move, Escape or an outside
 * pointerdown closes (focus goes back to the opener), Tab closes.
 * `items` replaces the model actions (the recipes page passes its own list).
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDismissLayer } from '@/composables/useDismiss'
import { t } from '@/i18n'

const props = defineProps<{ x: number; y: number; label: string; items?: ActionMenuItem[] }>()
const emit = defineEmits<{ select: [action: string]; close: [reason: 'escape' | 'outside' | 'select'] }>()

const MENU_WIDTH = 240
const entries = computed<ActionMenuItem[]>(() => props.items ?? MODEL_ITEMS.map((entry) => ({ ...entry, label: t(entry.label) })))

const menu = ref<HTMLElement | null>(null)
const style = computed(() => {
  const width = typeof window === 'undefined' ? 1024 : window.innerWidth
  const height = typeof window === 'undefined' ? 768 : window.innerHeight
  return {
    left: `${Math.max(8, Math.min(props.x, width - MENU_WIDTH - 8))}px`,
    top: `${Math.max(8, Math.min(props.y, height - (entries.value.length * 36 + 20) - 8))}px`,
    width: `${MENU_WIDTH}px`,
  }
})

useDismissLayer({ active: () => true, close: (reason) => emit('close', reason), outside: () => [menu.value] })

function buttons(): HTMLElement[] {
  return [...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
}

function onKey(event: KeyboardEvent): void {
  const list = buttons()
  const index = list.indexOf(document.activeElement as HTMLElement)
  const focus = (next: number) => list[(next + list.length) % list.length]?.focus()
  if (event.key === 'ArrowDown') focus(index + 1)
  else if (event.key === 'ArrowUp') focus(index - 1)
  else if (event.key === 'Home') focus(0)
  else if (event.key === 'End') focus(list.length - 1)
  else if (event.key === 'Tab') return emit('close', 'outside')
  else return
  event.preventDefault()
}

onMounted(async () => {
  await nextTick()
  buttons()[0]?.focus()
})
</script>

<template>
  <div
    ref="menu"
    class="fixed z-70 flex flex-col rounded-md hairline border-border bg-elevated p-1 shadow-lg"
    :style="style"
    role="menu"
    :aria-label="label"
    @keydown="onKey"
  >
    <template v-for="entry in entries" :key="entry.action">
      <a
        v-if="entry.href"
        role="menuitem"
        class="lm-row flex min-h-[34px] cursor-pointer items-center gap-2 px-3 text-left text-sm touch:min-h-touch"
        :class="entry.divider ? 'mt-1 hairline-t border-border' : ''"
        :href="entry.href"
        target="_blank"
        rel="noopener noreferrer"
        @click="emit('close', 'select')"
      >
        <AppIcon :name="entry.icon" :size="16" />{{ entry.label }}
      </a>
      <button
        v-else
        type="button"
        role="menuitem"
        class="lm-row flex min-h-[34px] cursor-pointer items-center gap-2 px-3 text-left text-sm touch:min-h-touch"
        :class="[entry.danger ? 'text-danger' : '', entry.divider ? 'mt-1 hairline-t border-border' : '']"
        @click="emit('select', entry.action); emit('close', 'select')"
      >
        <AppIcon :name="entry.icon" :size="16" />{{ entry.label }}
      </button>
    </template>
  </div>
</template>
