<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useDismissLayer } from '@/composables/useDismiss'
import { useConfirm } from '@/composables/useFeedback'
import { t } from '@/i18n'

const { confirmState } = useConfirm()
const dialog = ref<HTMLDialogElement | null>(null)

watch(confirmState, async (state) => {
  await nextTick()
  const el = dialog.value
  if (!el) return
  if (state && !el.open) el.showModal()
  if (!state && el.open) el.close()
})

function answer(value: boolean): void {
  confirmState.value?.resolve(value)
}

// Escape (native cancel) and a backdrop click both answer "cancel".
const { backdrop } = useDismissLayer({
  active: () => !!confirmState.value,
  close: () => answer(false),
  escape: false,
  backdrop: 'dialog',
})
</script>

<template>
  <dialog
    ref="dialog"
    class="w-[min(440px,calc(100vw-var(--lm-space-8)))] rounded-lg hairline border-border bg-elevated p-5 text-fg shadow-lg backdrop:bg-overlay"
    aria-labelledby="confirm-title"
    aria-describedby="confirm-message"
    @cancel.prevent="answer(false)"
    @close="!dialog?.open && answer(false)"
    @pointerdown="backdrop.pointerdown"
    @click="backdrop.click"
  >
    <form v-if="confirmState" method="dialog" @submit.prevent="answer(true)">
      <h2 id="confirm-title" class="text-lg">{{ confirmState.title }}</h2>
      <p id="confirm-message" class="mt-3 mb-5 max-h-[55vh] overflow-y-auto whitespace-pre-line text-muted">{{ confirmState.message }}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="lm-btn" autofocus @click="answer(false)">{{ confirmState.cancelLabel ?? t('common.cancel') }}</button>
        <button type="submit" class="lm-btn" :class="confirmState.danger ? 'lm-btn--danger' : 'lm-btn--primary'">
          {{ confirmState.confirmLabel }}
        </button>
      </div>
    </form>
  </dialog>
</template>
