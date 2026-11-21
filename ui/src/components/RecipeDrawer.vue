<script setup lang="ts">
/**
 * Recipe detail drawer (port of the classic RecipeModal): preview, use
 * actions (send LoRAs / workflow to ComfyUI, copy syntax), the checkpoint and
 * LoRAs with their library status (link to the model drawer, reconnect,
 * restore, download missing), generation data, tags and details. File
 * actions (rename, move, delete) are dialogs on the recipes page.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import GenerationDetails from './GenerationDetails.vue'
import LazyMedia from './LazyMedia.vue'
import RecipeReconnectForm from './RecipeReconnectForm.vue'
import { recipesApi } from '@/api/recipes'
import type { RecipeItem } from '@/api/types'
import { useDismissLayer } from '@/composables/useDismiss'
import { copyText, useToasts } from '@/composables/useFeedback'
import type { RecipeActions } from '@/composables/useRecipeActions'
import { withMountPrefix } from '@/utils/basePath'
import { formatDateTime } from '@/utils/format'
import { toGenerationView } from '@/utils/generation'
import { availability, loraState, missingLoraTargets, missingLorasInput, recipeLoraViews, type LoraState } from '@/utils/recipes'
import { collapseTags } from '@/utils/tags'
import { t, type MessageKey } from '@/i18n'

const props = defineProps<{ item: RecipeItem; actions: RecipeActions; blurMature?: boolean }>()
const emit = defineEmits<{
  close: []
  'filter-tag': [tag: string]
  rename: [recipe: RecipeItem]
  move: [recipe: RecipeItem]
  delete: [recipe: RecipeItem]
  /** Open the B1 download dialog with this input (missing LoRAs). */
  download: [input: string]
}>()

const toasts = useToasts()
const detail = ref<RecipeItem | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const reconnecting = ref<number | 'checkpoint' | null>(null)
const busy = ref<string | null>(null)
const tagsExpanded = ref(false)
const newTag = ref('')
const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)

/** List fields win: they carry the latest edits (favorite, title, reconnects); the detail adds the rest. */
const recipe = computed<RecipeItem>(() => ({ ...(detail.value ?? {}), ...props.item }))
const title = computed(() => recipe.value.title || recipe.value.id)
const previewUrl = computed(() => (recipe.value.file_url ? withMountPrefix(recipe.value.file_url) : ''))
const loras = computed(() => recipeLoraViews(recipe.value))
const status = computed(() => availability(recipe.value.loras ?? []))
const missing = computed(() => missingLoraTargets([recipe.value]))
const generation = computed(() => toGenerationView(recipe.value.gen_params))
const tags = computed(() => recipe.value.tags ?? [])
const shownTags = computed(() => collapseTags(tags.value, tagsExpanded.value))
const checkpoint = computed(() => {
  const entry = recipe.value.checkpoint
  if (!entry || typeof entry !== 'object') return null
  const name = entry.name || entry.modelName || entry.file_name
  if (!name) return null
  return {
    name,
    version: entry.version || entry.modelVersionName || '',
    state: loraState({ inLibrary: entry.inLibrary ?? entry.existsLocally, isDeleted: entry.isDeleted, hashInvalid: entry.hashInvalid }),
    previewUrl: entry.preview_url || entry.thumbnailUrl || '',
    localPath: entry.localPath ?? '',
    restorable: !!entry.reconnectSnapshot,
  }
})
const sourceUrl = computed(() => {
  const source = recipe.value.source_path ?? ''
  return /^https?:\/\//i.test(source) ? source : ''
})
const blurred = computed(() => !!props.blurMature && (recipe.value.preview_nsfw_level ?? 0) >= 4)

const STATE_LABEL: Record<LoraState, MessageKey> = {
  library: 'recipes.state.library',
  missing: 'recipes.state.missing',
  deleted: 'recipes.state.deleted',
  excluded: 'recipes.state.excluded',
}
const STATE_CLASS: Record<LoraState, string> = {
  library: 'lm-badge lm-badge--success',
  missing: 'lm-badge lm-badge--warning',
  deleted: 'lm-badge lm-badge--danger',
  excluded: 'lm-badge',
}
const rowClass = 'flex items-center gap-3 rounded-md hairline p-2'

