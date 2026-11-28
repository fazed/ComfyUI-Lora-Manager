<script setup lang="ts">
/**
 * Filters button of the library toolbar with its flyout: a non-modal Popover
 * (labelled "Filters") holding the page's filter groups, with Clear all and a
 * close button in a sticky header. `open` is a model so the toolbar's `f`
 * shortcut can toggle it.
 */
import AppIcon from './AppIcon.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SHORTCUTS } from '@/config/shortcuts'
import { t } from '@/i18n'

defineProps<{ count: number; id: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ clear: [] }>()
defineSlots<{ default(): unknown }>()
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button type="button" class="lm-btn flex-none" :aria-keyshortcuts="SHORTCUTS.filters.aria" :title="`${t('library.filters')} (F)`">
        <AppIcon name="filter" :size="16" />{{ t('library.filters') }}
        <span v-if="count" class="lm-badge lm-badge--accent">{{ count }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent
      align="start"
      class="flex max-h-[min(36rem,calc(100vh-9rem))] w-[min(24rem,calc(100vw-var(--lm-space-6)))] flex-col overflow-hidden p-0"
      :aria-label="t('library.filters')"
    >
      <header class="flex items-center gap-2 hairline-b border-border px-4 py-2">
        <h2 class="min-w-0 flex-1 text-md font-bold">{{ t('library.filters') }}</h2>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm" :disabled="!count" @click="emit('clear')">{{ t('library.clearFilters') }}</button>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('filters.close')" @click="open = false">
          <AppIcon name="close" :size="14" />
        </button>
      </header>
      <div :id="id" class="min-h-0 flex-1 overflow-y-auto p-4">
        <slot />
      </div>
    </PopoverContent>
  </Popover>
</template>
