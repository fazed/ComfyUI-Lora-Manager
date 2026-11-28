<script setup lang="ts">
/**
 * Target-node picker for "Send to ComfyUI" when the workflow has several LoRA
 * nodes. On the Reka UI Dialog, so it also opens above the details flyout;
 * Escape and an outside click cancel the pick.
 */
import { computed, ref, watch } from 'vue'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useNodePicker } from '@/composables/useSendToWorkflow'
import { nodeLabel } from '@/utils/workflow'
import { t } from '@/i18n'

const { pickerState } = useNodePicker()
const checked = ref<string[]>([])

const entries = computed(() =>
  Object.entries(pickerState.value?.nodes ?? {})
    .map(([key, node]) => ({ key, label: nodeLabel(node) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
)

watch(pickerState, (state) => {
  checked.value = state ? Object.keys(state.nodes).slice(0, 1) : []
})

function answer(keys: string[] | null): void {
  pickerState.value?.resolve(keys)
}
</script>

<template>
  <Dialog :open="!!pickerState" @update:open="(open) => open || answer(null)">
    <DialogContent
      :show-close-button="false"
      class="block w-[min(27.5rem,calc(100vw-var(--lm-space-8)))] max-w-none p-0"
      aria-labelledby="node-picker-title"
      :aria-describedby="undefined"
    >
      <form v-if="pickerState" class="flex max-h-[calc(100vh-var(--lm-space-8))] flex-col" @submit.prevent="answer(checked)">
        <DialogTitle as-child>
          <h2 id="node-picker-title" class="hairline-b border-border px-5 py-3 text-lg">
            {{ t(pickerState.mode === 'replace' ? 'workflow.pickTitleReplace' : 'workflow.pickTitleAppend') }}
          </h2>
        </DialogTitle>
        <p class="px-5 pt-4 pb-3 text-sm text-muted">{{ t('workflow.pickHint') }}</p>
        <fieldset class="flex min-h-0 flex-col gap-1 overflow-y-auto px-5 pb-4">
          <legend class="sr-only">{{ t('workflow.pickLegend') }}</legend>
          <label v-for="entry in entries" :key="entry.key" class="lm-check lm-row px-2 py-1 text-sm">
            <input v-model="checked" type="checkbox" :value="entry.key" />
            <span class="wrap-anywhere">{{ entry.label }}</span>
          </label>
        </fieldset>
        <div class="flex flex-wrap justify-end gap-2 hairline-t border-border px-5 py-3">
          <button type="button" class="lm-btn" @click="answer(null)">{{ t('common.cancel') }}</button>
          <button type="button" class="lm-btn" @click="answer(entries.map((entry) => entry.key))">{{ t('workflow.sendAll') }}</button>
          <button type="submit" class="lm-btn lm-btn--primary" :disabled="!checked.length">{{ t('workflow.send') }}</button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
