<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEventListener, useLocalStorage, useTimeoutFn } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import ExampleImagesDialog from './ExampleImagesDialog.vue'
import ExampleLightbox from './ExampleLightbox.vue'
import LazyMedia from './LazyMedia.vue'
import ModelActionMenu, { MODEL_ITEMS, type ActionMenuItem, type ModelAction } from './ModelActionMenu.vue'
import StateBlock from './StateBlock.vue'
import { downloadsApi, type ModelApi } from '@/api/endpoints'
import type { ModelItem, ModelMetadata, ModelUpdateRecord } from '@/api/types'
import { useDismissLayer } from '@/composables/useDismiss'
import { useExampleImages } from '@/composables/useExampleImages'
import { modelTypeOf } from '@/utils/exampleImages'
import { copyText, useConfirm, useToasts } from '@/composables/useFeedback'
import { usePersistentToggle } from '@/composables/usePersistentToggle'
import { useSendToWorkflow } from '@/composables/useSendToWorkflow'
import { useVersionClassification } from '@/composables/useVersionClassification'
import { destinationForFile } from '@/utils/updates'
import { withMountPrefix } from '@/utils/basePath'
import { civitaiModelUrl } from '@/utils/civitai'
import { formatBytes, formatDate, isVideoUrl } from '@/utils/format'
import { currentVersionId, nextTab, shouldConfirmClose } from '@/utils/drawer'
import {
  availableTabs,
  createRequestGuard,
  parseStoredTab,
  positionLabel,
  resolveTab,
  shouldHandleNavKey,
  type DrawerTab,
  type NavDirection,
  type NavState,
} from '@/utils/drawerNav'
import { isBlurred } from '@/utils/mature'
import { promptHint } from '@/utils/generation'
import { sanitizeHtml } from '@/utils/sanitize'
import { collapseTags } from '@/utils/tags'
import { loraStrengths, usageTipEntries, type SendMode } from '@/utils/workflow'
import { t, type MessageKey } from '@/i18n'

const props = withDefaults(
  defineProps<{
    item: ModelItem
    api: ModelApi
    classicUrl: string
    civitaiHost?: string
    canSend?: boolean
    blurMature?: boolean
    /** Position of this model in the displayed list (prev/next); null/absent hides the controls. */
    nav?: NavState | null
    /** Preview URLs of the neighbours, warmed in the background (images only, no metadata). */
    prefetch?: string[]
  }>(),
  { civitaiHost: 'civitai.com', canSend: false, blurMature: false, nav: null, prefetch: () => [] },
)
const emit = defineEmits<{
  close: []
  updated: [item: ModelItem]
  'filter-tag': [tag: string]
  action: [action: ModelAction]
  /** Open the download dialog for this Civitai model/version URL. */
  download: [input: string]
  /** Step to the previous/next model of the list (the library page owns the list and the open item). */
  navigate: [direction: NavDirection]
}>()

type Tab = DrawerTab
const TABS: { id: Tab; label: MessageKey }[] = [
  { id: 'overview', label: 'detail.tabs.overview' },
  { id: 'description', label: 'detail.tabs.description' },
  { id: 'versions', label: 'detail.tabs.versions' },
]

// Repeated layout classes.
const sectionClass = 'flex flex-col gap-5'
const blockTitleClass = 'mb-2 text-sm'
const chipsClass = 'flex flex-wrap items-center gap-2'
// Touch / phone layouts: every control gets a 44px hit area (--lm-touch-target); mouse layouts keep the compact sizes.
const touchHit = 'phone:min-h-touch touch:min-h-touch'
const touchIcon = 'phone:size-touch touch:size-touch'

