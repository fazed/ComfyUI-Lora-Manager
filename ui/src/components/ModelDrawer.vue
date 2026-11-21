<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import ExampleLightbox from './ExampleLightbox.vue'
import StateBlock from './StateBlock.vue'
import { downloadsApi, type ModelApi } from '@/api/endpoints'
import type { ModelItem, ModelMetadata, ModelUpdateRecord } from '@/api/types'
import { copyText, useToasts } from '@/composables/useFeedback'
import { usePersistentToggle } from '@/composables/usePersistentToggle'
import { useSendToWorkflow } from '@/composables/useSendToWorkflow'
import { withMountPrefix } from '@/utils/basePath'
import { formatBytes, formatDate, isVideoUrl } from '@/utils/format'
import { promptHint } from '@/utils/generation'
import { sanitizeHtml } from '@/utils/sanitize'
import { collapseTags } from '@/utils/tags'
import { loraStrengths, type SendMode } from '@/utils/workflow'
import { t, type MessageKey } from '@/i18n'

const props = withDefaults(
  defineProps<{ item: ModelItem; api: ModelApi; classicUrl: string; civitaiHost?: string; canSend?: boolean }>(),
  { civitaiHost: 'civitai.com', canSend: false },
)
const emit = defineEmits<{ close: []; updated: [item: ModelItem]; 'filter-tag': [tag: string] }>()

type Tab = 'overview' | 'description' | 'versions'
const TABS: { id: Tab; label: MessageKey }[] = [
  { id: 'overview', label: 'detail.tabs.overview' },
  { id: 'description', label: 'detail.tabs.description' },
  { id: 'versions', label: 'detail.tabs.versions' },
]

// Repeated layout classes.
const sectionClass = 'flex flex-col gap-5'
const blockTitleClass = 'mb-2 text-sm'
const chipsClass = 'flex flex-wrap items-center gap-2'

const toasts = useToasts()
const workflow = useSendToWorkflow()
const tab = ref<Tab>('overview')
const specsOpen = usePersistentToggle('lm-ui.detail.specsOpen', false)
const tagsExpanded = ref(false)
const lightboxIndex = ref<number | null>(null)
let lightboxOpener: HTMLElement | null = null
const strength = ref(loraStrengths(props.item.usage_tips).strength)
const sending = ref(false)
const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)

const metadata = ref<ModelMetadata | null>(null)
const metaLoading = ref(false)
const metaError = ref<string | null>(null)

const versions = ref<ModelUpdateRecord | null>(null)
const versionsLoading = ref(false)
const versionsError = ref<string | null>(null)
const versionsLoaded = ref(false)

const notes = ref(props.item.notes ?? '')
const savingNotes = ref(false)
const tags = ref<string[]>([...(props.item.tags ?? [])])
const newTag = ref('')
const savingTags = ref(false)

const displayName = computed(() => props.item.model_name || props.item.file_name)
const previewUrl = computed(() => (props.item.preview_url ? withMountPrefix(props.item.preview_url) : ''))
const modelId = computed(() => props.item.civitai?.modelId ?? metadata.value?.modelId ?? null)
const civitaiUrl = computed(() => {
  if (!modelId.value) return ''
  const version = props.item.civitai?.id ?? metadata.value?.id
  const host = /^[a-z0-9.-]+$/i.test(props.civitaiHost) ? props.civitaiHost : 'civitai.com'
  return `https://${host}/models/${modelId.value}${version ? `?modelVersionId=${version}` : ''}`
})
const triggerWords = computed(() => {
  const words = metadata.value?.trainedWords ?? props.item.civitai?.trainedWords ?? []
  return words.map((word) => word.trim()).filter(Boolean)
})
const images = computed(() => (metadata.value?.images ?? []).filter((image) => !!image?.url))
const imageHints = computed(() => images.value.map((image) => promptHint(image.meta)))
const shownTags = computed(() => collapseTags(tags.value, tagsExpanded.value))
const fileType = computed(() => {
  const match = props.item.file_path?.match(/\.([a-z0-9]+)$/i)
  return match ? match[1].toLowerCase() : ''
})
const description = computed(() =>
  sanitizeHtml(metadata.value?.model?.description || metadata.value?.description || ''),
)
const specsSummary = computed(() =>
  [fileType.value.toUpperCase(), props.item.file_size ? formatBytes(props.item.file_size) : ''].filter(Boolean).join(' · '),
)
const notesDirty = computed(() => notes.value !== (props.item.notes ?? ''))

