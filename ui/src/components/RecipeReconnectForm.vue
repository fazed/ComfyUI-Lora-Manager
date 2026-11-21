<script setup lang="ts">
/**
 * Inline "reconnect to a library model" form of the recipe drawer (classic
 * RecipeModal reconnect container): ranked suggestions from the backend
 * (search-as-you-type), a free text field that also takes `<lora:name:1>`
 * syntax, and the backend's error message when the name does not resolve.
 */
import { nextTick, onMounted, ref, watch } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import { recipesApi } from '@/api/recipes'
import type { ReconnectSuggestion } from '@/api/types'
import type { ReconnectResult } from '@/composables/useRecipeActions'
import { withMountPrefix } from '@/utils/basePath'
import { t, type MessageKey } from '@/i18n'

const props = defineProps<{
  recipeId: string
  /** LoRA index, or 'checkpoint'. */
  target: number | 'checkpoint'
  submit: (value: string) => Promise<ReconnectResult>
}>()
const emit = defineEmits<{ done: []; cancel: [] }>()

const value = ref('')
const suggestions = ref<ReconnectSuggestion[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const input = ref<HTMLInputElement | null>(null)
const id = `reconnect-${props.recipeId}-${props.target}`
let controller: AbortController | null = null

const REASONS: Record<string, MessageKey> = {
  same_hash: 'recipes.reconnect.reason.sameHash',
  same_version: 'recipes.reconnect.reason.sameVersion',
  similar_filename: 'recipes.reconnect.reason.similarFile',
  similar_name: 'recipes.reconnect.reason.similarName',
}

async function load(query: string): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  try {
    suggestions.value =
      props.target === 'checkpoint'
        ? await recipesApi.checkpointSuggestions(props.recipeId, query, controller.signal)
        : await recipesApi.reconnectSuggestions(props.recipeId, props.target, query, controller.signal)
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') suggestions.value = []
  } finally {
    loading.value = false
  }
}

const { start: searchLater, stop: cancelSearch } = useTimeoutFn(() => void load(value.value), 250, { immediate: false })
watch(value, () => {
  error.value = null
  cancelSearch()
  searchLater()
})

onMounted(async () => {
  void load('')
  await nextTick()
  input.value?.focus()
})

async function choose(name: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const result = await props.submit(name)
    if (result.ok) emit('done')
    else error.value = result.error
  } finally {
    busy.value = false
  }
}

function onKey(event: KeyboardEvent): void {
  // Escape closes the form only; preventDefault keeps the drawer's Escape handler out.
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
  }
}
</script>

<template>
  <div class="mt-2 flex flex-col gap-2 rounded-md hairline border-border bg-surface p-3" @keydown="onKey">
    <label class="lm-label" :for="id">{{ t(target === 'checkpoint' ? 'recipes.reconnect.labelCheckpoint' : 'recipes.reconnect.label') }}</label>
    <form class="flex gap-2" @submit.prevent="choose(value)">
      <input
        :id="id"
        ref="input"
        v-model="value"
        class="lm-input min-w-0 flex-1 font-mono"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('recipes.reconnect.placeholder')"
        :aria-describedby="`${id}-error`"
        :disabled="busy"
      />
      <button type="submit" class="lm-btn lm-btn--primary" :disabled="busy || !value.trim()">{{ t('recipes.reconnect.confirm') }}</button>
      <button type="button" class="lm-btn" :disabled="busy" @click="emit('cancel')">{{ t('common.cancel') }}</button>
    </form>
    <p :id="`${id}-error`" class="lm-error-text" role="alert">{{ error ?? '' }}</p>
    <div role="group" :aria-label="t('recipes.reconnect.suggestions')">
      <p v-if="loading && !suggestions.length" class="text-sm text-muted">{{ t('recipes.reconnect.searching') }}</p>
      <p v-else-if="!suggestions.length" class="text-sm text-muted">{{ t('recipes.reconnect.noSuggestions') }}</p>
      <ul v-else class="flex flex-col gap-1">
        <li v-for="suggestion in suggestions" :key="suggestion.file_path || suggestion.target_name">
          <button
            type="button"
            class="lm-row flex w-full cursor-pointer items-center gap-2 p-1 text-left"
            :disabled="busy"
            @click="choose(suggestion.target_name)"
          >
            <LazyMedia
              class="size-[36px] flex-none overflow-hidden rounded-sm"
              media-class="size-full object-cover"
              :src="suggestion.preview_url ? withMountPrefix(suggestion.preview_url) : ''"
              :icon-size="16"
            />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium">{{ suggestion.target_name }}</span>
              <span class="truncate text-xs text-muted">
                {{ [suggestion.model_name, suggestion.base_model].filter(Boolean).join(' · ') }}
              </span>
            </span>
            <span class="lm-badge flex-none">{{ REASONS[suggestion.match_reason ?? ''] ? t(REASONS[suggestion.match_reason ?? '']) : suggestion.match_reason }}</span>
            <AppIcon name="link" :size="14" class="flex-none text-muted" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
