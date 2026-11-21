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
  <div class="drawer-backdrop" @click.self="emit('close')">
    <aside ref="panel" class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <header class="drawer__header">
        <div class="drawer__heading">
          <p class="drawer__eyebrow">{{ t('detail.title') }}</p>
          <h2 id="drawer-title" class="drawer__title">{{ displayName }}</h2>
          <div class="drawer__badges">
            <span v-if="item.base_model" class="lm-badge lm-badge--accent">{{ item.base_model }}</span>
            <span v-if="item.update_available" class="lm-badge lm-badge--warning">{{ t('card.update') }}</span>
            <span v-if="item.civitai?.name" class="lm-badge">{{ item.civitai.name }}</span>
          </div>
        </div>
        <button
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--icon"
          :class="{ 'drawer__fav--on': item.favorite }"
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

      <div class="drawer__tabs" role="tablist">
        <button
          v-for="entry in TABS"
          :id="`tab-${entry.id}`"
          :key="entry.id"
          type="button"
          role="tab"
          class="drawer__tab"
          :class="{ 'is-active': tab === entry.id }"
          :aria-selected="tab === entry.id"
          :aria-controls="`panel-${entry.id}`"
          @click="tab = entry.id"
        >
          {{ t(entry.label) }}
          <span v-if="entry.id === 'examples' && images.length" class="drawer__tab-count">{{ images.length }}</span>
        </button>
      </div>

      <div class="drawer__body">
        <!-- Overview -->
        <section v-if="tab === 'overview'" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" class="drawer__section">
          <div v-if="previewUrl" class="drawer__preview">
            <video v-if="isVideoUrl(item.preview_url)" :src="previewUrl" muted loop autoplay playsinline></video>
            <img v-else :src="previewUrl" alt="" />
          </div>

          <div class="drawer__links">
            <a v-if="civitaiUrl" class="lm-btn" :href="civitaiUrl" target="_blank" rel="noopener noreferrer">
              <AppIcon name="external" :size="16" />{{ t('detail.civitai') }}
            </a>
            <a class="lm-btn lm-btn--ghost" :href="classicUrl">
              <AppIcon name="external" :size="16" />{{ t('common.openClassic') }}
            </a>
          </div>

          <div class="drawer__block">
            <div class="drawer__block-head">
              <h3>{{ t('detail.triggerWords') }}</h3>
              <button v-if="triggerWords.length > 1" type="button" class="lm-btn lm-btn--sm" @click="copy(triggerWords.join(', '))">
                <AppIcon name="copy" :size="14" />{{ t('detail.copyAll') }}
              </button>
            </div>
            <div v-if="metaLoading" class="lm-skeleton drawer__skeleton"></div>
            <div v-else-if="triggerWords.length" class="drawer__chips">
              <button
                v-for="word in triggerWords"
                :key="word"
                type="button"
                class="lm-chip drawer__word"
                :title="t('common.copy')"
                @click="copy(word)"
              >
                {{ word }}<AppIcon name="copy" :size="12" />
              </button>
            </div>
            <p v-else class="lm-muted">{{ t('detail.noTriggerWords') }}</p>
            <p v-if="metaError" class="lm-error-text">{{ metaError }}</p>
          </div>

          <div class="drawer__block">
            <h3>{{ t('detail.tags') }}</h3>
            <div class="drawer__chips">
              <span v-for="tag in tags" :key="tag" class="lm-chip">
                {{ tag }}
                <button type="button" class="drawer__chip-x" :aria-label="t('detail.removeTag', { tag })" :disabled="savingTags" @click="removeTag(tag)">
                  <AppIcon name="close" :size="12" />
                </button>
              </span>
              <form class="drawer__tag-form" @submit.prevent="addTag">
                <label class="visually-hidden" for="drawer-new-tag">{{ t('detail.addTag') }}</label>
                <input id="drawer-new-tag" v-model="newTag" class="lm-input drawer__tag-input" :placeholder="t('detail.addTag')" :disabled="savingTags" />
              </form>
            </div>
          </div>

          <div class="drawer__block">
            <label class="lm-label" for="drawer-notes"><h3>{{ t('detail.notes') }}</h3></label>
            <textarea id="drawer-notes" v-model="notes" class="lm-textarea" :placeholder="t('detail.notesPlaceholder')"></textarea>
            <div class="drawer__actions">
              <button type="button" class="lm-btn lm-btn--primary" :disabled="!notesDirty || savingNotes" @click="saveNotes">
                {{ t('common.save') }}
              </button>
            </div>
          </div>

          <dl class="drawer__meta">
            <div><dt>{{ t('detail.fileName') }}</dt><dd class="lm-mono">{{ item.file_name }}</dd></div>
            <div><dt>{{ t('detail.folder') }}</dt><dd>{{ item.folder || '/' }}</dd></div>
            <div><dt>{{ t('detail.size') }}</dt><dd>{{ formatBytes(item.file_size) }}</dd></div>
            <div><dt>{{ t('detail.modified') }}</dt><dd>{{ formatDate(item.modified) }}</dd></div>
            <div v-if="item.civitai?.creator?.username"><dt>{{ t('detail.creator') }}</dt><dd>{{ item.civitai.creator.username }}</dd></div>
            <div><dt>{{ t('detail.usage') }}</dt><dd>{{ item.usage_count ?? 0 }}</dd></div>
            <div v-if="item.sha256">
              <dt>{{ t('detail.hash') }}</dt>
              <dd class="drawer__hash">
                <span class="lm-mono">{{ item.sha256 }}</span>
                <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('common.copy')" @click="copy(item.sha256!)">
                  <AppIcon name="copy" :size="14" />
                </button>
              </dd>
            </div>
          </dl>
        </section>

        <!-- Examples -->
        <section v-else-if="tab === 'examples'" id="panel-examples" role="tabpanel" aria-labelledby="tab-examples" class="drawer__section">
          <StateBlock v-if="metaLoading" kind="loading" />
          <StateBlock v-else-if="!images.length" kind="empty" :title="t('detail.noExamples')" />
          <div v-else class="drawer__gallery">
            <a
              v-for="(image, index) in images"
              :key="index"
              class="drawer__shot"
              :href="image.url"
              target="_blank"
              rel="noopener noreferrer"
              :style="image.width && image.height ? { aspectRatio: `${image.width} / ${image.height}` } : undefined"
            >
              <video v-if="image.type === 'video' || isVideoUrl(image.url)" :src="image.url" muted loop playsinline preload="metadata" @mouseenter="($event.target as HTMLVideoElement).play().catch(() => undefined)"></video>
              <img v-else :src="image.url" alt="" loading="lazy" />
            </a>
          </div>
        </section>

        <!-- Versions -->
        <section v-else-if="tab === 'versions'" id="panel-versions" role="tabpanel" aria-labelledby="tab-versions" class="drawer__section">
          <StateBlock v-if="versionsLoading" kind="loading" />
          <StateBlock v-else-if="versionsError" kind="error" :message="versionsError" @retry="loadVersions" />
          <StateBlock v-else-if="!versions?.versions?.length" kind="empty" :title="t('detail.noVersions')" />
          <ul v-else class="drawer__versions">
            <li v-for="version in versions.versions" :key="version.versionId" class="drawer__version">
              <img v-if="version.previewUrl && !isVideoUrl(version.previewUrl)" class="drawer__version-thumb" :src="withMountPrefix(version.previewUrl)" alt="" loading="lazy" />
              <div v-else class="drawer__version-thumb"></div>
              <div class="drawer__version-main">
                <strong>{{ version.name }}</strong>
                <div class="drawer__version-meta">
                  <span v-if="version.baseModel">{{ version.baseModel }}</span>
                  <span v-if="version.releasedAt">{{ formatDate(version.releasedAt) }}</span>
                  <span v-if="version.sizeBytes">{{ formatBytes(version.sizeBytes) }}</span>
                </div>
                <div class="drawer__badges">
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
        <section v-else id="panel-description" role="tabpanel" aria-labelledby="tab-description" class="drawer__section">
          <StateBlock v-if="metaLoading" kind="loading" />
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized with an allow-list -->
          <div v-else-if="description" class="drawer__description" v-html="description"></div>
          <StateBlock v-else kind="empty" :title="t('detail.noDescription')" />
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  justify-content: flex-end;
  background: var(--lm-color-overlay);
  animation: drawer-fade var(--lm-motion-normal) var(--lm-ease);
}

