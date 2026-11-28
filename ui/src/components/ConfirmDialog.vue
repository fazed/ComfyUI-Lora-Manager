<script setup lang="ts">
/**
 * The app-wide confirm (useConfirm) on the Reka UI AlertDialog: Escape answers
 * "cancel", an outside click does nothing, focus starts on Cancel and returns
 * to the opener.
 */
import { ref } from 'vue'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useConfirm } from '@/composables/useFeedback'
import { t } from '@/i18n'

const { confirmState } = useConfirm()
const cancel = ref<HTMLButtonElement | null>(null)

function answer(value: boolean): void {
  confirmState.value?.resolve(value)
}

function focusCancel(event: Event): void {
  event.preventDefault()
  cancel.value?.focus()
}
</script>

<template>
  <AlertDialog :open="!!confirmState" @update:open="(open) => open || answer(false)">
    <AlertDialogContent v-if="confirmState" class="p-0" @open-auto-focus="focusCancel">
      <form class="flex max-h-[calc(100vh-var(--lm-space-8))] flex-col" @submit.prevent="answer(true)">
        <AlertDialogTitle class="hairline-b border-border px-5 py-3">{{ confirmState.title }}</AlertDialogTitle>
        <AlertDialogDescription class="min-h-0 overflow-y-auto px-5 py-4 whitespace-pre-line">{{ confirmState.message }}</AlertDialogDescription>
        <div class="flex justify-end gap-2 hairline-t border-border px-5 py-3">
          <button ref="cancel" type="button" class="lm-btn" @click="answer(false)">{{ confirmState.cancelLabel ?? t('common.cancel') }}</button>
          <button type="submit" class="lm-btn" :class="confirmState.danger ? 'lm-btn--danger' : 'lm-btn--primary'">
            {{ confirmState.confirmLabel }}
          </button>
        </div>
      </form>
    </AlertDialogContent>
  </AlertDialog>
</template>