const toasts = useToasts()
const { confirm } = useConfirm()
const workflow = useSendToWorkflow()
// The last selected tab is remembered across drawers and reloads (plain string, validated on read).
// A model without that tab (Versions needs a Civitai model id) shows Overview without touching the preference.
const preferredTab = useLocalStorage<string>('lm-ui.detail.tab', 'overview', { writeDefaults: false })
const tabFor = (item: ModelItem): Tab => resolveTab(parseStoredTab(preferredTab.value), availableTabs(item))
const tab = ref<Tab>(tabFor(props.item))
const specsOpen = usePersistentToggle('lm-ui.detail.specsOpen', false)
const tagsExpanded = ref(false)
const lightboxIndex = ref<number | null>(null)
let lightboxOpener: HTMLElement | null = null
const strength = ref(loraStrengths(props.item.usage_tips).strength)
const sending = ref(false)
const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const notesField = ref<HTMLTextAreaElement | null>(null)
const prevButton = ref<HTMLButtonElement | null>(null)
const nextButton = ref<HTMLButtonElement | null>(null)
const announcement = ref('')
// Time of the last prev/next request: a model change shortly after it is announced (a page load may take a moment).
let lastNavigateAt = -Infinity
const ANNOUNCE_WINDOW_MS = 5000
// "More actions" menu (the same model actions as the card menu, plus the external links).
const menu = ref<{ x: number; y: number; opener: HTMLElement } | null>(null)

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
const civitaiUrl = computed(() =>
  civitaiModelUrl(props.civitaiHost, modelId.value, props.item.civitai?.id ?? metadata.value?.id),
)
// Versions tab: the Updates classification (one read-only overview per drawer) and the
// queue destination next to this file (same rule as the Updates page).
const classification = useVersionClassification(() => props.api.prefix, modelId)
const roots = ref<string[] | null>(null)
function classificationChip(versionId: number): { label: string; tone: string } | null {
  const confidence = classification.byVersion.value.get(versionId)
  if (!confidence) return null
  const tone = confidence === 'likely' ? 'lm-badge--success' : confidence === 'possible' ? 'lm-badge--accent' : ''
  return { label: t(`detail.updateChip.${confidence}` as MessageKey), tone }
}
// External links (new tab) first, then the same model actions as the card menu.
const currentVersion = computed(() => currentVersionId(props.item, metadata.value))
const menuItems = computed<ActionMenuItem[]>(() => {
  const links: ActionMenuItem[] = []
  if (civitaiUrl.value) links.push({ action: 'civitai', label: t('detail.civitai'), icon: 'external', href: civitaiUrl.value })
  links.push({ action: 'classic', label: t('common.openClassic'), icon: 'external', href: props.classicUrl })
  return [...links, ...MODEL_ITEMS.map((entry, index) => ({ ...entry, label: t(entry.label), divider: index === 0 }))]
})
const tipEntries = computed(() => usageTipEntries(props.item.usage_tips))
const triggerWords = computed(() => {
  const words = metadata.value?.trainedWords ?? props.item.civitai?.trainedWords ?? []
  return words.map((word) => word.trim()).filter(Boolean)
})
// Example images: the local copy (example images folder) wins over the Civitai URL; imported images are local only.
const examples = useExampleImages(() => props.item, { modelType: () => modelTypeOf(props.api.prefix) })
const examplesOpen = ref(false)
const images = computed(() =>
  examples.media.value.map((media) => ({
    ...media.image,
    url: media.local ? withMountPrefix(media.url) : media.url,
    type: media.isVideo ? 'video' : media.image.type,
  })),
)
const localImages = computed(() => examples.localCount.value)
// Same rule and look as the library card; the lightbox reveals per image.
const blurClass = 'scale-110 blur-[18px]'
const coverBlurred = computed(() => isBlurred(props.item.preview_nsfw_level, props.blurMature))
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
const positionText = computed(() =>
  props.nav
    ? positionLabel(props.nav.ordinal, props.nav.total, (position, total) => t('detail.nav.position', { position, total }))
    : '',
)
const notesDirty = computed(() => notes.value !== (props.item.notes ?? ''))

// Switching models quickly: only the latest metadata / versions response is applied (earlier fetches are aborted).
const metaGuard = createRequestGuard()
const versionsGuard = createRequestGuard()

/** `quiet` (refresh): keep the current data on screen instead of showing the loading placeholders. */
async function loadMetadata(quiet = false): Promise<void> {
  const request = metaGuard.begin()
  if (!quiet) metaLoading.value = true
  metaError.value = null
  try {
    const result = await props.api.metadata(props.item.file_path, request.signal)
    if (!request.isCurrent()) return
    metadata.value = result
    examples.setMetadata(metadata.value?.images, metadata.value?.customImages)
    void examples.loadFiles()
  } catch (error) {
    if (!request.isCurrent()) return
    // Models without Civitai metadata answer success:false; that's not an error for the user.
    metadata.value = null
    examples.setMetadata([], [])
    if (props.item.from_civitai) metaError.value = (error as Error).message
  } finally {
    if (request.isCurrent()) metaLoading.value = false
  }
}