.drawer {
  display: flex;
  flex-direction: column;
  width: min(var(--lm-drawer-width), 100vw);
  height: 100%;
  background: var(--lm-color-elevated);
  border-left: var(--lm-border-width) solid var(--lm-color-border);
  box-shadow: var(--lm-shadow-lg);
  animation: drawer-in var(--lm-motion-normal) var(--lm-ease);
}

@keyframes drawer-in {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
}

@keyframes drawer-fade {
  from {
    opacity: 0;
  }
}

.drawer__header {
  display: flex;
  align-items: flex-start;
  gap: var(--lm-space-2);
  padding: var(--lm-space-5) var(--lm-space-5) var(--lm-space-3);
}

.drawer__heading {
  flex: 1;
  min-width: 0;
}

.drawer__eyebrow {
  margin: 0;
  color: var(--lm-color-muted);
  font-size: var(--lm-font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.drawer__title {
  margin: var(--lm-space-1) 0 var(--lm-space-2);
  font-size: var(--lm-font-size-xl);
  overflow-wrap: anywhere;
}

.drawer__badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lm-space-1);
}

.drawer__fav--on {
  color: var(--lm-color-warning);
}

.drawer__tabs {
  display: flex;
  gap: var(--lm-space-1);
  padding: 0 var(--lm-space-5);
  border-bottom: var(--lm-border-width) solid var(--lm-color-border);
  overflow-x: auto;
}

