<script setup lang="ts">
/**
 * Per-model action menu (card "…" button or right-click). One instance lives
 * on the library page, positioned at a viewport point and kept inside the
 * viewport. WAI-ARIA menu: arrow keys / Home / End move, Escape or an outside
 * pointerdown closes (focus goes back to the opener), Tab closes.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import AppIcon, { type IconName } from './AppIcon.vue'
import { useDismissLayer } from '@/composables/useDismiss'
import { t, type MessageKey } from '@/i18n'

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

const props = defineProps<{ x: number; y: number; label: string }>()
const emit = defineEmits<{ select: [action: ModelAction]; close: [reason: 'escape' | 'outside' | 'select'] }>()

const ITEMS: { action: ModelAction; label: MessageKey; icon: IconName; danger?: boolean }[] = [
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
const MENU_WIDTH = 240
const MENU_HEIGHT = ITEMS.length * 36 + 16

const menu = ref<HTMLElement | null>(null)
const style = computed(() => {
  const width = typeof window === 'undefined' ? 1024 : window.innerWidth
  const height = typeof window === 'undefined' ? 768 : window.innerHeight
  return {
    left: `${Math.max(8, Math.min(props.x, width - MENU_WIDTH - 8))}px`,
    top: `${Math.max(8, Math.min(props.y, height - MENU_HEIGHT - 8))}px`,
    width: `${MENU_WIDTH}px`,
  }
})

useDismissLayer({ active: () => true, close: (reason) => emit('close', reason), outside: () => [menu.value] })

function buttons(): HTMLButtonElement[] {
  return [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
}

function onKey(event: KeyboardEvent): void {
  const list = buttons()
  const index = list.indexOf(document.activeElement as HTMLButtonElement)
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
    <button
      v-for="entry in ITEMS"
      :key="entry.action"
      type="button"
      role="menuitem"
      class="lm-row flex min-h-[34px] cursor-pointer items-center gap-2 px-3 text-left text-sm"
      :class="entry.danger ? 'text-danger' : ''"
      @click="emit('select', entry.action); emit('close', 'select')"
    >
      <AppIcon :name="entry.icon" :size="16" />{{ t(entry.label) }}
    </button>
  </div>
</template>
