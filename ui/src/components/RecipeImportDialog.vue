<script setup lang="ts">
/**
 * Import one recipe (classic ImportManager): drop / pick / paste an image, or
 * enter an image URL, a Civitai image URL or an image path on the server ->
 * analyze -> review the detected checkpoint and LoRAs (library status, missing
 * ones can go straight to the download dialog) -> name and tags -> save.
 * Flow and state: composables/useRecipeImport.ts.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import GenerationDetails from './GenerationDetails.vue'
import LazyMedia from './LazyMedia.vue'
import ModalShell from './ModalShell.vue'
import { useRecipeImport } from '@/composables/useRecipeImport'
import { withMountPrefix } from '@/utils/basePath'
import { toGenerationView } from '@/utils/generation'
import { parseTagInput } from '@/utils/recipes'
import { t, type MessageKey } from '@/i18n'

const emit = defineEmits<{
  close: []
  /** A recipe was saved (the page reloads and may open it). */
  saved: [id: string]
  open: [id: string]
  /** Open the B1 download dialog with this input (missing LoRAs). */
  download: [input: string]
}>()

const flow = useRecipeImport()
const { step, error, view, name, source } = flow
const urlInput = ref('')
const tagText = ref('')
const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const objectUrl = ref('')

const busy = computed(() => step.value === 'analyzing' || step.value === 'saving')
const previewSrc = computed(() => {
  if (objectUrl.value) return objectUrl.value
  const raw = flow.analysis.value
  if (raw?.image_base64) {
    const ext = (raw.extension || '.jpg').replace('.', '').toLowerCase()
    const mime = raw.is_video ? `video/${ext}` : `image/${ext === 'jpg' ? 'jpeg' : ext}`
    return `data:${mime};base64,${raw.image_base64}`
  }
  return ''
})
const generation = computed(() => toGenerationView(view.value?.genParams))
const title = computed(() => t(step.value === 'done' ? 'recipes.import.doneTitle' : 'recipes.import.title'))

const STATE: Record<'library' | 'missing' | 'deleted', { label: MessageKey; badge: string }> = {
  library: { label: 'recipes.state.library', badge: 'lm-badge lm-badge--success' },
  missing: { label: 'recipes.state.missing', badge: 'lm-badge lm-badge--warning' },
  deleted: { label: 'recipes.state.deleted', badge: 'lm-badge lm-badge--danger' },
}

function revoke(): void {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  objectUrl.value = ''
}

async function useFile(file: File | null | undefined): Promise<void> {
  if (!file) return
  revoke()
  if (typeof URL.createObjectURL === 'function') objectUrl.value = URL.createObjectURL(file)
  await flow.analyzeFile(file)
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  void useFile(event.dataTransfer?.files?.[0])
}

function onPickFile(event: Event): void {
  const target = event.target as HTMLInputElement
  void useFile(target.files?.[0])
  target.value = ''
}

/** Ctrl+V of an image anywhere in the dialog (input step). */
function onPaste(event: ClipboardEvent): void {
  if (step.value !== 'input') return
  const file = [...(event.clipboardData?.files ?? [])].find((entry) => entry.type.startsWith('image/'))
  if (file) {
    event.preventDefault()
    void useFile(file)
  }
}

async function analyzeUrl(): Promise<void> {
  revoke()
  await flow.analyzeInput(urlInput.value)
}

function back(): void {
  revoke()
  flow.reset()
}

async function save(): Promise<void> {
  flow.tags.value = parseTagInput(tagText.value)
  const id = await flow.save()
  if (id) emit('saved', id)
}

function another(): void {
  back()
  urlInput.value = ''
  tagText.value = ''
}

watch(step, async (value) => {
  if (value === 'review') {
    await nextTick()
    nameInput.value?.focus()
    nameInput.value?.select()
  }
})

useEventListener(document, 'paste', onPaste)
onBeforeUnmount(revoke)

const dropClass =
  'flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center text-muted transition-colors'
</script>

