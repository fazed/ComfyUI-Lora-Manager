<script setup lang="ts">
/**
 * One-field dialog (rename, bulk add tags). `validate` runs while typing;
 * `submit` resolves to null on success (the dialog closes) or to an error
 * message from the backend, shown under the field.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import { t } from '@/i18n'

const props = defineProps<{
  title: string
  label: string
  hint?: string
  initial?: string
  confirmLabel: string
  validate: (value: string) => string | null
  submit: (value: string) => Promise<string | null>
}>()
const emit = defineEmits<{ close: [] }>()

const value = ref(props.initial ?? '')
const touched = ref(false)
const busy = ref(false)
const backendError = ref<string | null>(null)
const input = ref<HTMLInputElement | null>(null)
const id = `input-dialog-${Math.random().toString(36).slice(2, 8)}`

const localError = computed(() => props.validate(value.value))
const shownError = computed(() => backendError.value ?? (touched.value ? localError.value : null))

onMounted(async () => {
  await nextTick()
  input.value?.focus()
  input.value?.select()
})

function onInput(): void {
  touched.value = true
  backendError.value = null
}

async function onSubmit(): Promise<void> {
  touched.value = true
  if (localError.value || busy.value) return
  busy.value = true
  try {
    const error = await props.submit(value.value)
    if (error) backendError.value = error
    else emit('close')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalShell :title="title" :title-id="`${id}-title`" :busy="busy" @close="emit('close')">
    <form class="flex flex-col gap-4 px-5 pb-5" novalidate @submit.prevent="onSubmit">
      <div class="flex flex-col gap-1">
        <label class="lm-label" :for="id">{{ label }}</label>
        <input
          :id="id"
          ref="input"
          v-model="value"
          class="lm-input font-mono"
          autocomplete="off"
          spellcheck="false"
          :disabled="busy"
          :aria-invalid="!!shownError"
          :aria-describedby="`${id}-hint ${id}-error`"
          @input="onInput"
        />
        <p v-if="hint" :id="`${id}-hint`" class="lm-hint">{{ hint }}</p>
        <p :id="`${id}-error`" class="lm-error-text min-h-[1.2em]" role="alert">{{ shownError ?? '' }}</p>
      </div>
      <div class="flex justify-end gap-2">
        <button type="button" class="lm-btn" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="submit" class="lm-btn lm-btn--primary" :disabled="busy || !!localError">
          {{ busy ? t('common.loading') : confirmLabel }}
        </button>
      </div>
    </form>
  </ModalShell>
</template>
