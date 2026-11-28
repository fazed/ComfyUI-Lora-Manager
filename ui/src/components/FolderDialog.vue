<script setup lang="ts">
/**
 * Create a folder inside a location, or rename a folder. `locations` are the
 * absolute candidates (one per library root that holds the folder); with
 * several the user picks one.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import type { ModelTools } from '@/composables/useModelTools'
import { validateFolderName } from '@/utils/modelTools'
import { t } from '@/i18n'

const props = defineProps<{ mode: 'create' | 'rename'; locations: string[]; currentName?: string; tools: ModelTools }>()
const emit = defineEmits<{ close: []; done: [name: string] }>()

const location = ref(props.locations[0] ?? '')
const name = ref(props.mode === 'rename' ? (props.currentName ?? '') : '')
const touched = ref(false)
const busy = ref(false)
const backendError = ref<string | null>(null)
const input = ref<HTMLInputElement | null>(null)

const localError = computed(() => {
  const key = validateFolderName(name.value)
  if (key) return t(key)
  if (props.mode === 'rename' && name.value.trim() === props.currentName) return t('actions.rename.errorUnchanged')
  return null
})
const shownError = computed(() => backendError.value ?? (touched.value ? localError.value : null))

onMounted(async () => {
  await nextTick()
  input.value?.focus()
  input.value?.select()
})

async function submit(): Promise<void> {
  touched.value = true
  if (localError.value || busy.value || !location.value) return
  busy.value = true
  backendError.value = null
  try {
    const failure =
      props.mode === 'create'
        ? await props.tools.createFolder(location.value, name.value)
        : await props.tools.renameFolder(location.value, name.value)
    if (failure) backendError.value = failure
    else {
      emit('done', name.value.trim())
      emit('close')
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalShell
    :title="mode === 'create' ? t('folders.createTitle') : t('folders.renameTitle', { name: currentName ?? '' })"
    title-id="folder-dialog-title"
    :busy="busy"
    @close="emit('close')"
  >
    <form class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5" novalidate @submit.prevent="submit">
      <div class="flex flex-col gap-1">
        <label class="lm-label" for="folder-location">{{ mode === 'create' ? t('folders.createIn') : t('folders.location') }}</label>
        <select v-if="locations.length > 1" id="folder-location" v-model="location" class="lm-select" :disabled="busy">
          <option v-for="entry in locations" :key="entry" :value="entry">{{ entry }}</option>
        </select>
        <p v-else id="folder-location" class="lm-mono text-sm wrap-anywhere">{{ location }}</p>
      </div>
      <div class="flex flex-col gap-1">
        <label class="lm-label" for="folder-name">{{ t('folders.name') }}</label>
        <input
          id="folder-name"
          ref="input"
          v-model="name"
          class="lm-input"
          autocomplete="off"
          spellcheck="false"
          :disabled="busy"
          :aria-invalid="!!shownError"
          aria-describedby="folder-name-hint folder-name-error"
          @input="touched = true; backendError = null"
        />
        <p v-if="mode === 'rename'" id="folder-name-hint" class="lm-hint">{{ t('folders.renameHint') }}</p>
        <p id="folder-name-error" class="lm-error-text" role="alert">{{ shownError ?? '' }}</p>
      </div>
      <div class="lm-dialog-footer">
        <button type="button" class="lm-btn" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="submit" class="lm-btn lm-btn--primary" :disabled="busy || !!localError">
          {{ mode === 'create' ? t('folders.createConfirm') : t('folders.renameConfirm') }}
        </button>
      </div>
    </form>
  </ModalShell>
</template>