async function loadMetadata(): Promise<void> {
  metaLoading.value = true
  metaError.value = null
  try {
    metadata.value = await props.api.metadata(props.item.file_path)
  } catch (error) {
    // Models without Civitai metadata answer success:false; that's not an error for the user.
    metadata.value = null
    if (props.item.from_civitai) metaError.value = (error as Error).message
  } finally {
    metaLoading.value = false
  }
}

async function loadVersions(): Promise<void> {
  if (!modelId.value) {
    versionsLoaded.value = true
    return
  }
  versionsLoading.value = true
  versionsError.value = null
  try {
    versions.value = await props.api.versions(modelId.value)
  } catch (error) {
    versionsError.value = (error as Error).message
  } finally {
    versionsLoading.value = false
    versionsLoaded.value = true
  }
}

watch(tab, (value) => {
  if (value === 'versions' && !versionsLoaded.value) void loadVersions()
})

watch(
  () => props.item.file_path,
  () => {
    notes.value = props.item.notes ?? ''
    tags.value = [...(props.item.tags ?? [])]
    metadata.value = null
    versions.value = null
    versionsLoaded.value = false
    tab.value = 'overview'
    tagsExpanded.value = false
    lightboxIndex.value = null
    strength.value = loraStrengths(props.item.usage_tips).strength
    void loadMetadata()
  },
)

async function copy(text: string): Promise<void> {
  if (await copyText(text)) toasts.success(t('common.copied'))
  else toasts.error(t('common.copyFailed'))
}

async function save(updates: Partial<ModelItem>): Promise<boolean> {
  try {
    await props.api.saveMetadata(props.item.file_path, updates)
    emit('updated', { ...props.item, ...updates })
    return true
  } catch (error) {
    toasts.error((error as Error).message)
    return false
  }
}

async function saveNotes(): Promise<void> {
  savingNotes.value = true
  if (await save({ notes: notes.value })) toasts.success(t('common.saved'))
  savingNotes.value = false
}

async function saveTags(next: string[]): Promise<void> {
  const previous = tags.value
  tags.value = next
  savingTags.value = true
  if (!(await save({ tags: next }))) tags.value = previous
  savingTags.value = false
}

function addTag(): void {
  const value = newTag.value.trim().toLowerCase()
  newTag.value = ''
  if (!value || tags.value.includes(value)) return
  void saveTags([...tags.value, value])
}

function removeTag(tag: string): void {
  void saveTags(tags.value.filter((existing) => existing !== tag))
}

async function toggleFavorite(): Promise<void> {
  const next = !props.item.favorite
  if (await save({ favorite: next })) toasts.success(t(next ? 'detail.favoriteOn' : 'detail.favoriteOff'))
}

async function queueVersion(versionId: number): Promise<void> {
  try {
    const result = await downloadsApi.add({ modelId: modelId.value, versionId })
    toasts.success(result.duplicate ? t('detail.alreadyQueued') : t('detail.queued'))
  } catch (error) {
    toasts.error((error as Error).message)
  }
}

function openLightbox(index: number, event: Event): void {
  lightboxOpener = event.currentTarget as HTMLElement | null
  lightboxIndex.value = index
}

async function closeLightbox(): Promise<void> {
  lightboxIndex.value = null
  await nextTick()
  lightboxOpener?.focus()
  lightboxOpener = null
}

function sendOptions(mode: SendMode) {
  const value = Number(strength.value)
  return { mode, strength: Number.isFinite(value) ? value : null, trainedWords: triggerWords.value }
}

async function sendToComfy(mode: SendMode): Promise<void> {
  sending.value = true
  try {
    await workflow.sendLora(props.item, sendOptions(mode))
  } finally {
    sending.value = false
  }
}

function copySyntax(): void {
  void workflow.copyLora(props.item, sendOptions('append'))
}

