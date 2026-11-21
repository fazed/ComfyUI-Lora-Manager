<script setup lang="ts">
/**
 * Toolbar button with a small WAI-ARIA menu (library "Tools", folder
 * actions). Arrow keys / Home / End move, Escape closes and returns focus to
 * the button, an outside pointerdown or Tab closes.
 */
import { nextTick, ref } from 'vue'
import AppIcon, { type IconName } from './AppIcon.vue'
import { useDismissLayer } from '@/composables/useDismiss'

export interface MenuEntry {
  id: string
  label: string
  icon?: IconName
  danger?: boolean
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{ label: string; icon?: IconName; items: MenuEntry[]; compact?: boolean; align?: 'left' | 'right'; buttonClass?: string }>(),
  { icon: 'more', compact: false, align: 'left', buttonClass: 'lm-btn' },
)
const emit = defineEmits<{ select: [id: string] }>()

const open = ref(false)
const button = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuId = `menu-${Math.random().toString(36).slice(2, 8)}`

useDismissLayer({
  active: () => open.value,
  close: (reason) => {
    open.value = false
    if (reason === 'escape') button.value?.focus()
  },
  outside: () => [menu.value, button.value],
})

function items(): HTMLButtonElement[] {
  return [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])]
}

// Fixed position from the button rect, so a scrolling/clipping parent (the folder panel) never cuts the menu.
const MENU_WIDTH = 260
const position = ref<Record<string, string>>({})

function place(): void {
  const rect = button.value?.getBoundingClientRect()
  if (!rect) return
  const viewport = window.innerWidth
  const preferred = props.align === 'right' ? rect.right - MENU_WIDTH : rect.left
  const left = Math.max(8, Math.min(preferred, viewport - MENU_WIDTH - 8))
  position.value = { top: `${rect.bottom + 4}px`, left: `${left}px`, width: `${Math.min(MENU_WIDTH, viewport - 16)}px` }
}

async function toggle(): Promise<void> {
  open.value = !open.value
  if (open.value) {
    place()
    await nextTick()
    items()[0]?.focus()
  }
}

function onKey(event: KeyboardEvent): void {
  const list = items()
  const index = list.indexOf(document.activeElement as HTMLButtonElement)
  const focus = (next: number) => list[(next + list.length) % list.length]?.focus()
  if (event.key === 'ArrowDown') focus(index + 1)
  else if (event.key === 'ArrowUp') focus(index - 1)
  else if (event.key === 'Home') focus(0)
  else if (event.key === 'End') focus(list.length - 1)
  else if (event.key === 'Tab') {
    open.value = false
    return
  } else return
  event.preventDefault()
}

function choose(entry: MenuEntry): void {
  open.value = false
  button.value?.focus()
  emit('select', entry.id)
}
</script>

<template>
  <div class="relative inline-flex">
    <button
      ref="button"
      type="button"
      :class="buttonClass"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      :aria-label="compact ? label : undefined"
      :title="compact ? label : undefined"
      @click="toggle"
    >
      <AppIcon :name="props.icon" :size="16" /><span v-if="!compact" class="phone:sr-only">{{ label }}</span>
    </button>
    <div
      v-if="open"
      :id="menuId"
      ref="menu"
      class="fixed z-70 flex flex-col rounded-md hairline border-border bg-elevated p-1 shadow-lg"
      :style="position"
      role="menu"
      :aria-label="label"
      @keydown="onKey"
    >
      <button
        v-for="entry in props.items"
        :key="entry.id"
        type="button"
        role="menuitem"
        class="lm-row flex min-h-[34px] cursor-pointer items-center gap-2 px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
        :class="entry.danger ? 'text-danger' : ''"
        :disabled="entry.disabled"
        @click="choose(entry)"
      >
        <AppIcon v-if="entry.icon" :name="entry.icon" :size="16" />{{ entry.label }}
      </button>
    </div>
  </div>
</template>
