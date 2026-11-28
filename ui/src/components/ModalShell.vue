<script setup lang="ts">
/**
 * Modal shell for the action dialogs (rename, add tags, move, organize, ...)
 * on the Reka UI Dialog (components/ui/dialog): focus trap, focus return and
 * the inert background come from the primitive. The parent mounts it while
 * open (v-if); Escape, an outside click or the close button emit `close` -
 * except while `busy` (a request is running), when the dialog stays put.
 */
import AppIcon from './AppIcon.vue'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n'

const props = withDefaults(defineProps<{ title: string; titleId: string; busy?: boolean; wide?: boolean }>(), {
  busy: false,
  wide: false,
})
const emit = defineEmits<{ close: [] }>()

function requestClose(): void {
  if (!props.busy) emit('close')
}
</script>

<template>
  <Dialog :open="true" @update:open="(open) => open || requestClose()">
    <DialogContent
      :show-close-button="false"
      class="flex max-h-[calc(100vh-var(--lm-space-8))] max-w-none flex-col gap-0 overflow-hidden p-0"
      :class="wide ? 'w-[min(47.5rem,calc(100vw-var(--lm-space-8)))]' : 'w-[min(30rem,calc(100vw-var(--lm-space-8)))]'"
      :aria-labelledby="titleId"
      :aria-describedby="undefined"
      :aria-busy="busy || undefined"
    >
      <header class="mb-4 flex flex-none items-center gap-2 hairline-b border-border py-3 pr-3 pl-5">
        <DialogTitle as-child>
          <h2 :id="titleId" class="min-w-0 flex-1 text-lg font-bold wrap-anywhere">{{ title }}</h2>
        </DialogTitle>
        <button
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm flex-none"
          :aria-label="t('common.close')"
          :disabled="busy"
          @click="requestClose"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </header>
      <slot />
    </DialogContent>
  </Dialog>
</template>
