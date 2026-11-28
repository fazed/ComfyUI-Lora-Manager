<script setup lang="ts">
/**
 * Toolbar button with a menu (library Tools and Sort, folder actions) on the
 * Reka UI DropdownMenu: arrow keys, Home / End, typeahead, Escape back to the
 * button and collision-aware placement come from the primitive. An entry
 * with `checked` renders as a checkbox item (the current sort, folder view
 * options).
 */
import AppIcon, { type IconName } from './AppIcon.vue'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface MenuEntry {
  id: string
  label: string
  icon?: IconName
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  /** Draw a separator above this entry. */
  separator?: boolean
}

const props = withDefaults(
  defineProps<{
    label: string
    icon?: IconName
    items: MenuEntry[]
    compact?: boolean
    align?: 'left' | 'right'
    buttonClass?: string
    /** Accessible name and tooltip when they differ from the visible label (must contain it). */
    hint?: string
  }>(),
  { icon: 'more', compact: false, align: 'left', buttonClass: 'lm-btn', hint: '' },
)
const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <DropdownMenu :modal="false">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        :class="buttonClass"
        :aria-label="hint || (compact ? label : undefined)"
        :title="hint || (compact ? label : undefined)"
      >
        <AppIcon :name="props.icon" :size="16" /><span v-if="!compact" class="phone:sr-only">{{ label }}</span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent :align="align === 'right' ? 'end' : 'start'" class="w-[16.25rem] max-w-[calc(100vw-1rem)]" :aria-label="hint || label">
      <template v-for="entry in props.items" :key="entry.id">
        <DropdownMenuSeparator v-if="entry.separator" />
        <DropdownMenuCheckboxItem
          v-if="entry.checked !== undefined"
          :model-value="entry.checked"
          :disabled="entry.disabled"
          @select="emit('select', entry.id)"
        >
          {{ entry.label }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem v-else :variant="entry.danger ? 'danger' : 'default'" :disabled="entry.disabled" @select="emit('select', entry.id)">
          <AppIcon v-if="entry.icon" :name="entry.icon" :size="16" />{{ entry.label }}
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
