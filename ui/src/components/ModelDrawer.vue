<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import StateBlock from './StateBlock.vue'
import { downloadsApi, type ModelApi } from '@/api/endpoints'
import type { ModelItem, ModelMetadata, ModelUpdateRecord } from '@/api/types'
import { copyText, useToasts } from '@/composables/useFeedback'
import { withMountPrefix } from '@/utils/basePath'
import { formatBytes, formatDate, isVideoUrl } from '@/utils/format'
import { sanitizeHtml } from '@/utils/sanitize'
import { t, type MessageKey } from '@/i18n'

const props = withDefaults(
  defineProps<{ item: ModelItem; api: ModelApi; classicUrl: string; civitaiHost?: string }>(),
  { civitaiHost: 'civitai.com' },
)
const emit = defineEmits<{ close: []; updated: [item: ModelItem] }>()

type Tab = 'overview' | 'examples' | 'versions' | 'description'
const TABS: { id: Tab; label: MessageKey }[] = [
  { id: 'overview', label: 'detail.tabs.overview' },
  { id: 'examples', label: 'detail.tabs.examples' },
  { id: 'versions', label: 'detail.tabs.versions' },
  { id: 'description', label: 'detail.tabs.description' },
]

// Repeated layout classes.
const sectionClass = 'flex flex-col gap-5'
const blockTitleClass = 'mb-2 text-sm'
const chipsClass = 'flex flex-wrap items-center gap-2'

const toasts = useToasts()
const tab = ref<Tab>('overview')
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
const images = computed(() => metadata.value?.images ?? [])
const description = computed(() =>
  sanitizeHtml(metadata.value?.model?.description || metadata.value?.description || ''),
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

function onKey(event: KeyboardEvent): void {
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
          <span v-if="entry.id === 'examples' && images.length" class="text-xs text-muted">{{ images.length }}</span>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 phone:px-4">
        <!-- Overview -->
        <section v-if="tab === 'overview'" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" :class="sectionClass">
          <div v-if="previewUrl" class="overflow-hidden rounded-md bg-sunken">
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
          <div class="flex flex-wrap gap-2">
            <a v-if="civitaiUrl" class="lm-btn" :href="civitaiUrl" target="_blank" rel="noopener noreferrer">
              <AppIcon name="external" :size="16" />{{ t('detail.civitai') }}
            </a>
            <a class="lm-btn lm-btn--ghost" :href="classicUrl">
              <AppIcon name="external" :size="16" />{{ t('common.openClassic') }}
            </a>
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

          <div>
            <h3 :class="blockTitleClass">{{ t('detail.tags') }}</h3>
            <div :class="chipsClass">
              <span v-for="tag in tags" :key="tag" class="lm-chip">
                {{ tag }}
                <button
                  type="button"
                  class="lm-icon-btn text-muted hover:text-danger"
                  :aria-label="t('detail.removeTag', { tag })"
                  :disabled="savingTags"
                  @click="removeTag(tag)"
                >
                  <AppIcon name="close" :size="12" />
                </button>
              </span>
              <form class="min-w-[120px] flex-1" @submit.prevent="addTag">
                <label class="sr-only" for="drawer-new-tag">{{ t('detail.addTag') }}</label>
                <input
                  id="drawer-new-tag"
                  v-model="newTag"
                  class="lm-input min-h-[28px]"
                  :placeholder="t('detail.addTag')"
                  :disabled="savingTags"
                />
              </form>
            </div>
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

          <!-- Each row: label column + value column. -->
          <dl
            class="grid gap-2 rounded-md bg-sunken p-4 *:grid *:grid-cols-[110px_minmax(0,1fr)] *:gap-3 [&_dd]:text-sm [&_dd]:wrap-anywhere [&_dt]:text-sm [&_dt]:text-muted"
          >
            <div><dt>{{ t('detail.fileName') }}</dt><dd class="lm-mono">{{ item.file_name }}</dd></div>
            <div><dt>{{ t('detail.folder') }}</dt><dd>{{ item.folder || '/' }}</dd></div>
            <div><dt>{{ t('detail.size') }}</dt><dd>{{ formatBytes(item.file_size) }}</dd></div>
            <div><dt>{{ t('detail.modified') }}</dt><dd>{{ formatDate(item.modified) }}</dd></div>
            <div v-if="item.civitai?.creator?.username"><dt>{{ t('detail.creator') }}</dt><dd>{{ item.civitai.creator.username }}</dd></div>
            <div><dt>{{ t('detail.usage') }}</dt><dd>{{ item.usage_count ?? 0 }}</dd></div>
            <div v-if="item.sha256">
              <dt>{{ t('detail.hash') }}</dt>
              <dd class="flex items-center gap-1">
                <span class="lm-mono">{{ item.sha256 }}</span>
                <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('common.copy')" @click="copy(item.sha256!)">
                  <AppIcon name="copy" :size="14" />
                </button>
              </dd>
            </div>
          </dl>
        </section>

        <!-- Examples -->
        <section v-else-if="tab === 'examples'" id="panel-examples" role="tabpanel" aria-labelledby="tab-examples" :class="sectionClass">
          <StateBlock v-if="metaLoading" kind="loading" />
          <StateBlock v-else-if="!images.length" kind="empty" :title="t('detail.noExamples')" />
          <div v-else class="gap-x-2 [columns:2_180px]">
            <a
              v-for="(image, index) in images"
              :key="index"
              class="mb-2 block break-inside-avoid overflow-hidden rounded-sm bg-sunken"
              :href="image.url"
              target="_blank"
              rel="noopener noreferrer"
              :style="image.width && image.height ? { aspectRatio: `${image.width} / ${image.height}` } : undefined"
            >
              <video
                v-if="image.type === 'video' || isVideoUrl(image.url)"
                class="size-full object-cover"
                :src="image.url"
                muted
                loop
                playsinline
                preload="metadata"
                @mouseenter="($event.target as HTMLVideoElement).play().catch(() => undefined)"
              ></video>
              <img v-else class="size-full object-cover" :src="image.url" alt="" loading="lazy" />
            </a>
          </div>
        </section>

        <!-- Versions -->
        <section v-else-if="tab === 'versions'" id="panel-versions" role="tabpanel" aria-labelledby="tab-versions" :class="sectionClass">
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

        <!-- Description -->
        <section v-else id="panel-description" role="tabpanel" aria-labelledby="tab-description" :class="sectionClass">
          <StateBlock v-if="metaLoading" kind="loading" />
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized with an allow-list -->
          <div v-else-if="description" class="lm-prose" v-html="description"></div>
          <StateBlock v-else kind="empty" :title="t('detail.noDescription')" />
        </section>
      </div>
    </aside>
  </div>
</template>