function onKey(event: KeyboardEvent): void {
  // Modal dialogs on top (lightbox, node picker) handle their own keys.
  if (lightboxIndex.value !== null || document.querySelector('dialog[open]')) return
  if (event.key === 'Escape') emit('close')
  if (event.key === 'Tab' && panel.value) {
    // Keep focus inside the drawer while it is open.
    const focusable = panel.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}

let previousFocus: HTMLElement | null = null
onMounted(async () => {
  previousFocus = document.activeElement as HTMLElement | null
  document.addEventListener('keydown', onKey)
  void loadMetadata()
  await nextTick()
  closeButton.value?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  previousFocus?.focus?.()
})
</script>

<template>
  <div class="fixed inset-0 z-60 flex animate-fade-in justify-end bg-overlay" @click.self="emit('close')">
    <aside
      ref="panel"
      class="flex h-full w-[min(var(--lm-drawer-width),100vw)] animate-slide-in flex-col hairline-l border-border bg-elevated shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <header class="flex items-start gap-2 px-5 pt-5 pb-3 phone:px-4">
        <div class="min-w-0 flex-1">
          <p class="lm-overline tracking-[0.06em]">{{ t('detail.title') }}</p>
          <h2 id="drawer-title" class="mt-1 mb-2 text-xl wrap-anywhere">{{ displayName }}</h2>
          <div class="flex flex-wrap gap-1">
            <span v-if="item.base_model" class="lm-badge lm-badge--accent">{{ item.base_model }}</span>
            <span v-if="item.update_available" class="lm-badge lm-badge--warning">{{ t('card.update') }}</span>
            <span v-if="item.civitai?.name" class="lm-badge">{{ item.civitai.name }}</span>
          </div>
        </div>
        <button
          v-if="canSend"
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--icon"
          :aria-label="t('card.sendToComfy')"
          :title="t('card.sendToComfy')"
          :disabled="sending"
          @click="sendToComfy('append')"
        >
          <AppIcon name="send" />
        </button>
        <button
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--icon"
          :class="{ 'text-warning': item.favorite }"
          :aria-label="t('detail.toggleFavorite')"
          :aria-pressed="!!item.favorite"
          @click="toggleFavorite"
        >
          <AppIcon name="star" :filled="!!item.favorite" />
        </button>
        <button ref="closeButton" type="button" class="lm-btn lm-btn--ghost lm-btn--icon" :aria-label="t('common.close')" @click="emit('close')">
          <AppIcon name="close" />
        </button>
      </header>

      <div class="flex gap-1 overflow-x-auto hairline-b border-border px-5 phone:px-3" role="tablist">
        <button
          v-for="entry in TABS"
          :id="`tab-${entry.id}`"
          :key="entry.id"
          type="button"
          role="tab"
          class="inline-flex cursor-pointer items-center gap-1 border-b-2 px-3 py-2 font-medium whitespace-nowrap"
          :class="tab === entry.id ? 'border-accent text-fg' : 'border-transparent text-muted'"
          :aria-selected="tab === entry.id"
          :aria-controls="`panel-${entry.id}`"
          @click="tab = entry.id"
        >
          {{ t(entry.label) }}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 phone:px-4">
        <!-- Overview -->
        <section v-if="tab === 'overview'" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" :class="sectionClass">
          <!-- Cover + examples: side by side on a wide drawer, stacked (examples as a strip) when narrow. -->
          <div class="@container">
            <div
              class="grid gap-3"
              :class="previewUrl && (metaLoading || images.length) ? '@min-[460px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''"
            >
              <div v-if="previewUrl" class="flex items-center justify-center overflow-hidden rounded-md bg-sunken">
                <video
                  v-if="isVideoUrl(item.preview_url)"
                  class="max-h-[420px] w-full object-contain"
                  :src="previewUrl"
                  muted
                  loop
                  autoplay
                  playsinline
                ></video>
                <img v-else class="max-h-[420px] w-full object-contain" :src="previewUrl" alt="" />
              </div>

              <div v-if="metaLoading || images.length" class="flex min-w-0 flex-col gap-2" role="group" aria-labelledby="drawer-examples-title">
                <h3 id="drawer-examples-title" class="lm-overline flex items-center gap-2">
                  {{ t('detail.examples') }}
                  <span v-if="images.length" class="tabular-nums">{{ images.length }}</span>
                </h3>
                <div
                  class="flex gap-2 overflow-x-auto pb-1 @min-[460px]:grid @min-[460px]:max-h-[392px] @min-[460px]:content-start @min-[460px]:overflow-x-visible @min-[460px]:overflow-y-auto @min-[460px]:pb-0"
                  :class="
                    !previewUrl
                      ? '@min-[460px]:grid-cols-4'
                      : images.length <= 4
                        ? '@min-[460px]:grid-cols-2'
                        : '@min-[460px]:grid-cols-3'
                  "
                >
                  <template v-if="metaLoading">
                    <div v-for="n in 6" :key="n" class="lm-skeleton size-[88px] flex-none rounded-sm @min-[460px]:aspect-square @min-[460px]:size-auto"></div>
                  </template>
                  <template v-else>
                    <button
                      v-for="(image, index) in images"
                      :key="`${index}-${image.url}`"
                      type="button"
                      class="group/thumb relative size-[88px] flex-none cursor-pointer overflow-hidden rounded-sm bg-sunken @min-[460px]:aspect-square @min-[460px]:size-auto"
                      :aria-label="t('detail.openExample', { index: index + 1, count: images.length })"
                      :title="imageHints[index] || undefined"
                      @click="openLightbox(index, $event)"
                    >
                      <video
                        v-if="image.type === 'video' || isVideoUrl(image.url)"
                        class="size-full object-cover"
                        :src="image.url"
                        muted
                        playsinline
                        preload="metadata"
                      ></video>
                      <img
                        v-else
                        class="size-full object-cover transition-transform group-hover/thumb:scale-105"
                        :src="image.url"
                        alt=""
                        loading="lazy"
                      />
                      <span
                        v-if="image.type === 'video' || isVideoUrl(image.url)"
                        class="absolute inset-0 grid place-items-center text-on-scrim"
                        aria-hidden="true"
                      >
                        <span class="inline-grid size-[28px] place-items-center rounded-pill bg-scrim"><AppIcon name="play" :size="14" /></span>
                      </span>
                      <span
                        v-if="imageHints[index]"
                        class="absolute bottom-1 left-1 inline-grid size-[20px] place-items-center rounded-pill bg-scrim text-on-scrim"
                        aria-hidden="true"
                      >
                        <AppIcon name="text" :size="12" />
                      </span>
                    </button>
                  </template>
                </div>
              </div>
            </div>
            <p v-if="!metaLoading && !images.length && item.from_civitai" class="mt-2 text-xs text-muted">{{ t('detail.noExamples') }}</p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <a v-if="civitaiUrl" class="lm-btn" :href="civitaiUrl" target="_blank" rel="noopener noreferrer">
              <AppIcon name="external" :size="16" />{{ t('detail.civitai') }}
            </a>
            <a class="lm-btn lm-btn--ghost" :href="classicUrl">
              <AppIcon name="external" :size="16" />{{ t('common.openClassic') }}
            </a>
          </div>

          <!-- Send to ComfyUI (LoRAs) -->
          <div v-if="canSend" class="flex flex-wrap items-end gap-2 rounded-md bg-sunken p-3">
            <label class="flex flex-col gap-1 text-xs text-muted" for="drawer-strength">
              {{ t('detail.strength') }}
              <input
                id="drawer-strength"
                v-model.number="strength"
                class="lm-input w-[84px] tabular-nums"
                type="number"
                step="0.05"
                min="-10"
                max="10"
              />
            </label>
            <button type="button" class="lm-btn lm-btn--primary" :disabled="sending" @click="sendToComfy('append')">
              <AppIcon name="send" :size="16" />{{ t('detail.sendAppend') }}
            </button>
            <button type="button" class="lm-btn" :disabled="sending" @click="sendToComfy('replace')">
              {{ t('detail.sendReplace') }}
            </button>
            <button type="button" class="lm-btn lm-btn--ghost" @click="copySyntax">
              <AppIcon name="copy" :size="16" />{{ t('detail.copySyntax') }}
            </button>
          </div>

          <div>
            <div class="flex items-center justify-between">
              <h3 :class="blockTitleClass">{{ t('detail.triggerWords') }}</h3>
              <button v-if="triggerWords.length > 1" type="button" class="lm-btn lm-btn--sm" @click="copy(triggerWords.join(', '))">
                <AppIcon name="copy" :size="14" />{{ t('detail.copyAll') }}
              </button>
            </div>
            <div v-if="metaLoading" class="lm-skeleton h-[28px] rounded-sm"></div>
            <div v-else-if="triggerWords.length" :class="chipsClass">
              <button
                v-for="word in triggerWords"
                :key="word"
                type="button"
                class="lm-chip text-left font-mono whitespace-normal"
                :title="t('common.copy')"
                @click="copy(word)"
              >
                {{ word }}<AppIcon name="copy" :size="12" />
              </button>
            </div>
            <p v-else class="my-[1em] text-muted">{{ t('detail.noTriggerWords') }}</p>
            <p v-if="metaError" class="lm-error-text">{{ metaError }}</p>
          </div>

          <!-- Tags: uniform neutral pills; click filters the library, x removes. -->
          <div>
            <h3 :class="blockTitleClass">{{ t('detail.tags') }}</h3>
            <ul v-if="tags.length" class="flex flex-wrap items-center gap-1" :aria-label="t('detail.tags')">
              <li
                v-for="tag in shownTags.visible"
                :key="tag"
                class="inline-flex h-[26px] max-w-full items-center overflow-hidden rounded-pill hairline border-border bg-sunken text-xs text-fg"
              >
                <button
                  type="button"
                  class="h-full cursor-pointer truncate pr-1 pl-3 hover:text-accent"
                  :title="t('detail.filterByTag', { tag })"
                  @click="emit('filter-tag', tag)"
                >
                  {{ tag }}
                </button>
                <button
                  type="button"
                  class="inline-grid h-full w-[24px] flex-none cursor-pointer place-items-center text-muted hover:text-danger"
                  :aria-label="t('detail.removeTag', { tag })"
                  :disabled="savingTags"
                  @click="removeTag(tag)"
                >
                  <AppIcon name="close" :size="12" />
                </button>
              </li>
              <li v-if="shownTags.collapsible">
                <button
                  type="button"
                  class="inline-flex h-[26px] cursor-pointer items-center rounded-pill px-2 text-xs font-medium text-accent hover:bg-accent-soft"
                  :aria-expanded="tagsExpanded"
                  @click="tagsExpanded = !tagsExpanded"
                >
                  {{ tagsExpanded ? t('detail.lessTags') : t('detail.moreTags', { count: shownTags.hiddenCount }) }}
                </button>
              </li>
            </ul>
            <p v-else class="mb-2 text-sm text-muted">{{ t('detail.noTags') }}</p>
            <form class="mt-2 flex max-w-[260px] gap-1" @submit.prevent="addTag">
              <label class="sr-only" for="drawer-new-tag">{{ t('detail.addTag') }}</label>
              <input
                id="drawer-new-tag"
                v-model="newTag"
                class="lm-input min-h-control-sm text-xs"
                :placeholder="t('detail.addTag')"
                :disabled="savingTags"
              />
              <button
                type="submit"
                class="lm-btn lm-btn--sm lm-btn--icon flex-none"
                :aria-label="t('detail.addTag')"
                :disabled="savingTags || !newTag.trim()"
              >
                <AppIcon name="plus" :size="14" />
              </button>
            </form>
          </div>

          <div>
            <label class="lm-label" for="drawer-notes"><h3 :class="blockTitleClass">{{ t('detail.notes') }}</h3></label>
            <textarea id="drawer-notes" v-model="notes" class="lm-textarea" :placeholder="t('detail.notesPlaceholder')"></textarea>
            <div class="mt-2 flex flex-wrap justify-end gap-2">
              <button type="button" class="lm-btn lm-btn--primary" :disabled="!notesDirty || savingNotes" @click="saveNotes">
                {{ t('common.save') }}
              </button>
            </div>
          </div>

          <!-- Specifications: collapsed by default, state remembered. -->
          <div class="rounded-md bg-sunken">
            <h3>
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-2 rounded-md px-4 py-3 text-left text-sm font-bold"
                :aria-expanded="specsOpen"
                aria-controls="drawer-specs"
                @click="specsOpen = !specsOpen"
              >
                <AppIcon name="chevronRight" :size="16" class="transition-transform" :class="specsOpen && 'rotate-90'" />
                {{ t('detail.specifications') }}
                <span v-if="!specsOpen" class="ml-auto truncate text-xs font-regular text-muted">{{ specsSummary }}</span>
              </button>
            </h3>
            <!-- Each row: label column + value column. -->
            <dl
              v-show="specsOpen"
              id="drawer-specs"
              class="grid gap-2 px-4 pb-4 *:grid *:grid-cols-[110px_minmax(0,1fr)] *:gap-3 phone:*:grid-cols-[90px_minmax(0,1fr)] [&_dd]:text-sm [&_dd]:wrap-anywhere [&_dt]:text-sm [&_dt]:text-muted"
            >
              <div><dt>{{ t('detail.fileName') }}</dt><dd class="lm-mono">{{ item.file_name }}</dd></div>
              <div>
                <dt>{{ t('detail.filePath') }}</dt>
                <dd class="flex items-start gap-1">
                  <span class="lm-mono min-w-0 flex-1">{{ item.file_path }}</span>
                  <button
                    type="button"
                    class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm flex-none"
                    :aria-label="t('detail.copyPath')"
                    @click="copy(item.file_path)"
                  >
                    <AppIcon name="copy" :size="14" />
                  </button>
                </dd>
              </div>
              <div><dt>{{ t('detail.folder') }}</dt><dd>{{ item.folder || '/' }}</dd></div>
              <div v-if="item.base_model"><dt>{{ t('detail.baseModel') }}</dt><dd>{{ item.base_model }}</dd></div>
              <div v-if="item.sub_type"><dt>{{ t('detail.subType') }}</dt><dd>{{ item.sub_type }}</dd></div>
              <div v-if="fileType"><dt>{{ t('detail.fileType') }}</dt><dd>{{ fileType }}</dd></div>
              <div><dt>{{ t('detail.size') }}</dt><dd>{{ formatBytes(item.file_size) }}</dd></div>
              <div><dt>{{ t('detail.modified') }}</dt><dd>{{ formatDate(item.modified) }}</dd></div>
              <div v-if="item.civitai?.creator?.username"><dt>{{ t('detail.creator') }}</dt><dd>{{ item.civitai.creator.username }}</dd></div>
              <div><dt>{{ t('detail.usage') }}</dt><dd>{{ item.usage_count ?? 0 }}</dd></div>
              <div v-if="item.sha256">
                <dt>{{ t('detail.hash') }}</dt>
                <dd class="flex items-start gap-1">
                  <span class="lm-mono min-w-0 flex-1">{{ item.sha256 }}</span>
                  <button
                    type="button"
                    class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm flex-none"
                    :aria-label="t('detail.copyHash')"
                    @click="copy(item.sha256!)"
                  >
                    <AppIcon name="copy" :size="14" />
                  </button>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <!-- Description -->
        <section v-else-if="tab === 'description'" id="panel-description" role="tabpanel" aria-labelledby="tab-description" :class="sectionClass">
          <StateBlock v-if="metaLoading" kind="loading" />
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized with an allow-list -->
          <div v-else-if="description" class="lm-prose" v-html="description"></div>
          <StateBlock v-else kind="empty" :title="t('detail.noDescription')" />
        </section>

        <!-- Versions -->
        <section v-else id="panel-versions" role="tabpanel" aria-labelledby="tab-versions" :class="sectionClass">
          <StateBlock v-if="versionsLoading" kind="loading" />
          <StateBlock v-else-if="versionsError" kind="error" :message="versionsError" @retry="loadVersions" />
          <StateBlock v-else-if="!versions?.versions?.length" kind="empty" :title="t('detail.noVersions')" />
          <ul v-else class="flex flex-col gap-2">
            <li
              v-for="version in versions.versions"
              :key="version.versionId"
              class="flex items-center gap-3 rounded-md hairline border-border p-2"
            >
              <img
                v-if="version.previewUrl && !isVideoUrl(version.previewUrl)"
                class="lm-thumb h-[72px] w-[56px]"
                :src="withMountPrefix(version.previewUrl)"
                alt=""
                loading="lazy"
              />
              <div v-else class="lm-thumb h-[72px] w-[56px]"></div>
              <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
                <strong>{{ version.name }}</strong>
                <div class="flex flex-wrap gap-2 text-xs text-muted">
                  <span v-if="version.baseModel">{{ version.baseModel }}</span>
                  <span v-if="version.releasedAt">{{ formatDate(version.releasedAt) }}</span>
                  <span v-if="version.sizeBytes">{{ formatBytes(version.sizeBytes) }}</span>
                </div>
                <div class="flex flex-wrap gap-1">
                  <span v-if="version.isInLibrary" class="lm-badge lm-badge--success">{{ t('detail.inLibrary') }}</span>
                  <span v-else-if="version.hasBeenDownloaded" class="lm-badge">{{ t('detail.downloaded') }}</span>
                  <span v-if="version.isEarlyAccess" class="lm-badge lm-badge--warning">{{ t('detail.earlyAccess') }}</span>
                </div>
              </div>
              <button v-if="!version.isInLibrary" type="button" class="lm-btn lm-btn--sm" @click="queueVersion(version.versionId)">
                <AppIcon name="download" :size="14" />{{ t('detail.queueVersion') }}
              </button>
            </li>
          </ul>
        </section>
      </div>
    </aside>

    <ExampleLightbox
      v-if="lightboxIndex !== null && images.length"
      v-model:index="lightboxIndex"
      :images="images"
      @close="closeLightbox"
    />
  </div>
</template>
