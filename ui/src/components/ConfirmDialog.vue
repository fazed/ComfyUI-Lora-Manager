<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
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
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm"
    aria-labelledby="confirm-title"
    aria-describedby="confirm-message"
    @cancel.prevent="answer(false)"
  >
    <form v-if="confirmState" method="dialog" @submit.prevent="answer(true)">
      <h2 id="confirm-title" class="confirm__title">{{ confirmState.title }}</h2>
      <p id="confirm-message" class="confirm__message">{{ confirmState.message }}</p>
      <div class="confirm__actions">
        <button type="button" class="lm-btn" autofocus @click="answer(false)">{{ t('common.cancel') }}</button>
        <button type="submit" class="lm-btn" :class="confirmState.danger ? 'lm-btn--danger' : 'lm-btn--primary'">
          {{ confirmState.confirmLabel }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.confirm {
  width: min(440px, calc(100vw - var(--lm-space-8)));
  padding: var(--lm-space-5);
  border: var(--lm-border-width) solid var(--lm-color-border);
  border-radius: var(--lm-radius-lg);
  background: var(--lm-color-elevated);
  color: var(--lm-color-text);
  box-shadow: var(--lm-shadow-lg);
}

.confirm::backdrop {
  background: var(--lm-color-overlay);
}

.confirm__title {
  font-size: var(--lm-font-size-lg);
}

.confirm__message {
  margin: var(--lm-space-3) 0 var(--lm-space-5);
  color: var(--lm-color-muted);
}

.confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--lm-space-2);
}
</style>