async function loadDetail(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    detail.value = await recipesApi.detail(props.item.id)
  } catch (error) {
    loadError.value = (error as Error).message
  } finally {
    loading.value = false
  }
}

watch(
  () => props.item.id,
  () => {
    detail.value = null
    reconnecting.value = null
    tagsExpanded.value = false
    void loadDetail()
  },
)

async function copy(text: string): Promise<void> {
  if (await copyText(text)) toasts.success(t('common.copied'))
  else toasts.error(t('common.copyFailed'))
}

async function run(key: string, task: () => Promise<unknown>): Promise<void> {
  if (busy.value) return
  busy.value = key
  try {
    await task()
  } finally {
    busy.value = null
  }
}

function addTag(): void {
  const value = newTag.value.trim()
  newTag.value = ''
  if (!value || tags.value.some((tag) => tag.toLowerCase() === value.toLowerCase())) return
  void props.actions.setTags(recipe.value, [...tags.value, value])
}

function removeTag(tag: string): void {
  void props.actions.setTags(
    recipe.value,
    tags.value.filter((existing) => existing !== tag),
  )
}

function downloadMissing(): void {
  const { targets, withoutVersion } = missing.value
  if (withoutVersion) toasts.warning(t('recipes.missing.withoutVersion', { count: withoutVersion }))
  if (targets.length) emit('download', missingLorasInput(targets))
}

async function rematch(): Promise<void> {
  await run('rematch', async () => {
    if (await props.actions.rematch(recipe.value)) await loadDetail()
  })
}

function libraryLink(prefix: 'loras' | 'checkpoints', path: string) {
  return { path: `/${prefix}`, query: { open: path.replace(/\\/g, '/') } }
}

// Escape / backdrop close only while the drawer is the topmost overlay.
const { isTopmost, backdrop } = useDismissLayer({ active: () => true, close: () => emit('close') })

function onKey(event: KeyboardEvent): void {
  if (!isTopmost() || document.querySelector('dialog[open]')) return
  if (event.key === 'Tab' && panel.value) {
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
  void loadDetail()
  // "Recently opened" sort, like the classic modal (writes the open-stats file only).
  void recipesApi.markOpened(props.item.id).catch(() => undefined)
  await nextTick()
  closeButton.value?.focus()
})
onBeforeUnmount(() => previousFocus?.focus?.())
useEventListener(document, 'keydown', onKey)
</script>