<template>
  <ModalShell :title="title" title-id="recipe-import-title" :busy="busy" wide @close="emit('close')">
    <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
      <!-- Step 1: source -->
      <template v-if="step === 'input' || step === 'analyzing'">
        <div
          :class="[dropClass, dragging ? 'border-accent bg-accent-soft text-fg' : 'border-border-strong bg-sunken']"
          role="group"
          :aria-label="t('recipes.import.dropLabel')"
          :aria-busy="step === 'analyzing'"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
          @click="!busy && fileInput?.click()"
        >
          <AppIcon :name="step === 'analyzing' ? 'refresh' : 'image'" :size="32" :class="{ 'animate-spinner': step === 'analyzing' }" />
          <p class="font-medium text-fg">{{ step === 'analyzing' ? t('recipes.import.analyzing') : t('recipes.import.drop') }}</p>
          <p class="text-sm">{{ t('recipes.import.dropHint') }}</p>
          <button type="button" class="lm-btn" :disabled="busy" @click.stop="fileInput?.click()">
            <AppIcon name="folder" :size="16" />{{ t('recipes.import.pick') }}
          </button>
          <input ref="fileInput" class="sr-only" type="file" accept="image/*,video/mp4,video/webm" tabindex="-1" aria-hidden="true" @change="onPickFile" />
        </div>

        <form class="flex flex-col gap-1" @submit.prevent="analyzeUrl">
          <label class="lm-label" for="recipe-import-url">{{ t('recipes.import.urlLabel') }}</label>
          <div class="flex gap-2 phone:flex-col">
            <input
              id="recipe-import-url"
              v-model="urlInput"
              class="lm-input min-w-0 flex-1"
              type="text"
              inputmode="url"
              autocomplete="off"
              spellcheck="false"
              :placeholder="t('recipes.import.urlPlaceholder')"
              :disabled="busy"
              aria-describedby="recipe-import-url-hint recipe-import-error"
            />
            <button type="submit" class="lm-btn lm-btn--primary" :disabled="busy || !urlInput.trim()">
              <AppIcon name="search" :size="16" />{{ t('recipes.import.analyze') }}
            </button>
          </div>
          <p id="recipe-import-url-hint" class="lm-hint">{{ t('recipes.import.urlHint') }}</p>
        </form>
        <p id="recipe-import-error" class="lm-error-text" role="alert">{{ error ?? '' }}</p>
      </template>

      <!-- Step 2: review -->
      <template v-else-if="(step === 'review' || step === 'saving') && view">
        <div class="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-4 phone:grid-cols-1">
          <div class="flex flex-col gap-2">
            <LazyMedia
              class="aspect-card w-full overflow-hidden rounded-md bg-sunken phone:max-h-[220px]"
              media-class="size-full object-contain"
              :src="previewSrc"
              :alt="name"
              :kind="flow.analysis.value?.is_video ? 'video' : 'image'"
              loading="eager"
              autoplay
              loop
            />
            <p class="truncate text-xs text-muted" :title="source?.kind === 'file' ? source.file.name : source?.kind === 'url' ? source.url : source?.path">
              {{ source?.kind === 'file' ? source.file.name : source?.kind === 'url' ? source.url : source?.path }}
            </p>
          </div>

          <form id="recipe-import-form" class="flex min-w-0 flex-col gap-3" novalidate @submit.prevent="save">
            <div class="flex flex-col gap-1">
              <label class="lm-label" for="recipe-import-name">{{ t('recipes.import.name') }}</label>
              <input
                id="recipe-import-name"
                ref="nameInput"
                v-model="name"
                class="lm-input"
                autocomplete="off"
                :disabled="busy"
                :aria-invalid="!name.trim()"
                required
              />
              <p v-if="!name.trim()" class="lm-error-text">{{ t('recipes.rename.errorEmpty') }}</p>
            </div>
            <div class="flex flex-col gap-1">
              <label class="lm-label" for="recipe-import-tags">{{ t('recipes.import.tags') }}</label>
              <input id="recipe-import-tags" v-model="tagText" class="lm-input" autocomplete="off" :disabled="busy" :placeholder="t('recipes.import.tagsPlaceholder')" />
              <p class="lm-hint">{{ t('recipes.import.tagsHint') }}</p>
            </div>
            <p v-if="view.baseModel" class="text-sm"><span class="text-muted">{{ t('recipes.import.baseModel') }}</span> <span class="lm-badge lm-badge--accent">{{ view.baseModel }}</span></p>
          </form>
        </div>

        <div v-if="view.matching.length" class="rounded-md hairline border-warning bg-warning-soft p-3 text-sm" role="status">
          <p class="flex items-center gap-2 font-bold"><AppIcon name="alert" :size="16" />{{ t('recipes.import.duplicates', { count: view.matching.length }) }}</p>
          <p class="mb-1 text-xs">{{ t('recipes.import.duplicatesHint') }}</p>
          <ul class="flex flex-wrap gap-1">
            <li v-for="match in view.matching" :key="match.id">
              <button type="button" class="lm-chip" @click="emit('open', match.id)">{{ match.title || match.id }}</button>
            </li>
          </ul>
        </div>

        <section aria-labelledby="recipe-import-resources" class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 id="recipe-import-resources" class="lm-overline">
              {{ t('recipes.import.resources', { count: view.loras.length }) }}
              <span v-if="view.missing" class="ml-1 normal-case text-warning">{{ t('recipes.import.missingCount', { count: view.missing }) }}</span>
            </h3>
            <button v-if="view.downloadInput" type="button" class="lm-btn lm-btn--sm" @click="emit('download', view.downloadInput)">
              <AppIcon name="download" :size="14" />{{ t('recipes.missing.download', { count: view.missing }) }}
            </button>
          </div>
          <ul class="flex max-h-[min(300px,40vh)] flex-col gap-1 overflow-y-auto">
            <li v-if="view.checkpoint" class="flex items-center gap-2 rounded-md hairline border-border p-2">
              <LazyMedia class="size-[40px] flex-none overflow-hidden rounded-sm bg-sunken" media-class="size-full object-cover" :src="view.checkpoint.thumbnailUrl ? withMountPrefix(view.checkpoint.thumbnailUrl) : ''" :icon-size="16" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-xs text-muted">{{ t('recipes.detail.checkpoint') }}</span>
                <span class="truncate text-sm font-medium">{{ view.checkpoint.name }}</span>
              </span>
              <span :class="STATE[view.checkpoint.state].badge">{{ t(STATE[view.checkpoint.state].label) }}</span>
            </li>
            <li
              v-for="(lora, index) in view.loras"
              :key="index"
              class="flex items-center gap-2 rounded-md hairline p-2"
              :class="lora.state === 'library' ? 'border-border' : lora.state === 'missing' ? 'border-warning bg-warning-soft' : 'border-danger bg-danger-soft'"
            >
              <LazyMedia class="size-[40px] flex-none overflow-hidden rounded-sm bg-sunken" media-class="size-full object-cover" :src="lora.thumbnailUrl ? withMountPrefix(lora.thumbnailUrl) : ''" :icon-size="16" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm font-medium" :title="lora.name">{{ lora.name }}</span>
                <span class="truncate text-xs text-muted">{{ [lora.version, lora.baseModel].filter(Boolean).join(' · ') }}</span>
              </span>
              <span v-if="lora.earlyAccess" class="lm-badge">{{ t('download.badge.earlyAccess') }}</span>
              <span class="flex-none font-mono text-sm tabular-nums">{{ lora.strength }}</span>
              <span :class="[STATE[lora.state].badge, 'flex-none']">{{ t(STATE[lora.state].label) }}</span>
            </li>
            <li v-if="!view.loras.length && !view.checkpoint" class="text-sm text-muted">{{ t('recipes.import.noResources') }}</li>
          </ul>
        </section>

        <details class="rounded-md hairline border-border p-3">
          <summary class="cursor-pointer text-sm font-medium">{{ t('generation.title') }}</summary>
          <div class="mt-3 flex flex-col gap-3">
            <GenerationDetails :view="generation" :show-resources="false">
              <template #empty><p class="text-sm text-muted">{{ t('recipes.detail.noGeneration') }}</p></template>
            </GenerationDetails>
          </div>
        </details>

        <p class="lm-hint">{{ t('recipes.import.saveHint') }}</p>
        <p class="lm-error-text" role="alert">{{ error ?? '' }}</p>
        <div class="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 hairline-t border-border bg-elevated px-5 py-3">
          <button type="button" class="lm-btn" :disabled="busy" @click="back">
            <AppIcon name="chevronLeft" :size="16" />{{ t('recipes.import.back') }}
          </button>
          <button type="submit" form="recipe-import-form" class="lm-btn lm-btn--primary" :disabled="!flow.canSave.value || busy">
            <AppIcon name="check" :size="16" />{{ step === 'saving' ? t('recipes.import.saving') : t('recipes.import.save') }}
          </button>
        </div>
      </template>

      <!-- Step 3: done -->
      <template v-else-if="step === 'done'">
        <div class="flex flex-col items-center gap-2 py-6 text-center" role="status">
          <span class="inline-grid size-[48px] place-items-center rounded-pill bg-success-soft text-success"><AppIcon name="check" :size="24" /></span>
          <p class="text-lg font-medium">{{ t('recipes.import.done', { name }) }}</p>
          <p v-if="view?.missing" class="text-sm text-muted">{{ t('recipes.import.doneMissing', { count: view.missing }) }}</p>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <button v-if="view?.downloadInput" type="button" class="lm-btn" @click="emit('download', view.downloadInput)">
            <AppIcon name="download" :size="16" />{{ t('recipes.missing.download', { count: view.missing }) }}
          </button>
          <button type="button" class="lm-btn" @click="another"><AppIcon name="plus" :size="16" />{{ t('recipes.import.another') }}</button>
          <button v-if="flow.savedId.value" type="button" class="lm-btn lm-btn--primary" @click="emit('open', flow.savedId.value!)">
            {{ t('recipes.import.openRecipe') }}
          </button>
          <button type="button" class="lm-btn" @click="emit('close')">{{ t('common.close') }}</button>
        </div>
      </template>
    </div>
  </ModalShell>
</template>
