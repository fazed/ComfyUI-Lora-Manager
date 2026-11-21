<script setup lang="ts">
/** Target-node picker for "Send to ComfyUI" when the workflow has several LoRA nodes. */
import { computed, nextTick, ref, watch } from 'vue'
import { useNodePicker } from '@/composables/useSendToWorkflow'
import { nodeLabel } from '@/utils/workflow'
import { t } from '@/i18n'

const { pickerState } = useNodePicker()
const dialog = ref<HTMLDialogElement | null>(null)
const checked = ref<string[]>([])

const entries = computed(() =>
  Object.entries(pickerState.value?.nodes ?? {})
    .map(([key, node]) => ({ key, label: nodeLabel(node) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
)

watch(pickerState, async (state) => {
  checked.value = state ? Object.keys(state.nodes).slice(0, 1) : []
  await nextTick()
  const el = dialog.value
  if (!el) return
  if (state && !el.open) el.showModal()
  if (!state && el.open) el.close()
})

function answer(keys: string[] | null): void {
  pickerState.value?.resolve(keys)
}
</script>

<template>
  <dialog
    ref="dialog"
    class="w-[min(440px,calc(100vw-var(--lm-space-8)))] rounded-lg hairline border-border bg-elevated p-5 text-fg shadow-lg backdrop:bg-overlay"
    aria-labelledby="node-picker-title"
    @cancel.prevent="answer(null)"
  >
    <form v-if="pickerState" method="dialog" @submit.prevent="answer(checked)">
      <h2 id="node-picker-title" class="text-lg">
        {{ t(pickerState.mode === 'replace' ? 'workflow.pickTitleReplace' : 'workflow.pickTitleAppend') }}
      </h2>
      <p class="mt-2 mb-3 text-sm text-muted">{{ t('workflow.pickHint') }}</p>
      <fieldset class="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
        <legend class="sr-only">{{ t('workflow.pickLegend') }}</legend>
        <label v-for="entry in entries" :key="entry.key" class="lm-check lm-row px-2 py-1 text-sm">
          <input v-model="checked" type="checkbox" :value="entry.key" />
          <span class="wrap-anywhere">{{ entry.label }}</span>
        </label>
      </fieldset>
      <div class="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" class="lm-btn" @click="answer(null)">{{ t('common.cancel') }}</button>
        <button type="button" class="lm-btn" @click="answer(entries.map((entry) => entry.key))">{{ t('workflow.sendAll') }}</button>
        <button type="submit" class="lm-btn lm-btn--primary" :disabled="!checked.length">{{ t('workflow.send') }}</button>
      </div>
    </form>
  </dialog>
</template>
