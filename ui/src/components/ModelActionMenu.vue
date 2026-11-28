<script lang="ts">
// The entry type and the model actions live in utils/menuItems.ts (pure, tested); re-exported for existing callers.
export { MODEL_ITEMS, type ActionMenuItem, type ModelAction } from '@/utils/menuItems'
</script>

<script setup lang="ts">
/**
 * Shared context menu (card "…" button or right-click, selection, folder rows,
 * the details flyout's More actions, recipes). One instance lives on the page,
 * opened at a viewport point: the Reka UI DropdownMenu
 * (components/ui/dropdown-menu) places the menu at a zero-size virtual
 * reference there and keeps it inside the viewport. Arrow keys, Home / End, typeahead, Escape and
 * outside clicks come from the primitive; disabled entries are skipped. The
 * menu scrolls inside the viewport height instead of clipping; an entry with
 * `children` opens a submenu (Send: Append / Replace) and `group` draws a
 * caption above its entry. The caller mounts it while open (v-if) and moves
 * focus back to the opener on `close('escape')`. `items` replaces the model
 * actions; `heading` adds a non-interactive caption on top (e.g. "3 selected").
 */
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { modelActionItems, type ActionMenuItem } from '@/utils/menuItems'

const props = defineProps<{ x: number; y: number; label: string; items?: ActionMenuItem[]; heading?: string }>()
const emit = defineEmits<{ select: [action: string]; close: [reason: 'escape' | 'outside' | 'select'] }>()

const entries = computed<ActionMenuItem[]>(() => props.items ?? modelActionItems())
const reference = computed(() => ({ getBoundingClientRect: () => new DOMRect(props.x, props.y, 0, 0) }))
// Why the menu closes: Reka reports only that it closed, after the Escape / select event.
let reason: 'escape' | 'outside' | 'select' = 'outside'

function choose(entry: ActionMenuItem): void {
  reason = 'select'
  if (!entry.href) emit('select', entry.action)
}
</script>

<template>
  <DropdownMenu :open="true" @update:open="(open) => open || emit('close', reason)">
    <DropdownMenuContent
      :reference="reference"
      side="bottom"
      align="start"
      :side-offset="0"
      class="w-[15rem] max-w-[calc(100vw-1rem)]"
      :aria-label="label"
      @escape-key-down="reason = 'escape'"
      @close-auto-focus="(event: Event) => event.preventDefault()"
    >
      <DropdownMenuLabel v-if="heading" class="pt-1" aria-hidden="true">{{ heading }}</DropdownMenuLabel>
      <template v-for="entry in entries" :key="entry.action">
        <DropdownMenuSeparator v-if="entry.divider" />
        <DropdownMenuLabel v-if="entry.group">{{ entry.group }}</DropdownMenuLabel>
        <DropdownMenuSub v-if="entry.children">
          <DropdownMenuSubTrigger class="phone:min-h-touch touch:min-h-touch" :disabled="entry.disabled">
            <AppIcon :name="entry.icon" :size="16" /><span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent class="w-[15rem] max-w-[calc(100vw-1rem)]">
            <DropdownMenuItem
              v-for="child in entry.children"
              :key="child.action"
              class="phone:min-h-touch touch:min-h-touch"
              :variant="child.danger ? 'danger' : 'default'"
              :disabled="child.disabled"
              @select="choose(child)"
            >
              <AppIcon :name="child.icon" :size="16" /><span class="min-w-0 flex-1 truncate">{{ child.label }}</span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          v-else-if="entry.href && !entry.disabled"
          as-child
          class="text-fg no-underline hover:no-underline phone:min-h-touch touch:min-h-touch"
          @select="choose(entry)"
        >
          <a :href="entry.href" target="_blank" rel="noopener noreferrer">
            <AppIcon :name="entry.icon" :size="16" /><span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          v-else
          class="phone:min-h-touch touch:min-h-touch"
          :variant="entry.danger ? 'danger' : 'default'"
          :disabled="entry.disabled"
          @select="choose(entry)"
        >
          <AppIcon :name="entry.icon" :size="16" /><span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
          <span v-if="entry.shortcut" class="ml-2 flex-none text-xs text-muted tabular-nums" aria-hidden="true">{{ entry.shortcut }}</span>
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
