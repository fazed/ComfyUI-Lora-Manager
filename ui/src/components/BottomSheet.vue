<script setup lang="ts">
/**
 * Phone bottom sheet on a native modal <dialog> (focus trap and inert
 * background come from the browser). The parent mounts it while open (v-if);
 * Escape, a backdrop tap or the close button emit `close`, and focus returns
 * to the opener. It sits on the dismiss stack like the other dialogs.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDismissLayer } from '@/composables/useDismiss'
import { t } from '@/i18n'

defineProps<{ title: string; titleId: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let previousFocus: HTMLElement | null = null

const { backdrop } = useDismissLayer({ active: () => true, close: () => emit('close'), escape: false, backdrop: 'dialog' })

onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null
  dialog.value?.showModal()
})
onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
  previousFocus?.focus?.()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="m-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-hidden rounded-t-lg hairline border-border bg-elevated p-0 text-fg shadow-lg backdrop:bg-overlay"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('close')"
    @pointerdown="backdrop.pointerdown"
    @click="backdrop.click"
  >
    <div class="flex max-h-[85dvh] flex-col">
      <header class="flex items-center gap-2 px-4 pt-3 pb-2">
        <h2 :id="titleId" class="min-w-0 flex-1 text-lg">{{ title }}</h2>
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
    </div>
  </dialog>
</template>