async function loadVersions(quiet = false): Promise<void> {
  if (!modelId.value) {
    versionsLoaded.value = true
    return
  }
  const request = versionsGuard.begin()
  if (!quiet) versionsLoading.value = true
  versionsError.value = null
  classification.ensure()
  try {
    const result = await props.api.versions(modelId.value, request.signal)
    if (!request.isCurrent()) return
    versions.value = result
  } catch (error) {
    if (!request.isCurrent()) return
    versionsError.value = (error as Error).message
  } finally {
    if (request.isCurrent()) {
      versionsLoading.value = false
      versionsLoaded.value = true
    }
  }
}

// Every panel stays in the DOM (hidden), so aria-controls is always valid; the data of the
// Versions tab is still loaded lazily, the first time it is shown. A tab switch starts at the top.
watch(tab, (value) => {
  if (scroller.value) scroller.value.scrollTop = 0
  if (value === 'versions' && !versionsLoaded.value && !versionsLoading.value) void loadVersions()
})

/** Roving tabindex: arrows / Home / End move focus to the neighbouring tab and select it. */
async function onTabKey(event: KeyboardEvent, index: number): Promise<void> {
  // Alt+Arrow is model navigation, not a tab move.
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const next = nextTab(event.key, index, TABS.length)
  if (next === null) return
  event.preventDefault()
  selectTab(TABS[next].id)
  await nextTick()
  document.getElementById(`tab-${TABS[next].id}`)?.focus()
}

/** A tab picked by the user: shown now and remembered for the next drawer. */
function selectTab(id: Tab): void {
  tab.value = id
  preferredTab.value = id
}

// While stepping through models quickly, the metadata (and versions) fetch waits until the user pauses:
// holding j/k never requests every model, and a request for a model that was left is aborted.
const STEP_LOAD_DELAY_MS = 150
const { start: startStepLoad, stop: stopStepLoad } = useTimeoutFn(
  () => {
    void loadMetadata()
    if (tab.value === 'versions' && !versionsLoaded.value && !versionsLoading.value) void loadVersions()
  },
  STEP_LOAD_DELAY_MS,
  { immediate: false },
)

function loadForItem(stepping: boolean): void {
  stopStepLoad()
  if (!stepping) {
    void loadMetadata()
    if (tab.value === 'versions' && !versionsLoading.value) void loadVersions()
    return
  }
  metaGuard.cancel()
  metaLoading.value = true
  startStepLoad()
}

watch(
  () => props.item.file_path,
  () => {
    notes.value = props.item.notes ?? ''
    tags.value = [...(props.item.tags ?? [])]
    metadata.value = null
    versions.value = null
    versionsLoaded.value = false
    versionsLoading.value = false
    versionsError.value = null
    versionsGuard.cancel()
    examples.clear()
    // Keep the remembered tab (the tab watcher loads Versions when it changes; otherwise the deferred load below does).
    tab.value = tabFor(props.item)
    if (scroller.value) scroller.value.scrollTop = 0
    tagsExpanded.value = false
    lightboxIndex.value = null
    examplesOpen.value = false
    strength.value = loraStrengths(props.item.usage_tips).strength
    loadForItem(performance.now() - lastNavigateAt < ANNOUNCE_WINDOW_MS)
    if (performance.now() - lastNavigateAt < ANNOUNCE_WINDOW_MS) {
      announcement.value = t('detail.nav.announce', { name: displayName.value, position: positionText.value })
    }
  },
)

// A refresh can bring newer notes / tags for the same model: follow them unless the notes hold an unsaved draft.
watch(
  () => props.item.notes,
  (next, previous) => {
    if (notes.value === (previous ?? '')) notes.value = next ?? ''
  },
)
watch(
  () => props.item.tags,
  (next, previous) => {
    const shown = tags.value.join('\n')
    if (shown === (previous ?? []).join('\n') && shown !== (next ?? []).join('\n')) tags.value = [...(next ?? [])]
  },
)

/**
 * Page refresh: re-read the metadata (examples, trigger words, description) and,
 * once they were loaded, the versions, without placeholders. The tab, the scroll
 * position and an unsaved notes draft stay.
 */
async function refresh(): Promise<void> {
  if (metaLoading.value && !metadata.value) return
  await Promise.all([loadMetadata(true), versionsLoaded.value && !versionsLoading.value ? loadVersions(true) : undefined])
}

defineExpose({ refresh })

