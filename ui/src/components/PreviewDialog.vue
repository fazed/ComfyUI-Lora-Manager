<script setup lang="ts">
/**
 * Replace a model's preview (file upload or image URL) with its content
 * rating; `mode="rating"` only changes the rating of the current preview.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import ModalShell from './ModalShell.vue'
import type { ModelItem } from '@/api/types'
import type { ModelTools } from '@/composables/useModelTools'
import { NSFW_LEVELS } from '@/utils/modelTools'
import { t } from '@/i18n'

const props = defineProps<{ item: ModelItem; tools: ModelTools; mode: 'preview' | 'rating' }>()
const emit = defineEmits<{ close: [] }>()

const name = props.item.model_name || props.item.file_name
const level = ref<number>(props.item.preview_nsfw_level ?? 0)
const file = ref<File | null>(null)
const url = ref('')
const objectUrl = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

const canSave = computed(
  () =>
    !busy.value &&
    (props.mode === 'rating' ? level.value > 0 && level.value !== (props.item.preview_nsfw_level ?? 0) : !!file.value || !!url.value.trim()),
)

function onFile(event: Event): void {
  const chosen = (event.target as HTMLInputElement).files?.[0] ?? null
  file.value = chosen
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  objectUrl.value = chosen ? URL.createObjectURL(chosen) : ''
  if (chosen) url.value = ''
  error.value = null
}
onBeforeUnmount(() => {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
})

async function save(): Promise<void> {
  if (!canSave.value) return
  busy.value = true
  error.value = null
  try {
    if (props.mode === 'rating') {
      if (await props.tools.setNsfwLevel(props.item, level.value)) emit('close')
      return
    }
    if (!file.value && !url.value.trim()) {
      error.value = t('tools.preview.needSource')
      return
    }
    const failure = await props.tools.replacePreview(props.item, { file: file.value, url: url.value }, level.value)
    if (failure) error.value = failure
    else emit('close')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalShell
    :title="mode === 'rating' ? t('tools.nsfw.title', { name }) : t('tools.preview.title', { name })"
    title-id="preview-dialog-title"
    :busy="busy"
    @close="emit('close')"
  >
    <form class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5" novalidate @submit.prevent="save">
      <template v-if="mode === 'preview'">
        <p class="rounded-md bg-warning-soft p-3 text-sm">{{ t('tools.preview.warning') }}</p>
        <div class="flex flex-col gap-1">
          <label class="lm-label" for="preview-file">{{ t('tools.preview.file') }}</label>
          <input id="preview-file" class="lm-input" type="file" accept="image/*,video/mp4,video/webm" :disabled="busy" @change="onFile" />
        </div>
        <LazyMedia v-if="objectUrl" class="h-[200px] w-full rounded-md bg-sunken" media-class="size-full object-contain" :src="objectUrl" :kind="file?.type.startsWith('video/') ? 'video' : 'image'" />
        <div class="flex flex-col gap-1">
          <label class="lm-label" for="preview-url">{{ t('tools.preview.url') }}</label>
          <input
            id="preview-url"
            v-model="url"
            class="lm-input font-mono"
            type="url"
            autocomplete="off"
            :disabled="busy || !!file"
            aria-describedby="preview-url-hint"
          />
          <p id="preview-url-hint" class="lm-hint">{{ t('tools.preview.urlHint') }}</p>
        </div>
      </template>
      <p v-else class="lm-hint">{{ t('tools.nsfw.hint') }}</p>

      <fieldset class="flex flex-col gap-2" :disabled="busy">
        <legend class="lm-label mb-1">{{ mode === 'rating' ? t('tools.nsfw.label') : t('tools.preview.level') }}</legend>
        <div class="flex flex-wrap gap-1" role="radiogroup">
          <label v-if="mode === 'preview'" class="lm-chip relative cursor-pointer has-focus-visible:focus-ring" :class="{ 'lm-chip--active': level === 0 }">
            <input v-model="level" class="sr-only" type="radio" name="nsfw-level" :value="0" />{{ t('tools.nsfw.unrated') }}
          </label>
          <label v-for="entry in NSFW_LEVELS" :key="entry.value" class="lm-chip relative cursor-pointer has-focus-visible:focus-ring" :class="{ 'lm-chip--active': level === entry.value }">
            <input v-model="level" class="sr-only" type="radio" name="nsfw-level" :value="entry.value" />{{ entry.label }}
          </label>
        </div>
      </fieldset>

      <p class="lm-error-text" role="alert">{{ error ?? '' }}</p>
      <div class="lm-dialog-footer">
        <button type="button" class="lm-btn" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="submit" class="lm-btn lm-btn--primary" :disabled="!canSave">
          <AppIcon :name="mode === 'rating' ? 'shield' : 'image'" :size="16" />
          {{ mode === 'rating' ? t('tools.nsfw.save') : busy ? t('tools.preview.saving') : t('tools.preview.save') }}
        </button>
      </div>
    </form>
  </ModalShell>
</template>