.drawer__tab {
  display: inline-flex;
  align-items: center;
  gap: var(--lm-space-1);
  padding: var(--lm-space-2) var(--lm-space-3);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--lm-color-muted);
  font-weight: var(--lm-font-weight-medium);
  cursor: pointer;
  white-space: nowrap;
}

.drawer__tab.is-active {
  border-bottom-color: var(--lm-color-accent);
  color: var(--lm-color-text);
}

.drawer__tab-count {
  font-size: var(--lm-font-size-xs);
  color: var(--lm-color-muted);
}

.drawer__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--lm-space-5);
}

.drawer__section {
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-5);
}

.drawer__preview {
  overflow: hidden;
  border-radius: var(--lm-radius-md);
  background: var(--lm-color-sunken);
}

.drawer__preview img,
.drawer__preview video {
  width: 100%;
  max-height: 420px;
  object-fit: contain;
}

.drawer__links,
.drawer__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lm-space-2);
}

.drawer__actions {
  justify-content: flex-end;
  margin-top: var(--lm-space-2);
}

.drawer__block h3 {
  font-size: var(--lm-font-size-sm);
  margin-bottom: var(--lm-space-2);
}

.drawer__block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.drawer__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lm-space-2);
}

.drawer__word {
  font-family: var(--lm-font-mono);
  white-space: normal;
  text-align: left;
}

.drawer__chip-x {
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--lm-color-muted);
  cursor: pointer;
}

.drawer__chip-x:hover {
  color: var(--lm-color-danger);
}

.drawer__tag-form {
  flex: 1;
  min-width: 120px;
}

.drawer__tag-input {
  min-height: 28px;
}

.drawer__skeleton {
  height: 28px;
  border-radius: var(--lm-radius-sm);
}

.drawer__meta {
  display: grid;
  gap: var(--lm-space-2);
  margin: 0;
  padding: var(--lm-space-4);
  border-radius: var(--lm-radius-md);
  background: var(--lm-color-sunken);
}

.drawer__meta > div {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: var(--lm-space-3);
}

.drawer__meta dt {
  color: var(--lm-color-muted);
  font-size: var(--lm-font-size-sm);
}

.drawer__meta dd {
  margin: 0;
  font-size: var(--lm-font-size-sm);
  overflow-wrap: anywhere;
}

.drawer__hash {
  display: flex;
  align-items: center;
  gap: var(--lm-space-1);
}

.drawer__gallery {
  columns: 2 180px;
  column-gap: var(--lm-space-2);
}

.drawer__shot {
  display: block;
  margin-bottom: var(--lm-space-2);
  overflow: hidden;
  border-radius: var(--lm-radius-sm);
  background: var(--lm-color-sunken);
  break-inside: avoid;
}

.drawer__shot img,
.drawer__shot video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.drawer__versions {
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.drawer__version {
  display: flex;
  align-items: center;
  gap: var(--lm-space-3);
  padding: var(--lm-space-2);
  border: var(--lm-border-width) solid var(--lm-color-border);
  border-radius: var(--lm-radius-md);
}

.drawer__version-thumb {
  flex: none;
  width: 56px;
  height: 72px;
  border-radius: var(--lm-radius-sm);
  background: var(--lm-color-sunken);
  object-fit: cover;
}

.drawer__version-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.drawer__version-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lm-space-2);
  color: var(--lm-color-muted);
  font-size: var(--lm-font-size-xs);
}

.drawer__description {
  overflow-wrap: anywhere;
}

.drawer__description :deep(img) {
  max-width: 100%;
}

@media (max-width: 720px) {
  .drawer__header,
  .drawer__body {
    padding-left: var(--lm-space-4);
    padding-right: var(--lm-space-4);
  }

  .drawer__tabs {
    padding: 0 var(--lm-space-3);
  }
}
</style>