// Warm the neighbours' preview images only (no metadata requests while stepping).
const prefetched = new Set<string>()
watch(
  () => props.prefetch,
  (urls) => {
    for (const url of urls) {
      if (!url || prefetched.has(url)) continue
      prefetched.add(url)
      const image = new Image()
      image.decoding = 'async'
      image.src = withMountPrefix(url)
    }
  },
  { immediate: true },
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

/**
 * Queue a version next to this file: the same root and folder as the open
 * model (`destinationForFile`, like Update on the Updates page); the default
 * root + path template when the root cannot be determined.
 */
async function queueVersion(versionId: number): Promise<void> {
  try {
    if (roots.value === null) {
      try {
        roots.value = await props.api.roots()
      } catch {
        roots.value = []
      }
    }
    const destination = destinationForFile(props.item.file_path, roots.value)
    const result = await downloadsApi.add({ modelId: modelId.value, versionId, destination: destination.params })
    if (result.duplicate) toasts.success(t('detail.alreadyQueued'))
    else toasts.success(destination.known ? t('detail.queuedTo', { path: destination.display }) : t('detail.queuedDefault'))
  } catch (error) {
    toasts.error((error as Error).message)
  }
}

function openMenu(event: MouseEvent): void {
  const button = event.currentTarget as HTMLElement
  const rect = button.getBoundingClientRect()
  menu.value = { x: rect.right - 240, y: rect.bottom + 4, opener: button }
}

function closeMenu(reason: 'escape' | 'outside' | 'select'): void {
  const opener = menu.value?.opener
  menu.value = null
  if (reason === 'escape') opener?.focus()
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

/**
 * Leaving with unsaved notes asks first (nothing is auto-saved). Every way out goes through
 * this: Escape, the backdrop, the Close button and filtering by a tag (the library closes the
 * drawer for that). Switching to another model through the `item` prop resets the draft
 * without asking (the watcher above), like the tag list.
 */
async function confirmLeave(): Promise<boolean> {
  if (!shouldConfirmClose(notesDirty.value)) return true
  const discard = await confirm({
    title: t('detail.discardNotes.title'),
    message: t('detail.discardNotes.message'),
    confirmLabel: t('detail.discardNotes.confirm'),
    cancelLabel: t('detail.discardNotes.keep'),
    danger: true,
  })
  if (!discard) {
    await nextTick()
    notesField.value?.focus()
  }
  return discard
}

/** Previous / next model; asks first when the notes have unsaved changes. */
async function requestNavigate(direction: NavDirection): Promise<void> {
  const nav = props.nav
  if (!nav || (direction === 'prev' ? !nav.hasPrev : !nav.hasNext)) return
  if (!(await confirmLeave())) return
  lastNavigateAt = performance.now()
  emit('navigate', direction)
}

// At either end the pressed button becomes disabled (after the library has stepped): keep focus inside the drawer.
watch(
  () => [props.nav?.hasPrev, props.nav?.hasNext],
  async () => {
    await nextTick()
    const active = document.activeElement
    if (active && active !== document.body && !(active as HTMLButtonElement).disabled) return
    const other = [prevButton.value, nextButton.value].find((button) => button && !button.disabled)
    const target = other ?? closeButton.value
    target?.focus()
  },
)

async function requestClose(): Promise<void> {
  if (await confirmLeave()) emit('close')
}

async function filterTag(tag: string): Promise<void> {
  if (await confirmLeave()) emit('filter-tag', tag)
}

// Escape and backdrop clicks close the drawer only while it is the topmost overlay
// (not while the lightbox, confirm or node picker dialog is open on top of it).
const { isTopmost, backdrop } = useDismissLayer({ active: () => true, close: () => void requestClose() })

function onKey(event: KeyboardEvent): void {
  // Modal dialogs on top (lightbox, node picker) handle their own keys.
  const dialogOpen = !!document.querySelector('dialog[open]')
  if (!isTopmost() || dialogOpen) return
  const direction = shouldHandleNavKey(event, { topmost: true, dialogOpen, menuOpen: !!menu.value })
  if (direction) {
    event.preventDefault()
    void requestNavigate(direction)
    return
  }
  if (event.key === 'Tab' && panel.value) {
    // Keep focus inside the drawer while it is open.
    // Hidden tab panels (v-show) are not focus targets.
    const focusable = [
      ...panel.value.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => element.getClientRects().length > 0)
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
  void loadMetadata()
  if (tab.value === 'versions') void loadVersions()
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
      aria-labelledby="drawer-title"
    >
      <!-- Desktop: title block, then [prev position next] favorite more close. Phone: a second row with the
           navigation (its 44px hit areas overlap the row's padding) so the header stays slim. -->
      <header
        class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-start gap-x-2 px-5 pt-4 pb-3 phone:grid-cols-[minmax(0,1fr)_auto_auto_auto] phone:px-4 phone:pt-1 phone:pb-2"
      >
        <h2
          id="drawer-title"
          class="col-start-1 row-start-1 mb-2 min-w-0 text-xl wrap-anywhere phone:mt-1 phone:mb-0 phone:line-clamp-2 phone:text-lg"
          :title="displayName"
        >
          {{ displayName }}
        </h2>
        <div class="col-start-1 row-start-2 flex min-w-0 flex-wrap gap-1 phone:col-span-3 phone:col-start-2 phone:justify-end">
          <span v-if="item.base_model" class="lm-badge lm-badge--accent">{{ item.base_model }}</span>
          <button
            v-if="item.update_available"
            type="button"
            class="lm-badge lm-badge--warning cursor-pointer hover:opacity-80 phone:hidden touch:min-h-touch touch:px-3"
            :aria-label="t('detail.showUpdates')"
            :title="t('library.updatesFlagHint')"
            data-testid="update-flag"
            @click="tab = 'versions'"
          >
            {{ t('card.update') }}
          </button>
          <span v-if="item.civitai?.name" class="lm-badge phone:hidden">{{ item.civitai.name }}</span>
        </div>
        <div
          v-if="nav"
          class="col-start-2 row-start-1 flex items-center phone:col-start-1 phone:row-start-2 phone:-my-2 phone:justify-self-start"
          role="group"
          :aria-label="t('detail.nav.group')"
        >
          <button
            ref="prevButton"
            type="button"
            class="lm-btn lm-btn--ghost lm-btn--icon"
            :class="touchIcon"
            :aria-label="t('detail.nav.prev')"
            :title="t('detail.nav.prevHint')"
            aria-keyshortcuts="Alt+ArrowLeft K"
            :disabled="!nav.hasPrev"
            @click="requestNavigate('prev')"
          >
            <AppIcon name="chevronLeft" />
          </button>
          <span class="min-w-[5ch] px-1 text-center text-xs whitespace-nowrap text-muted tabular-nums">{{ positionText }}</span>
          <button
            ref="nextButton"
            type="button"
            class="lm-btn lm-btn--ghost lm-btn--icon"
            :class="touchIcon"
            :aria-label="t('detail.nav.next')"
            :title="t('detail.nav.nextHint')"
            aria-keyshortcuts="Alt+ArrowRight J"
            :disabled="!nav.hasNext"
            @click="requestNavigate('next')"
          >
            <AppIcon name="chevronRight" />
          </button>
        </div>
        <button
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--icon col-start-3 row-start-1 phone:col-start-2"
          :class="[touchIcon, { 'text-warning': item.favorite }]"
          :aria-label="t('detail.toggleFavorite')"
          :aria-pressed="!!item.favorite"
          @click="toggleFavorite"
        >
          <AppIcon name="star" :filled="!!item.favorite" />
        </button>
        <button
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--icon col-start-4 row-start-1 phone:col-start-3"
          :class="touchIcon"
          :aria-label="t('detail.moreActions')"
          :title="t('detail.moreActions')"
          aria-haspopup="menu"
          :aria-expanded="!!menu"
          @click="openMenu"
        >
          <AppIcon name="more" />
        </button>
        <button
          ref="closeButton"
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--icon col-start-5 row-start-1 phone:col-start-4"
          :class="touchIcon"
          :aria-label="t('common.close')"
          @click="requestClose"
        >
          <AppIcon name="close" />
        </button>
        <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
      </header>

      <div class="flex gap-1 overflow-x-auto hairline-b border-border px-5 phone:px-3" role="tablist" :aria-label="t('detail.tabsLabel')">
        <button
          v-for="(entry, index) in TABS"
          :id="`tab-${entry.id}`"
          :key="entry.id"
          type="button"
          role="tab"
          class="inline-flex cursor-pointer items-center gap-1 border-b-2 px-3 py-2 font-medium whitespace-nowrap phone:min-h-touch touch:min-h-touch"
          :class="tab === entry.id ? 'border-accent text-fg' : 'border-transparent text-muted'"
          :aria-selected="tab === entry.id"
          :aria-controls="`panel-${entry.id}`"
          :tabindex="tab === entry.id ? 0 : -1"
          @click="selectTab(entry.id)"
          @keydown="onTabKey($event, index)"
        >
          {{ t(entry.label) }}
        </button>
      </div>

      <div ref="scroller" class="flex-1 overflow-y-auto p-5 phone:px-4">
        <!-- Overview -->
        <section v-show="tab === 'overview'" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" :class="sectionClass">
          <!-- Send to ComfyUI (LoRAs): one compact row, usage tips from the metadata below it. -->
          <div v-if="canSend" class="flex flex-col gap-2 rounded-md bg-sunken p-3">
            <div class="flex flex-wrap items-end gap-2">
              <label class="flex flex-col gap-1 text-xs text-muted" for="drawer-strength">
                {{ t('detail.strength') }}
                <input
                  id="drawer-strength"
                  v-model.number="strength"
                  class="lm-input w-[84px] tabular-nums"
                  :class="touchHit"
                  type="number"
                  step="0.05"
                  min="-10"
                  max="10"
                />
              </label>
              <button type="button" class="lm-btn lm-btn--primary" :class="touchHit" :disabled="sending" @click="sendToComfy('append')">
                <AppIcon name="send" :size="16" />{{ t('detail.sendAppend') }}
              </button>
              <button type="button" class="lm-btn" :class="touchHit" :disabled="sending" @click="sendToComfy('replace')">
                {{ t('detail.sendReplace') }}
              </button>
              <button
                type="button"
                class="lm-btn lm-btn--ghost lm-btn--icon"
                :class="touchIcon"
                :aria-label="t('detail.copySyntax')"
                :title="t('detail.copySyntax')"
                @click="copySyntax"
              >
                <AppIcon name="copy" :size="16" />
              </button>
            </div>
            <ul v-if="tipEntries.length" class="flex flex-wrap items-center gap-1" :aria-label="t('detail.usageTips')">
              <li v-for="entry in tipEntries" :key="entry.key">
                <button
                  v-if="entry.strength !== null"
                  type="button"
                  class="lm-chip tabular-nums"
                  :class="touchHit"
                  :title="t('detail.useStrength', { value: entry.strength })"
                  @click="strength = entry.strength"
                >
                  {{ entry.text }}
                </button>
                <span v-else class="lm-chip tabular-nums">{{ entry.text }}</span>
              </li>
            </ul>
          </div>

          <div v-if="canSend || triggerWords.length || metaError">
            <div class="flex items-center justify-between">
              <h3 :class="blockTitleClass">{{ t('detail.triggerWords') }}</h3>
              <button v-if="triggerWords.length > 1" type="button" class="lm-btn lm-btn--sm" :class="touchHit" @click="copy(triggerWords.join(', '))">
                <AppIcon name="copy" :size="14" />{{ t('detail.copyAll') }}
              </button>
            </div>
            <div v-if="metaLoading && canSend" class="lm-skeleton h-[28px] rounded-sm"></div>
            <div v-else-if="triggerWords.length" :class="chipsClass">
              <button
                v-for="word in triggerWords"
                :key="word"
                type="button"
                class="lm-chip text-left font-mono whitespace-normal"
                :class="touchHit"
                :title="t('common.copy')"
                @click="copy(word)"
              >
                {{ word }}<AppIcon name="copy" :size="12" />
              </button>
            </div>
            <p v-else-if="canSend" class="my-[1em] text-muted">{{ t('detail.noTriggerWords') }}</p>
            <p v-if="metaError" class="lm-error-text">{{ metaError }}</p>
          </div>

          <!-- Cover + examples: side by side on a wide drawer, stacked (examples as a strip) when narrow. -->
          <div class="@container flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <h3 id="drawer-examples-title" class="lm-overline flex items-center gap-2">
                {{ t('detail.examples') }}
                <span v-if="images.length" class="tabular-nums">{{ images.length }}</span>
                <span v-if="localImages" class="lm-badge lm-badge--success normal-case">{{ t('examples.localCount', { count: localImages }) }}</span>
              </h3>
              <button type="button" class="lm-btn lm-btn--sm lm-btn--ghost ml-auto" :class="touchHit" :disabled="metaLoading" @click="examplesOpen = true">
                <AppIcon name="image" :size="14" />{{ t('examples.manage') }}
              </button>
            </div>
            <div
              class="grid gap-3"
              :class="previewUrl && (metaLoading || images.length) ? '@min-[460px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''"
            >
              <div v-if="previewUrl" class="flex items-center justify-center overflow-hidden rounded-md bg-sunken">
                <!-- Fixed-height box: the cover never shifts the layout while it loads. -->
                <LazyMedia
                  class="h-[min(420px,70vw)] w-full"
                  :media-class="['size-full object-contain', coverBlurred && blurClass]"
                  :src="previewUrl"
                  loading="eager"
                  fetchpriority="high"
                  autoplay
                  loop
                  retry
                />
              </div>

              <div v-if="metaLoading || images.length" class="flex min-w-0 flex-col gap-2" role="group" :aria-labelledby="'drawer-examples-title'">
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
                      class="group/thumb lm-zoom-host relative size-[88px] flex-none cursor-pointer overflow-hidden rounded-sm bg-sunken @min-[460px]:aspect-square @min-[460px]:size-auto"
                      :aria-label="t('detail.openExample', { index: index + 1, count: images.length })"
                      :title="imageHints[index] || undefined"
                      @click="openLightbox(index, $event)"
                    >
                      <LazyMedia
                        class="size-full"
                        :media-class="['lm-zoom-media size-full object-cover', isBlurred(image.nsfwLevel, blurMature) && blurClass]"
                        :src="image.url"
                        :kind="image.type === 'video' || isVideoUrl(image.url) ? 'video' : 'image'"
                        :icon-size="20"
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
            <p v-if="!metaLoading && !images.length && item.from_civitai" class="text-xs text-muted">{{ t('detail.noExamples') }}</p>
          </div>

          <!-- Tags: uniform neutral pills; click filters the library, x removes. -->
          <div>
            <h3 :class="blockTitleClass">{{ t('detail.tags') }}</h3>
            <ul v-if="tags.length" class="flex flex-wrap items-center gap-1 phone:gap-y-4 touch:gap-y-4" :aria-label="t('detail.tags')">
              <li
                v-for="tag in shownTags.visible"
                :key="tag"
                class="inline-flex h-[26px] max-w-full items-center rounded-pill hairline border-border bg-sunken text-xs text-fg"
              >
                <button
                  type="button"
                  class="h-full min-w-0 cursor-pointer truncate rounded-l-pill pr-1 pl-3 hover:text-accent phone:h-touch phone:min-w-touch phone:pr-3 touch:h-touch touch:min-w-touch touch:pr-3"
                  :title="t('detail.filterByTag', { tag })"
                  @click="filterTag(tag)"
                >
                  {{ tag }}
                </button>
                <button
                  type="button"
                  class="inline-grid h-full w-[24px] flex-none cursor-pointer place-items-center rounded-r-pill text-muted hover:text-danger phone:-mx-[10px] phone:h-touch phone:w-touch touch:-mx-[10px] touch:h-touch touch:w-touch"
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
                  class="inline-flex h-[26px] cursor-pointer items-center rounded-pill px-2 text-xs font-medium text-accent hover:bg-accent-soft phone:h-touch touch:h-touch"
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
                class="lm-input min-h-control-sm text-xs phone:min-h-touch touch:min-h-touch"
                :placeholder="t('detail.addTag')"
                :disabled="savingTags"
              />
              <button
                type="submit"
                class="lm-btn lm-btn--sm lm-btn--icon flex-none"
                :class="touchIcon"
                :aria-label="t('detail.addTag')"
                :disabled="savingTags || !newTag.trim()"
              >
                <AppIcon name="plus" :size="14" />
              </button>
            </form>
          </div>

          <div>
            <label class="lm-label" for="drawer-notes"><h3 :class="blockTitleClass">{{ t('detail.notes') }}</h3></label>
            <textarea id="drawer-notes" ref="notesField" v-model="notes" class="lm-textarea" :placeholder="t('detail.notesPlaceholder')"></textarea>
            <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
              <span class="mr-auto text-xs text-muted" aria-live="polite">{{ notesDirty ? t('detail.unsavedNotes') : '' }}</span>
              <button type="button" class="lm-btn lm-btn--primary" :class="touchHit" :disabled="!notesDirty || savingNotes" @click="saveNotes">
                {{ t('common.save') }}
              </button>
            </div>
          </div>

          <!-- Specifications: collapsed by default, state remembered. -->
          <div class="rounded-md bg-sunken">
            <h3>
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-2 rounded-md px-4 py-3 text-left text-sm font-bold phone:min-h-touch touch:min-h-touch"
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
                    :class="touchIcon"
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
                    :class="touchIcon"
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
        <section v-show="tab === 'description'" id="panel-description" role="tabpanel" aria-labelledby="tab-description" :class="sectionClass">
          <StateBlock v-if="metaLoading" kind="loading" />
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized with an allow-list -->
          <div v-else-if="description" class="lm-prose" v-html="description"></div>
          <StateBlock v-else kind="empty" :title="t('detail.noDescription')" />
        </section>

        <!-- Versions -->
        <section v-show="tab === 'versions'" id="panel-versions" role="tabpanel" aria-labelledby="tab-versions" :class="sectionClass">
          <StateBlock v-if="versionsLoading" kind="loading" />
          <StateBlock v-else-if="versionsError" kind="error" :message="versionsError" @retry="loadVersions" />
          <StateBlock v-else-if="!versions?.versions?.length" kind="empty" :title="t('detail.noVersions')" />
          <ul v-else class="flex flex-col gap-2">
            <li
              v-for="version in versions.versions"
              :key="version.versionId"
              class="flex items-center gap-3 rounded-md hairline p-2 phone:flex-wrap"
              :class="version.versionId === currentVersion ? 'border-accent' : 'border-border'"
              :aria-current="version.versionId === currentVersion ? 'true' : undefined"
            >
              <LazyMedia
                class="lm-thumb h-[72px] w-[56px]"
                media-class="size-full object-cover"
                :src="version.previewUrl ? withMountPrefix(version.previewUrl) : ''"
                :icon-size="18"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
                <strong class="wrap-anywhere">{{ version.name }}</strong>
                <div class="flex flex-wrap gap-2 text-xs text-muted">
                  <span v-if="version.baseModel">{{ version.baseModel }}</span>
                  <span v-if="version.releasedAt">{{ formatDate(version.releasedAt) }}</span>
                  <span v-if="version.sizeBytes">{{ formatBytes(version.sizeBytes) }}</span>
                </div>
                <div class="flex flex-wrap gap-1">
                  <span v-if="version.versionId === currentVersion" class="lm-badge lm-badge--accent">{{ t('detail.current') }}</span>
                  <span v-if="version.isInLibrary" class="lm-badge lm-badge--success">{{ t('detail.inLibrary') }}</span>
                  <span v-else-if="version.hasBeenDownloaded" class="lm-badge">{{ t('detail.downloaded') }}</span>
                  <span v-if="version.isEarlyAccess" class="lm-badge lm-badge--warning">{{ t('detail.earlyAccess') }}</span>
                  <span
                    v-if="!version.isInLibrary && classificationChip(version.versionId)"
                    class="lm-badge"
                    :class="classificationChip(version.versionId)!.tone"
                    :title="t('detail.updateChipHint')"
                    data-testid="update-chip"
                  >{{ classificationChip(version.versionId)!.label }}</span>
                </div>
              </div>
              <!-- Fixed-width actions column so every row lines up; a version already in the library keeps the space empty. -->
              <div class="flex w-[168px] flex-none items-center justify-end gap-1 phone:w-full" :class="version.isInLibrary && 'phone:hidden'">
                <template v-if="!version.isInLibrary">
                  <button type="button" class="lm-btn lm-btn--sm" :class="touchHit" @click="queueVersion(version.versionId)">
                    <AppIcon name="download" :size="14" />{{ t('detail.queueVersion') }}
                  </button>
                  <button
                    type="button"
                    class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm"
                    :class="touchIcon"
                    :aria-label="t('download.fromVersion')"
                    :title="t('download.title')"
                    @click="emit('download', `https://civitai.com/models/${modelId}?modelVersionId=${version.versionId}`)"
                  >
                    <AppIcon name="folder" :size="14" />
                  </button>
                </template>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </aside>

    <ModelActionMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :label="t('actions.menu', { name: displayName })"
      :items="menuItems"
      @select="emit('action', $event as ModelAction)"
      @close="closeMenu"
    />

    <ExampleImagesDialog v-if="examplesOpen" :name="displayName" :ex="examples" @close="examplesOpen = false" />

    <ExampleLightbox
      v-if="lightboxIndex !== null && images.length"
      v-model:index="lightboxIndex"
      :images="images"
      :blur-mature="blurMature"
      @close="closeLightbox"
    />
  </div>
</template>