<template>
  <div class="fixed inset-0 z-60 flex animate-fade-in justify-end bg-overlay" @pointerdown="backdrop.pointerdown" @click="backdrop.click">
    <aside
      ref="panel"
      class="flex h-full w-[min(var(--lm-drawer-width),100vw)] animate-slide-in flex-col hairline-l border-border bg-elevated shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recipe-drawer-title"
    >
      <header class="flex items-start gap-2 px-5 pt-5 pb-3 phone:px-4">
        <div class="min-w-0 flex-1">
          <p class="lm-overline tracking-[0.06em]">{{ t('recipes.detail.title') }}</p>
          <h2 id="recipe-drawer-title" class="mt-1 mb-2 text-xl wrap-anywhere">{{ title }}</h2>
          <div class="flex flex-wrap gap-1">
            <span v-if="recipe.base_model" class="lm-badge lm-badge--accent">{{ recipe.base_model }}</span>
            <span v-if="status.total" :class="status.missing ? 'lm-badge lm-badge--warning' : status.deleted ? 'lm-badge lm-badge--danger' : 'lm-badge lm-badge--success'">
              {{ status.missing ? t('recipes.card.missing', { missing: status.missing, total: status.total }) : status.deleted ? t('recipes.card.unavailable', { count: status.deleted, total: status.total }) : t('recipes.detail.allInLibrary') }}
            </span>
            <span v-if="recipe.folder" class="lm-badge"><AppIcon name="folder" :size="12" />{{ recipe.folder }}</span>
          </div>
        </div>
        <button
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--icon"
          :aria-label="t('recipes.send')"
          :title="t('recipes.sendHint')"
          :disabled="!!busy"
          @click="run('send', () => actions.sendToComfy(recipe, $event.shiftKey ? 'replace' : 'append'))"
        >
          <AppIcon name="send" />
        </button>
        <button
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--icon"
          :class="{ 'text-warning': recipe.favorite }"
          :aria-label="t('detail.toggleFavorite')"
          :aria-pressed="!!recipe.favorite"
          @click="actions.toggleFavorite(recipe)"
        >
          <AppIcon name="star" :filled="!!recipe.favorite" />
        </button>
        <button ref="closeButton" type="button" class="lm-btn lm-btn--ghost lm-btn--icon" :aria-label="t('common.close')" @click="emit('close')">
          <AppIcon name="close" />
        </button>
      </header>

      <div class="flex flex-1 flex-col gap-5 overflow-y-auto p-5 phone:px-4">
        <div class="flex flex-none items-center justify-center overflow-hidden rounded-md bg-sunken">
          <LazyMedia
            class="h-[min(420px,70vw)] w-full"
            :media-class="['size-full object-contain', blurred && 'blur-[18px]']"
            :src="previewUrl"
            :alt="title"
            loading="eager"
            fetchpriority="high"
            autoplay
            loop
            retry
          />
        </div>

        <!-- Use -->
        <div class="flex flex-wrap items-center gap-2" role="group" :aria-label="t('recipes.detail.use')">
          <button
            type="button"
            class="lm-btn lm-btn--primary"
            :disabled="!!busy"
            :title="t('recipes.sendHint')"
            @click="run('send', () => actions.sendToComfy(recipe, $event.shiftKey ? 'replace' : 'append'))"
          >
            <AppIcon name="send" :size="16" />{{ t('recipes.send') }}
          </button>
          <button type="button" class="lm-btn" :disabled="!!busy" @click="run('copy', () => actions.copySyntax(recipe))">
            <AppIcon name="copy" :size="16" />{{ t('recipes.copySyntax') }}
          </button>
          <button
            v-if="recipe.has_workflow"
            type="button"
            class="lm-btn"
            :disabled="!!busy"
            @click="run('workflow', () => actions.sendWorkflow(recipe))"
          >
            <AppIcon name="layers" :size="16" />{{ t('recipes.workflow.send') }}
          </button>
          <a v-if="sourceUrl" class="lm-btn lm-btn--ghost" :href="sourceUrl" target="_blank" rel="noopener noreferrer">
            <AppIcon name="external" :size="16" />{{ t('recipes.detail.source') }}
          </a>
        </div>

        <div class="flex flex-wrap items-center gap-2" role="group" :aria-label="t('actions.menuTitle')">
          <button type="button" class="lm-btn lm-btn--sm" @click="emit('rename', recipe)">
            <AppIcon name="pencil" :size="14" />{{ t('recipes.rename.open') }}
          </button>
          <button type="button" class="lm-btn lm-btn--sm" @click="emit('move', recipe)">
            <AppIcon name="folderMove" :size="14" />{{ t('actions.move') }}
          </button>
          <button type="button" class="lm-btn lm-btn--sm" :disabled="!!busy" :title="t('recipes.rematch.hint')" @click="rematch">
            <AppIcon name="refresh" :size="14" />{{ t('recipes.rematch.open') }}
          </button>
          <button type="button" class="lm-btn lm-btn--sm lm-btn--danger" @click="emit('delete', recipe)">
            <AppIcon name="trash" :size="14" />{{ t('actions.delete') }}
          </button>
        </div>

        <!-- Resources -->
        <section aria-labelledby="recipe-resources-title" class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 id="recipe-resources-title" class="lm-overline">{{ t('recipes.detail.resources') }}</h3>
            <button v-if="missing.targets.length || missing.withoutVersion" type="button" class="lm-btn lm-btn--sm" @click="downloadMissing">
              <AppIcon name="download" :size="14" />{{ t('recipes.missing.download', { count: missing.targets.length + missing.withoutVersion }) }}
            </button>
          </div>
          <p v-if="loadError" class="lm-error-text">{{ loadError }}</p>

          <div v-if="checkpoint" :class="[rowClass, checkpoint.state === 'library' ? 'border-border' : 'border-warning']">
            <LazyMedia class="size-[48px] flex-none overflow-hidden rounded-sm bg-sunken" media-class="size-full object-cover" :src="checkpoint.previewUrl ? withMountPrefix(checkpoint.previewUrl) : ''" :icon-size="18" />
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="text-xs text-muted">{{ t('recipes.detail.checkpoint') }}</span>
              <span class="truncate font-medium" :title="checkpoint.name">{{ checkpoint.name }}</span>
              <span v-if="checkpoint.version" class="truncate text-xs text-muted">{{ checkpoint.version }}</span>
            </div>
            <span :class="STATE_CLASS[checkpoint.state]">{{ t(STATE_LABEL[checkpoint.state]) }}</span>
            <router-link v-if="checkpoint.state === 'library' && checkpoint.localPath" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :to="libraryLink('checkpoints', checkpoint.localPath)" :aria-label="t('recipes.detail.openModel', { name: checkpoint.name })" :title="t('recipes.detail.openModel', { name: checkpoint.name })">
              <AppIcon name="external" :size="14" />
            </router-link>
            <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('recipes.reconnect.open', { name: checkpoint.name })" :title="t('recipes.reconnect.open', { name: checkpoint.name })" :aria-expanded="reconnecting === 'checkpoint'" @click="reconnecting = reconnecting === 'checkpoint' ? null : 'checkpoint'">
              <AppIcon name="link" :size="14" />
            </button>
          </div>
          <RecipeReconnectForm
            v-if="reconnecting === 'checkpoint'"
            :recipe-id="recipe.id"
            target="checkpoint"
            :submit="(value) => actions.reconnectCheckpoint(recipe, value)"
            @done="reconnecting = null; loadDetail()"
            @cancel="reconnecting = null"
          />

          <p v-if="!loras.length" class="text-sm text-muted">{{ t('recipes.detail.noLoras') }}</p>
          <ul v-else class="flex flex-col gap-2">
            <li v-for="lora in loras" :key="lora.index">
              <div :class="[rowClass, lora.state === 'library' ? 'border-border' : lora.state === 'missing' ? 'border-warning bg-warning-soft' : lora.state === 'deleted' ? 'border-danger bg-danger-soft' : 'border-border opacity-70']">
                <LazyMedia class="size-[48px] flex-none overflow-hidden rounded-sm bg-sunken" media-class="size-full object-cover" :src="lora.previewUrl ? withMountPrefix(lora.previewUrl) : ''" :icon-size="18" />
                <div class="flex min-w-0 flex-1 flex-col">
                  <span class="line-clamp-2 font-medium wrap-anywhere" :title="lora.name">{{ lora.name }}</span>
                  <span class="truncate text-xs text-muted" :title="lora.fileName">
                    {{ [lora.version, lora.fileName].filter(Boolean).join(' · ') }}
                  </span>
                  <span v-if="lora.previousName" class="truncate text-xs text-muted">{{ t('recipes.reconnect.was', { name: lora.previousName }) }}</span>
                </div>
                <span class="flex-none font-mono text-sm tabular-nums" :title="t('recipes.detail.strength')">{{ lora.strength }}</span>
                <span :class="[STATE_CLASS[lora.state], 'flex-none']">{{ t(STATE_LABEL[lora.state]) }}</span>
                <router-link
                  v-if="lora.state === 'library' && lora.localPath"
                  class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm flex-none"
                  :to="libraryLink('loras', lora.localPath)"
                  :aria-label="t('recipes.detail.openModel', { name: lora.name })"
                  :title="t('recipes.detail.openModel', { name: lora.name })"
                >
                  <AppIcon name="external" :size="14" />
                </router-link>
                <button
                  type="button"
                  class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm flex-none"
                  :aria-label="t('recipes.reconnect.open', { name: lora.name })"
                  :title="t('recipes.reconnect.open', { name: lora.name })"
                  :aria-expanded="reconnecting === lora.index"
                  @click="reconnecting = reconnecting === lora.index ? null : lora.index"
                >
                  <AppIcon name="link" :size="14" />
                </button>
                <button
                  v-if="lora.previousName"
                  type="button"
                  class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm flex-none"
                  :aria-label="t('recipes.reconnect.restore', { name: lora.previousName })"
                  :title="t('recipes.reconnect.restore', { name: lora.previousName })"
                  :disabled="!!busy"
                  @click="run('restore', () => actions.restore(recipe, lora.index))"
                >
                  <AppIcon name="arrowUp" :size="14" class="-rotate-90" />
                </button>
              </div>
              <RecipeReconnectForm
                v-if="reconnecting === lora.index"
                :recipe-id="recipe.id"
                :target="lora.index"
                :submit="(value) => actions.reconnect(recipe, lora.index, value)"
                @done="reconnecting = null"
                @cancel="reconnecting = null"
              />
            </li>
          </ul>
        </section>

        <!-- Generation data -->
        <section aria-labelledby="recipe-generation-title" class="flex flex-col gap-4">
          <h3 id="recipe-generation-title" class="lm-overline">{{ t('generation.title') }}</h3>
          <div v-if="loading && !generation" class="lm-skeleton h-[80px] rounded-sm"></div>
          <GenerationDetails :view="generation" :show-resources="false">
            <template #empty>
              <p v-if="!loading" class="text-sm text-muted">{{ t('recipes.detail.noGeneration') }}</p>
            </template>
          </GenerationDetails>
        </section>

        <!-- Tags -->
        <section aria-labelledby="recipe-tags-title">
          <h3 id="recipe-tags-title" class="lm-overline mb-2">{{ t('detail.tags') }}</h3>
          <ul v-if="tags.length" class="flex flex-wrap items-center gap-1" :aria-label="t('detail.tags')">
            <li
              v-for="tag in shownTags.visible"
              :key="tag"
              class="inline-flex h-[26px] max-w-full items-center overflow-hidden rounded-pill hairline border-border bg-sunken text-xs text-fg"
            >
              <button type="button" class="h-full cursor-pointer truncate pr-1 pl-3 hover:text-accent" :title="t('detail.filterByTag', { tag })" @click="emit('filter-tag', tag)">
                {{ tag }}
              </button>
              <button type="button" class="inline-grid h-full w-[24px] cursor-pointer place-items-center text-muted hover:text-danger" :aria-label="t('detail.removeTag', { tag })" @click="removeTag(tag)">
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
          <p v-else class="text-sm text-muted">{{ t('detail.noTags') }}</p>
          <form class="mt-2 flex max-w-[260px] gap-1" @submit.prevent="addTag">
            <label class="sr-only" for="recipe-new-tag">{{ t('detail.addTag') }}</label>
            <input id="recipe-new-tag" v-model="newTag" class="lm-input min-h-control-sm text-xs" :placeholder="t('detail.addTag')" autocomplete="off" />
            <button type="submit" class="lm-btn lm-btn--sm lm-btn--icon flex-none" :aria-label="t('detail.addTag')" :disabled="!newTag.trim()">
              <AppIcon name="plus" :size="14" />
            </button>
          </form>
        </section>

        <!-- Details -->
        <section aria-labelledby="recipe-details-title">
          <h3 id="recipe-details-title" class="lm-overline mb-2">{{ t('recipes.detail.details') }}</h3>
          <dl class="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            <dt class="text-muted">{{ t('recipes.detail.created') }}</dt>
            <dd>{{ formatDateTime(recipe.created_date) }}</dd>
            <dt class="text-muted">{{ t('recipes.detail.modified') }}</dt>
            <dd>{{ formatDateTime(recipe.modified) }}</dd>
            <dt class="text-muted">{{ t('recipes.detail.folder') }}</dt>
            <dd class="wrap-anywhere">{{ recipe.folder || t('recipes.detail.rootFolder') }}</dd>
            <template v-if="recipe.source_path">
              <dt class="text-muted">{{ t('recipes.detail.sourceLabel') }}</dt>
              <dd class="font-mono text-xs wrap-anywhere">{{ recipe.source_path }}</dd>
            </template>
            <dt class="text-muted">{{ t('recipes.detail.id') }}</dt>
            <dd class="flex items-center gap-1 font-mono text-xs wrap-anywhere">
              {{ recipe.id }}
              <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('recipes.detail.copyId')" @click="copy(recipe.id)">
                <AppIcon name="copy" :size="12" />
              </button>
            </dd>
            <template v-if="recipe.recipe_json_path">
              <dt class="text-muted">{{ t('recipes.detail.file') }}</dt>
              <dd class="font-mono text-xs wrap-anywhere">{{ recipe.recipe_json_path }}</dd>
            </template>
          </dl>
        </section>
      </div>
    </aside>
  </div>
</template>
