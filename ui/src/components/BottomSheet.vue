<script setup lang="ts">
/**
 * Phone bottom sheet on the Reka UI Sheet (components/ui/sheet): focus trap,
 * inert background and focus return come from the primitive. The parent
 * mounts it while open (v-if); Escape, an outside tap or the close button
 * emit `close`.
 */
import AppIcon from './AppIcon.vue'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { t } from '@/i18n'

defineProps<{ title: string; titleId: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Sheet :open="true" @update:open="(open) => open || emit('close')">
    <SheetContent side="bottom" :aria-labelledby="titleId" :aria-describedby="undefined">
      <header class="flex items-center gap-2 px-4 pt-3 pb-2">
        <SheetTitle as-child>
          <h2 :id="titleId" class="min-w-0 flex-1 text-lg font-bold">{{ title }}</h2>
        </SheetTitle>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon min-h-touch min-w-touch flex-none" :aria-label="t('common.close')" @click="emit('close')">
          <AppIcon name="close" :size="18" />
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="hairline-t border-border px-4 py-3">
        <slot name="footer" />
      </footer>
    </SheetContent>
  </Sheet>
</template>
