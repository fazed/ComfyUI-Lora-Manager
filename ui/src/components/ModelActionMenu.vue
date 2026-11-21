<script lang="ts">
// The entry type and the model actions live in utils/menuItems.ts (pure, tested); re-exported for existing callers.
export { MODEL_ITEMS, type ActionMenuItem, type ModelAction } from '@/utils/menuItems'
</script>

<script setup lang="ts">
/**
 * Shared context menu (card "…" button or right-click, selection, folder rows,
 * the drawer's More actions, recipes). One instance lives on the page,
 * positioned at a viewport point and kept inside the viewport. WAI-ARIA menu:
 * arrow keys / Home / End move (disabled entries are focusable but inert),
 * Escape or an outside pointerdown closes (focus goes back to the opener), Tab
 * closes. `items` replaces the model actions; `heading` adds a non-interactive
 * caption on top (e.g. "3 selected").
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDismissLayer } from '@/composables/useDismiss'
import { modelActionItems, type ActionMenuItem } from '@/utils/menuItems'

const props = defineProps<{ x: number; y: number; label: string; items?: ActionMenuItem[]; heading?: string }>()
const emit = defineEmits<{ select: [action: string]; close: [reason: 'escape' | 'outside' | 'select'] }>()

const MENU_WIDTH = 240
const ROW_HEIGHT = 36
const entries = computed<ActionMenuItem[]>(() => props.items ?? modelActionItems())

const menu = ref<HTMLElement | null>(null)
const style = computed(() => {
  const width = typeof window === 'undefined' ? 1024 : window.innerWidth
  const height = typeof window === 'undefined' ? 768 : window.innerHeight
  const estimated = entries.value.length * ROW_HEIGHT + (props.heading ? 30 : 0) + 20
  return {
    left: `${Math.max(8, Math.min(props.x, width - MENU_WIDTH - 8))}px`,
    top: `${Math.max(8, Math.min(props.y, height - estimated - 8))}px`,
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

function choose(entry: ActionMenuItem): void {
  if (entry.disabled) return
  emit('select', entry.action)
  emit('close', 'select')
}

onMounted(async () => {
  await nextTick()
  const list = buttons()
  ;(list.find((button) => button.getAttribute('aria-disabled') !== 'true') ?? list[0])?.focus()
})

const rowClass =
  'lm-row flex min-h-[34px] cursor-pointer items-center gap-2 px-3 text-left text-sm phone:min-h-touch touch:min-h-touch aria-disabled:cursor-not-allowed aria-disabled:opacity-60'
</script>

<template>
  <div
    ref="menu"
    class="fixed z-70 flex max-h-[calc(100dvh-16px)] flex-col overflow-y-auto rounded-md hairline border-border bg-elevated p-1 shadow-lg"
    :style="style"
    role="menu"
    :aria-label="label"
    @keydown="onKey"
    @contextmenu.prevent
  >
    <p v-if="heading" class="truncate px-3 pt-1 pb-1 text-xs font-medium text-muted" aria-hidden="true">{{ heading }}</p>
    <template v-for="entry in entries" :key="entry.action">
      <a
        v-if="entry.href && !entry.disabled"
        role="menuitem"
        :class="[rowClass, 'text-fg no-underline hover:no-underline', entry.divider ? 'mt-1 hairline-t border-border' : '']"
        :href="entry.href"
        target="_blank"
        rel="noopener noreferrer"
        @click="emit('close', 'select')"
      >
        <AppIcon :name="entry.icon" :size="16" /><span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
      </a>
      <button
        v-else
        type="button"
        role="menuitem"
        :class="[rowClass, entry.danger ? 'text-danger' : '', entry.divider ? 'mt-1 hairline-t border-border' : '']"
        :aria-disabled="entry.disabled ? 'true' : undefined"
        @click="choose(entry)"
      >
        <AppIcon :name="entry.icon" :size="16" /><span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
        <span v-if="entry.shortcut" class="ml-2 flex-none text-xs text-muted tabular-nums" aria-hidden="true">{{ entry.shortcut }}</span>
      </button>
    </template>
  </div>
</template>
