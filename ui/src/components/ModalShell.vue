<script setup lang="ts">
/**
 * Native modal <dialog> shell for the action dialogs (rename, add tags, move,
 * organize). The parent mounts it while open (v-if); it opens itself, and
 * Escape / a backdrop click / the close button emit `close` - except while
 * `busy` (a request is running), when the dialog stays put.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDismissLayer } from '@/composables/useDismiss'
import { t } from '@/i18n'

const props = withDefaults(defineProps<{ title: string; titleId: string; busy?: boolean; wide?: boolean }>(), {
  busy: false,
  wide: false,
})
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let previousFocus: HTMLElement | null = null

function requestClose(): void {
  if (!props.busy) emit('close')
}

const { backdrop } = useDismissLayer({ active: () => true, close: requestClose, escape: false, backdrop: 'dialog' })

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
    class="max-h-[calc(100vh-var(--lm-space-8))] rounded-lg hairline border-border bg-elevated p-0 text-fg shadow-lg backdrop:bg-overlay"
    :class="wide ? 'w-[min(760px,calc(100vw-var(--lm-space-8)))]' : 'w-[min(480px,calc(100vw-var(--lm-space-8)))]'"
    :aria-labelledby="titleId"
    :aria-busy="busy || undefined"
    @cancel.prevent="requestClose"
    @pointerdown="backdrop.pointerdown"
    @click="backdrop.click"
  >
    <div class="flex max-h-[calc(100vh-var(--lm-space-8))] flex-col">
      <header class="flex items-start gap-2 px-5 pt-5 pb-3">
        <h2 :id="titleId" class="min-w-0 flex-1 text-lg wrap-anywhere">{{ title }}</h2>
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
    </div>
  </dialog>
</template>
