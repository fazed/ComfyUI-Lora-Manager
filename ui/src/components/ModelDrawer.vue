<script setup lang="ts">
/**
 * Full details flyout of one model, on the Reka UI Sheet (side right): modal,
 * labelled by the title, focus moves in on open and back to the opener on
 * close, Tab is trapped. Header (name, prev / next, Send, links, licence,
 * favourite, actions, tags), an info column on the left with its own scroll
 * and a tabbed pane on the right (Examples, Description, Versions, Recipes).
 * Every panel stays mounted (v-show): a tab or thumbnail change only touches
 * the right pane, the header and the info column keep their DOM and scroll.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useLocalStorage, useTimeoutFn } from '@vueuse/core'
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import ExampleImagesDialog from './ExampleImagesDialog.vue'
import ExampleLightbox from './ExampleLightbox.vue'
import GenerationDetails from './GenerationDetails.vue'
import LazyMedia from './LazyMedia.vue'
import ModelActionMenu, { MODEL_ITEMS, type ActionMenuItem, type ModelAction } from './ModelActionMenu.vue'
import StateBlock from './StateBlock.vue'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { downloadsApi, updatesApi, type ModelApi } from '@/api/endpoints'
import { recipesApi } from '@/api/recipes'
import type { ModelItem, ModelMetadata, ModelUpdateRecord, ModelVersionInfo, RecipeItem, VersionLocalFile } from '@/api/types'
import { downloadQueueSnapshot } from '@/composables/useDownloadQueue'
import type { VersionFileTarget } from '@/composables/useModelActions'
import { useReplaceChoice } from '@/composables/useReplaceChoice'
import { useUpdatesSummary } from '@/composables/useUpdates'
import {
  fileNameOf,
  isOwnedVersion,
  isVersionDownloading,
  localFilesOf,
  ownedFilesForVersion,
  queueErrorText,
} from '@/utils/versionManagement'
import { useExampleImages } from '@/composables/useExampleImages'
import { modelTypeOf } from '@/utils/exampleImages'
import { copyText, useConfirm, useToasts } from '@/composables/useFeedback'
import { useSendToWorkflow } from '@/composables/useSendToWorkflow'
import { useVersionClassification } from '@/composables/useVersionClassification'
import { SHORTCUTS } from '@/config/shortcuts'
import { destinationForFile } from '@/utils/updates'
import { withMountPrefix } from '@/utils/basePath'
import { civitaiModelUrl } from '@/utils/civitai'
import { formatBytes, formatDate, isVideoUrl } from '@/utils/format'
import {
  currentVersionId,
  licenceLabels,
  nextTab,
  shortHash,
  shouldConfirmClose,
  USAGE_TIP_KEYS,
  versionFlags,
  withUsageTip,
} from '@/utils/drawer'
import {
  availableTabs,
  createRequestGuard,
  parseStoredTab,
  positionLabel,
  resolveTab,
  shouldHandleDeleteKey,
  shouldHandleNavKey,
  type DrawerTab,
  type NavDirection,
  type NavState,
} from '@/utils/drawerNav'
import { isBlurred } from '@/utils/mature'
import { promptHint, toGenerationView } from '@/utils/generation'
import { sanitizeHtml } from '@/utils/sanitize'
import { collapseTags } from '@/utils/tags'
import { formatStrength, loraStrengths, parseUsageTips, usageTipEntries, type SendMode } from '@/utils/workflow'
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
  /** Delete one local file of a version (Versions tab); the page confirms and runs it. */
  'delete-file': [request: { file: VersionFileTarget; isCurrent: boolean; siblingPath: string | null }]
}>()

type Tab = DrawerTab
const TAB_LABELS: Record<Tab, MessageKey> = {
  examples: 'detail.tabs.examples',
  description: 'detail.tabs.description',
  versions: 'detail.tabs.versions',
  recipes: 'detail.tabs.recipes',
}
const isLora = computed(() => props.api.prefix === 'loras')
const tabs = computed(() => availableTabs(props.item, isLora.value))

// Repeated layout classes.
const blockTitleClass = 'mb-2 text-sm font-medium text-muted'
const chipsClass = 'flex flex-wrap items-center gap-2'
// One info row: label, then the value with its actions.
const fieldClass = 'grid min-h-control grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-2 hairline-b border-border py-1 text-sm last:border-b-0 [&>dt]:text-muted'
const valueClass = 'flex min-w-0 items-center gap-1 wrap-anywhere'
const miniButton = 'lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm flex-none'
// Touch / phone layouts: every control gets a 44px hit area (--lm-touch-target); mouse layouts keep the compact sizes.
const touchHit = 'phone:min-h-touch touch:min-h-touch'
const touchIcon = 'phone:size-touch touch:size-touch'

const router = useRouter()
const toasts = useToasts()
const { confirm } = useConfirm()
const replaceChoice = useReplaceChoice()
const queueSnapshot = downloadQueueSnapshot()
const workflow = useSendToWorkflow()
const updatesSummary = useUpdatesSummary()
// The last selected tab is remembered across drawers and reloads (plain string, validated on read).
// A model without that tab (Versions needs a Civitai model id) shows Examples without touching the preference.
const preferredTab = useLocalStorage<string>('lm-ui.detail.tab', 'examples', { writeDefaults: false })
const tabFor = (item: ModelItem): Tab => resolveTab(parseStoredTab(preferredTab.value), availableTabs(item, isLora.value))
const tab = ref<Tab>(tabFor(props.item))
const tagsExpanded = ref(false)
const lightboxIndex = ref<number | null>(null)
let lightboxOpener: HTMLElement | null = null
// Example shown large in the Examples tab (a thumbnail click changes only this).
const shot = ref(0)
const strength = ref(loraStrengths(props.item.usage_tips).strength)
const sending = ref(false)
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
const ignoring = ref(false)

const recipes = ref<RecipeItem[] | null>(null)
const recipesLoading = ref(false)
const recipesError = ref<string | null>(null)

const notes = ref(props.item.notes ?? '')
const savingNotes = ref(false)
const tags = ref<string[]>([...(props.item.tags ?? [])])
const newTag = ref('')
const savingTags = ref(false)
// Inline edits (fields save-metadata stores as they are): one at a time.
const editing = ref<'name' | 'baseModel' | null>(null)
const draft = ref('')
const newTip = ref<{ key: string; value: string }>({ key: USAGE_TIP_KEYS[0], value: '' })
const newWord = ref('')
const savingField = ref(false)
const hashing = ref(false)

const displayName = computed(() => props.item.model_name || props.item.file_name)
const previewUrl = computed(() => (props.item.preview_url ? withMountPrefix(props.item.preview_url) : ''))
const modelId = computed(() => props.item.civitai?.modelId ?? metadata.value?.modelId ?? null)
const versionId = computed(() => currentVersionId(props.item, metadata.value))
const civitaiUrl = computed(() => civitaiModelUrl(props.civitaiHost, modelId.value, versionId.value))
const versionUrl = (id: number) => civitaiModelUrl(props.civitaiHost, modelId.value, id)
const creator = computed(() => props.item.civitai?.creator?.username ?? '')
const licence = computed(() => licenceLabels(metadata.value?.model))
// Versions tab: the Updates classification (one read-only overview per drawer) and the
// queue destination next to this file (same rule as the Updates page).
const classification = useVersionClassification(() => props.api.prefix, modelId)
const roots = ref<string[] | null>(null)
function classificationChip(id: number): { label: string; tone: string } | null {
  const confidence = classification.byVersion.value.get(id)
  if (!confidence) return null
  const tone = confidence === 'likely' ? 'lm-badge--success' : confidence === 'possible' ? 'lm-badge--accent' : ''
  return { label: t(`detail.updateChip.${confidence}` as MessageKey), tone }
}
// External links (new tab) first, then the same model actions as the card menu.
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
const stageImage = computed(() => images.value[shot.value] ?? null)
const stageView = computed(() => toGenerationView(stageImage.value?.meta))
const isVideo = (image: { type?: string; url: string }) => image.type === 'video' || isVideoUrl(image.url)
// Same rule and look as the library card; the lightbox reveals per image.
const blurClass = 'scale-110 blur-[18px]'
const coverBlurred = computed(() => isBlurred(props.item.preview_nsfw_level, props.blurMature))
const imageHints = computed(() => images.value.map((image) => promptHint(image.meta)))
const shownTags = computed(() => collapseTags(tags.value, tagsExpanded.value))
const fileType = computed(() => {
  const match = props.item.file_path?.match(/\.([a-z0-9]+)$/i)
  return match ? match[1].toLowerCase() : ''
})
// The Description tab shows the model description (the version text when there is none);
// "About this version" shows the version text next to it.
const modelDescription = computed(() => sanitizeHtml(metadata.value?.model?.description || ''))
const versionDescription = computed(() => sanitizeHtml(metadata.value?.description || ''))
const description = computed(() => modelDescription.value || versionDescription.value)
const positionText = computed(() =>
  props.nav
    ? positionLabel(props.nav.ordinal, props.nav.total, (position, total) => t('detail.nav.position', { position, total }))
    : '',
)
const notesDirty = computed(() => notes.value !== (props.item.notes ?? ''))

// Switching models quickly: only the latest metadata / versions response is applied (earlier fetches are aborted).
const metaGuard = createRequestGuard()
const versionsGuard = createRequestGuard()
const recipesGuard = createRequestGuard()

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

/** Recipes tab: recipes that use this LoRA (by SHA256), loaded the first time the tab shows. */
async function loadRecipes(): Promise<void> {
  const hash = props.item.sha256
  if (!hash) {
    recipes.value = []
    return
  }
  const request = recipesGuard.begin()
  recipesLoading.value = true
  recipesError.value = null
  try {
    const result = await recipesApi.forLora(hash, request.signal)
    if (request.isCurrent()) recipes.value = result
  } catch (error) {
    if (request.isCurrent()) recipesError.value = (error as Error).message
  } finally {
    if (request.isCurrent()) recipesLoading.value = false
  }
}

/** Lazy data of the shown tab (Versions, Recipes). */
function loadTabData(value: Tab): void {
  if (value === 'versions' && !versionsLoaded.value && !versionsLoading.value) void loadVersions()
  if (value === 'recipes' && recipes.value === null && !recipesLoading.value) void loadRecipes()
}

// Every panel stays in the DOM (hidden), so aria-controls is always valid; the data of the
// Versions and Recipes tabs is still loaded lazily. A tab switch scrolls the right pane to the top only.
watch(tab, (value) => {
  if (scroller.value) scroller.value.scrollTop = 0
  loadTabData(value)
})

/** Roving tabindex: arrows / Home / End move focus to the neighbouring tab and select it. */
async function onTabKey(event: KeyboardEvent, index: number): Promise<void> {
  // Alt+Arrow is model navigation, not a tab move.
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const next = nextTab(event.key, index, tabs.value.length)
  if (next === null) return
  event.preventDefault()
  const id = tabs.value[next]
  selectTab(id)
  await nextTick()
  document.getElementById(`tab-${id}`)?.focus()
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
    loadTabData(tab.value)
  },
  STEP_LOAD_DELAY_MS,
  { immediate: false },
)

function loadForItem(stepping: boolean): void {
  stopStepLoad()
  if (!stepping) {
    void loadMetadata()
    loadTabData(tab.value)
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
    recipes.value = null
    recipesLoading.value = false
    recipesError.value = null
    recipesGuard.cancel()
    examples.clear()
    // Keep the remembered tab (the tab watcher loads its data when it changes; otherwise the deferred load below does).
    tab.value = tabFor(props.item)
    if (scroller.value) scroller.value.scrollTop = 0
    tagsExpanded.value = false
    lightboxIndex.value = null
    examplesOpen.value = false
    shot.value = 0
    editing.value = null
    strength.value = loraStrengths(props.item.usage_tips).strength
    loadForItem(performance.now() - lastNavigateAt < ANNOUNCE_WINDOW_MS)
    if (performance.now() - lastNavigateAt < ANNOUNCE_WINDOW_MS) {
      announcement.value = t('detail.nav.announce', { name: displayName.value, position: positionText.value })
    }
  },
)

// Fewer examples after a refresh or a delete: keep the large one within range.
watch(
  () => images.value.length,
  (count) => {
    if (shot.value >= count) shot.value = 0
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

/** After a version file was deleted or restored elsewhere: re-read the versions (quietly when shown). */
async function reloadVersions(): Promise<void> {
  if (versionsLoaded.value && !versionsLoading.value) await loadVersions(true)
}

defineExpose({ refresh, reloadVersions })

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

// --- Inline edits (save-metadata stores these fields as given) -------------------

async function startEdit(field: 'name' | 'baseModel'): Promise<void> {
  editing.value = field
  draft.value = field === 'name' ? props.item.model_name || '' : props.item.base_model || ''
  await nextTick()
  document.getElementById(`drawer-edit-${field}`)?.focus()
}

async function finishEdit(): Promise<void> {
  const field = editing.value
  const value = draft.value.trim()
  if (!field) return
  const current = field === 'name' ? props.item.model_name : props.item.base_model
  if (!value || value === current) {
    editing.value = null
    return
  }
  savingField.value = true
  const saved = await save(field === 'name' ? { model_name: value } : { base_model: value })
  savingField.value = false
  if (saved) {
    editing.value = null
    toasts.success(t('common.saved'))
  }
}

async function saveTip(key: string, value: string | null): Promise<void> {
  savingField.value = true
  if (await save({ usage_tips: withUsageTip(parseUsageTips(props.item.usage_tips), key, value) }) && value !== null) {
    newTip.value = { ...newTip.value, value: '' }
  }
  savingField.value = false
}

/** Trigger words live in the Civitai part of the metadata (`civitai.trainedWords`), like the classic modal. */
async function addTriggerWord(): Promise<void> {
  const word = newWord.value.trim()
  if (!word || triggerWords.value.includes(word)) {
    newWord.value = ''
    return
  }
  const next = [...triggerWords.value, word]
  savingField.value = true
  try {
    await props.api.saveMetadata(props.item.file_path, { civitai: { trainedWords: next } })
    if (metadata.value) metadata.value = { ...metadata.value, trainedWords: next }
    emit('updated', { ...props.item, civitai: { ...props.item.civitai, trainedWords: next } })
    newWord.value = ''
  } catch (error) {
    toasts.error((error as Error).message)
  } finally {
    savingField.value = false
  }
}

async function calculateHash(): Promise<void> {
  hashing.value = true
  try {
    const result = await props.api.calculateHash(props.item.file_path)
    if (result.sha256) emit('updated', { ...props.item, sha256: result.sha256.toLowerCase() })
    toasts.success(t('detail.hashCalculated'))
  } catch (error) {
    toasts.error((error as Error).message)
  } finally {
    hashing.value = false
  }
}

async function openLocation(): Promise<void> {
  try {
    const result = await props.api.openLocation(props.item.file_path)
    if (result.mode === 'clipboard' && result.path) {
      const copied = await copyText(result.path)
      toasts.push(copied ? t('examples.pathCopied') : t('examples.pathIs', { path: result.path }))
    } else toasts.push(t('examples.folderOpened'))
  } catch (error) {
    toasts.error(t('examples.openFailed', { error: (error as Error).message }))
  }
}

/** Versions tab: stop (or resume) update tracking for this model. Local update database only. */
async function toggleIgnore(): Promise<void> {
  const id = modelId.value
  if (!id || !versions.value) return
  const ignore = !versions.value.shouldIgnore
  ignoring.value = true
  try {
    await updatesApi.ignoreModel(props.api.prefix, id, ignore)
    versions.value = { ...versions.value, shouldIgnore: ignore }
    toasts.success(t(ignore ? 'detail.updatesIgnored' : 'detail.updatesTracked'))
    void updatesSummary.refreshLikelyCounts({ force: true })
  } catch (error) {
    toasts.error((error as Error).message)
  } finally {
    ignoring.value = false
  }
}

/**
 * Queue a version next to this file: the same root and folder as the open
 * model (`destinationForFile`, like Update on the Updates page); the default
 * root + path template when the root cannot be determined.
 */
async function queueVersion(id: number): Promise<void> {
  // Replace or keep the owned versions of the same base model (asked before anything is queued).
  const target = versions.value?.versions.find((version) => version.versionId === id)
  const files = target ? ownedFilesForVersion(versions.value, target) : []
  const decision = await replaceChoice.ask({
    modelName: displayName.value,
    versionName: target?.name || t('updates.unknownVersion'),
    files,
  })
  if (!decision) return
  const replacePaths = decision.mode === 'replace' ? decision.paths : []
  try {
    if (roots.value === null) {
      try {
        roots.value = await props.api.roots()
      } catch {
        roots.value = []
      }
    }
    const destination = destinationForFile(props.item.file_path, roots.value)
    const result = await downloadsApi.add({
      modelId: modelId.value,
      versionId: id,
      destination: destination.params,
      replaceFilePaths: replacePaths.length ? replacePaths : undefined,
    })
    if (result.duplicate) toasts.push(replacePaths.length ? t('replace.notAttached') : t('detail.alreadyQueued'), replacePaths.length ? 'warning' : 'success')
    else {
      toasts.success(destination.known ? t('detail.queuedTo', { path: destination.display }) : t('detail.queuedDefault'))
      if (replacePaths.length && result.replace_attached) {
        toasts.push(
          t('replace.queuedReplace', {
            name: displayName.value,
            version: target?.name || '',
            file: replacePaths.map(fileNameOf).join(', '),
          }),
        )
      }
    }
  } catch (error) {
    toasts.error(queueErrorText(error))
  }
}

// --- Versions tab: local files and "Delete this version" -------------------------

/** Each version with its local files (scanner at read time; the old single `filePath` on older backends). */
const versionRows = computed(() => {
  const queue = queueSnapshot.value
  const all = versions.value?.versions ?? []
  const currentReleased = all.find((version) => version.versionId === versionId.value)?.releasedAt
  return all.map((version) => {
    const owned = isOwnedVersion(version)
    let files: VersionLocalFile[] = localFilesOf(version)
    if (!Array.isArray(version.localFiles) && owned && version.filePath) {
      files = [{ filePath: version.filePath, fileName: version.fileName || fileNameOf(version.filePath), folder: '' }]
    }
    return { version, owned, files, flags: versionFlags(version, currentReleased), downloading: isVersionDownloading(version.versionId, queue) }
  })
})

/**
 * The page runs the delete (same flow as the card delete: confirm, staged
 * delete, Undo). `isCurrent`: the drawer shows this file; `siblingPath` is
 * another owned file of this model to switch to afterwards (same version
 * first, then the newest owned version of the same base), or null.
 */
function requestDeleteFile(version: ModelVersionInfo, file: VersionLocalFile): void {
  const isCurrent = sameFilePath(file.filePath, props.item.file_path)
  let sibling: string | null = null
  if (isCurrent) {
    const sameVersion = versionRows.value
      .find((row) => row.version.versionId === version.versionId)
      ?.files.find((entry) => !sameFilePath(entry.filePath, file.filePath))
    sibling = sameVersion?.filePath ?? ownedFilesForVersion(versions.value, version)[0]?.filePath ?? null
  }
  emit('delete-file', {
    file: {
      filePath: file.filePath,
      fileName: fileNameOf(file.filePath),
      folder: file.folder ?? '',
      sizeBytes: file.sizeBytes ?? null,
      versionName: version.name ?? null,
    },
    isCurrent,
    siblingPath: sibling,
  })
}

const sameFilePath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

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

/** The strength field, or the usage-tip strength while the field is empty or invalid (what Send and Copy use). */
const effectiveStrength = computed(() => {
  const value = strength.value
  return typeof value === 'number' && Number.isFinite(value) ? value : loraStrengths(props.item.usage_tips).strength
})
const strengthText = computed(() => formatStrength(effectiveStrength.value))

function sendOptions(mode: SendMode) {
  return { mode, strength: effectiveStrength.value, trainedWords: triggerWords.value }
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
 * this: Escape, a click outside, the Close button, filtering by a tag (the library closes the
 * drawer for that) and opening a recipe. Switching to another model through the `item` prop
 * resets the draft without asking (the watcher above), like the tag list.
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

async function openRecipe(id: string): Promise<void> {
  if (await confirmLeave()) void router.push({ path: '/recipes', query: { open: id } })
}

// --- Sheet events -------------------------------------------------------------------

function onOpenAutoFocus(event: Event): void {
  event.preventDefault()
  closeButton.value?.focus()
}

/** Escape cancels an inline edit first; otherwise it closes (asking about unsaved notes). */
function onEscape(event: KeyboardEvent): void {
  event.preventDefault()
  if (editing.value) editing.value = null
  else void requestClose()
}

/** Toast actions (Undo) sit outside the sheet: using them must not close it. */
function onInteractOutside(event: CustomEvent<{ originalEvent: Event }>): void {
  const target = event.detail.originalEvent.target as Element | null
  if (target?.closest?.('[data-toast-host]')) event.preventDefault()
}

/** Model navigation keys inside the sheet (layers opened above it are portaled and never reach this). */
function onKey(event: KeyboardEvent): void {
  const context = { topmost: true, dialogOpen: false, menuOpen: !!menu.value }
  // Delete (outside text fields): the header's Delete, with its confirm and Undo.
  if (shouldHandleDeleteKey(event, context)) {
    event.preventDefault()
    emit('action', 'delete')
    return
  }
  const direction = shouldHandleNavKey(event, context)
  if (!direction) return
  event.preventDefault()
  void requestNavigate(direction)
}

void loadMetadata()
loadTabData(tab.value)
</script>

<template>
  <Sheet :open="true" @update:open="(open) => open || requestClose()">
    <SheetContent
      side="right"
      aria-modal="true"
      aria-labelledby="drawer-title"
      :aria-describedby="undefined"
      data-testid="model-drawer"
      @open-auto-focus="onOpenAutoFocus"
      @escape-key-down="onEscape"
      @interact-outside="onInteractOutside"
    >
      <div class="flex min-h-0 flex-1 flex-col" @keydown="onKey">
        <!-- Header: name, position + prev/next, close; then the actions; then the tags. Never re-mounted by a tab change. -->
        <header class="flex flex-none flex-col gap-3 hairline-b border-border px-5 pt-4 pb-3 phone:px-4 phone:pt-2" data-testid="drawer-header">
          <div class="flex min-w-0 items-center gap-2">
            <form v-if="editing === 'name'" class="flex min-w-0 flex-1 items-center gap-1" @submit.prevent="finishEdit">
              <label class="sr-only" for="drawer-edit-name">{{ t('detail.editName') }}</label>
              <input id="drawer-edit-name" v-model="draft" class="lm-input text-lg" :class="touchHit" :disabled="savingField" />
              <button type="submit" :class="[miniButton, touchIcon]" :aria-label="t('common.save')" :disabled="savingField"><AppIcon name="check" :size="16" /></button>
              <button type="button" :class="[miniButton, touchIcon]" :aria-label="t('common.cancel')" @click="editing = null"><AppIcon name="close" :size="16" /></button>
            </form>
            <template v-else>
              <SheetTitle as-child class="min-w-0 truncate text-xl phone:text-lg">
                <h2 id="drawer-title" :title="displayName">{{ displayName }}</h2>
              </SheetTitle>
              <button
                type="button"
                :class="[miniButton, touchIcon]"
                :aria-label="t('detail.editName')"
                :title="t('detail.editName')"
                @click="startEdit('name')"
              >
                <AppIcon name="pencil" :size="14" />
              </button>
            </template>
            <span class="flex-1"></span>
            <div v-if="nav" class="flex flex-none items-center" role="group" :aria-label="t('detail.nav.group')">
              <button
                ref="prevButton"
                type="button"
                class="lm-btn lm-btn--ghost lm-btn--icon"
                :class="touchIcon"
                :aria-label="t('detail.nav.prev')"
                :title="t('detail.nav.prevHint')"
                :aria-keyshortcuts="SHORTCUTS.prev.aria"
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
                :aria-keyshortcuts="SHORTCUTS.next.aria"
                :disabled="!nav.hasNext"
                @click="requestNavigate('next')"
              >
                <AppIcon name="chevronRight" />
              </button>
            </div>
            <button
              ref="closeButton"
              type="button"
              class="lm-btn lm-btn--ghost lm-btn--icon flex-none"
              :class="touchIcon"
              :aria-label="t('common.close')"
              @click="requestClose"
            >
              <AppIcon name="close" />
            </button>
            <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="canSend"
              type="button"
              class="lm-btn lm-btn--primary"
              :class="touchHit"
              :disabled="sending"
              :aria-label="t('send.withStrength', { strength: strengthText })"
              @click="sendToComfy('append')"
            >
              <AppIcon name="send" :size="16" />{{ t('detail.sendAppend') }}<span class="tabular-nums" aria-hidden="true">{{ strengthText }}</span>
            </button>
            <a v-if="civitaiUrl" class="lm-btn" :class="touchHit" :href="civitaiUrl" target="_blank" rel="noopener noreferrer">
              <AppIcon name="external" :size="16" />{{ t('detail.civitai') }}
            </a>
            <span v-if="creator" class="lm-chip" :title="t('detail.creator')">{{ creator }}</span>
            <button
              v-if="item.update_available"
              type="button"
              class="lm-badge lm-badge--warning cursor-pointer hover:opacity-80 touch:min-h-touch touch:px-3"
              :aria-label="t('detail.showUpdates')"
              :title="t('library.updatesFlagHint')"
              data-testid="update-flag"
              @click="tab = 'versions'"
            >
              {{ t('card.update') }}
            </button>
            <ul v-if="licence.length" class="ml-auto flex flex-wrap gap-1" :aria-label="t('detail.licence.label')">
              <li
                v-for="entry in licence"
                :key="entry.key"
                class="lm-badge"
                :class="!entry.allowed && 'line-through'"
                :title="t(`detail.licence.${entry.key}.${entry.allowed ? 'yes' : 'no'}` as MessageKey)"
              >
                {{ t(`detail.licence.${entry.key}` as MessageKey) }}
                <span class="sr-only">{{ t(`detail.licence.${entry.key}.${entry.allowed ? 'yes' : 'no'}` as MessageKey) }}</span>
              </li>
            </ul>
            <div class="flex items-center gap-1" :class="!licence.length && 'ml-auto'">
              <button
                type="button"
                class="lm-btn lm-btn--ghost lm-btn--icon"
                :class="[touchIcon, { 'text-accent': item.favorite }]"
                :aria-label="t('detail.toggleFavorite')"
                :aria-pressed="!!item.favorite"
                @click="toggleFavorite"
              >
                <AppIcon name="star" :filled="!!item.favorite" />
              </button>
              <button
                type="button"
                class="lm-btn lm-btn--ghost lm-btn--icon"
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
                type="button"
                class="lm-btn lm-btn--ghost lm-btn--icon hover:text-danger"
                :class="touchIcon"
                :aria-label="t('detail.deleteModel')"
                :title="t('detail.deleteModel')"
                :aria-keyshortcuts="SHORTCUTS.detailsDelete.aria"
                @click="emit('action', 'delete')"
              >
                <AppIcon name="trash" />
              </button>
            </div>
          </div>

          <!-- Tags: uniform neutral pills; click filters the library, x removes. -->
          <div class="flex flex-wrap items-center gap-2">
            <ul v-if="tags.length" class="flex flex-wrap items-center gap-1 phone:gap-y-4 touch:gap-y-4" :aria-label="t('detail.tags')">
              <li
                v-for="tag in shownTags.visible"
                :key="tag"
                class="inline-flex h-[26px] max-w-full items-center rounded-sm hairline border-border bg-sunken text-xs text-fg"
              >
                <button
                  type="button"
                  class="h-full min-w-0 cursor-pointer truncate rounded-l-sm pr-1 pl-2 hover:text-accent phone:h-touch phone:min-w-touch phone:pr-3 touch:h-touch touch:min-w-touch touch:pr-3"
                  :title="t('detail.filterByTag', { tag })"
                  @click="filterTag(tag)"
                >
                  {{ tag }}
                </button>
                <button
                  type="button"
                  class="inline-grid h-full w-[24px] flex-none cursor-pointer place-items-center rounded-r-sm text-muted hover:text-danger phone:-mx-[10px] phone:h-touch phone:w-touch touch:-mx-[10px] touch:h-touch touch:w-touch"
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
                  class="inline-flex h-[26px] cursor-pointer items-center rounded-sm px-2 text-xs font-medium text-accent hover:bg-accent-soft phone:h-touch touch:h-touch"
                  :aria-expanded="tagsExpanded"
                  @click="tagsExpanded = !tagsExpanded"
                >
                  {{ tagsExpanded ? t('detail.lessTags') : t('detail.moreTags', { count: shownTags.hiddenCount }) }}
                </button>
              </li>
            </ul>
            <span v-else class="text-sm text-muted">{{ t('detail.noTags') }}</span>
            <form class="flex w-[13rem] gap-1" @submit.prevent="addTag">
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
        </header>

        <div class="grid min-h-0 flex-1 grid-cols-[26rem_minmax(0,1fr)] tablet:block tablet:overflow-y-auto">
          <!-- Info column: own scroll, untouched by tab and thumbnail changes. -->
          <div
            class="flex min-h-0 flex-col gap-6 overflow-y-auto hairline-r border-border p-5 tablet:overflow-visible tablet:border-r-0 tablet:hairline-b phone:px-4"
            data-testid="drawer-info"
          >
            <!-- Send to ComfyUI (LoRAs): strength for the header Send, Replace and Copy syntax. -->
            <section v-if="canSend" class="flex flex-wrap items-end gap-2 rounded-md bg-sunken p-3" :aria-label="t('detail.sendAppend')">
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
            </section>

            <section>
              <h3 :class="blockTitleClass">{{ t('detail.info') }}</h3>
              <dl>
                <div v-if="item.civitai?.name" :class="fieldClass"><dt>{{ t('detail.version') }}</dt><dd :class="valueClass">{{ item.civitai.name }}</dd></div>
                <div :class="fieldClass">
                  <dt>{{ t('detail.fileName') }}</dt>
                  <dd :class="valueClass">
                    <span class="lm-mono min-w-0 flex-1">{{ item.file_name }}</span>
                    <button
                      type="button"
                      :class="[miniButton, touchIcon]"
                      :aria-label="t('actions.rename')"
                      :title="t('actions.rename')"
                      @click="emit('action', 'rename')"
                    >
                      <AppIcon name="pencil" :size="14" />
                    </button>
                  </dd>
                </div>
                <div :class="fieldClass">
                  <dt>{{ t('detail.location') }}</dt>
                  <dd :class="valueClass">
                    <span class="min-w-0 flex-1">{{ item.folder || '/' }}</span>
                    <button type="button" :class="[miniButton, touchIcon]" :aria-label="t('detail.openLocation')" :title="t('detail.openLocation')" @click="openLocation">
                      <AppIcon name="folder" :size="14" />
                    </button>
                  </dd>
                </div>
                <div :class="fieldClass">
                  <dt>{{ t('detail.filePath') }}</dt>
                  <dd :class="valueClass">
                    <span class="lm-mono min-w-0 flex-1 text-xs" data-testid="drawer-path">{{ item.file_path }}</span>
                    <button type="button" :class="[miniButton, touchIcon]" :aria-label="t('detail.copyPath')" :title="t('detail.copyPath')" @click="copy(item.file_path)">
                      <AppIcon name="copy" :size="14" />
                    </button>
                  </dd>
                </div>
                <div :class="fieldClass">
                  <dt>{{ t('detail.baseModel') }}</dt>
                  <dd v-if="editing === 'baseModel'">
                    <form class="flex items-center gap-1" @submit.prevent="finishEdit">
                      <label class="sr-only" for="drawer-edit-baseModel">{{ t('detail.editBaseModel') }}</label>
                      <input id="drawer-edit-baseModel" v-model="draft" class="lm-input min-h-control-sm text-sm" :disabled="savingField" />
                      <button type="submit" :class="[miniButton, touchIcon]" :aria-label="t('common.save')" :disabled="savingField"><AppIcon name="check" :size="14" /></button>
                      <button type="button" :class="[miniButton, touchIcon]" :aria-label="t('common.cancel')" @click="editing = null"><AppIcon name="close" :size="14" /></button>
                    </form>
                  </dd>
                  <dd v-else :class="valueClass">
                    <span class="min-w-0 flex-1">{{ item.base_model || '-' }}</span>
                    <button
                      type="button"
                      :class="[miniButton, touchIcon]"
                      :aria-label="t('detail.editBaseModel')"
                      :title="t('detail.editBaseModel')"
                      @click="startEdit('baseModel')"
                    >
                      <AppIcon name="pencil" :size="14" />
                    </button>
                  </dd>
                </div>
                <div v-if="item.sub_type" :class="fieldClass"><dt>{{ t('detail.subType') }}</dt><dd :class="valueClass">{{ item.sub_type }}</dd></div>
                <div :class="fieldClass">
                  <dt>{{ t('detail.size') }}</dt>
                  <dd :class="[valueClass, 'tabular-nums']">{{ formatBytes(item.file_size) }}<template v-if="fileType"> · {{ fileType }}</template></dd>
                </div>
                <div :class="fieldClass"><dt>{{ t('detail.modified') }}</dt><dd :class="valueClass">{{ formatDate(item.modified) }}</dd></div>
                <div :class="fieldClass"><dt>{{ t('detail.usage') }}</dt><dd :class="[valueClass, 'tabular-nums']">{{ item.usage_count ?? 0 }}</dd></div>
              </dl>
            </section>

            <section>
              <h3 :class="blockTitleClass">{{ t('detail.hashes') }}</h3>
              <p v-if="!item.sha256" class="flex flex-wrap items-center gap-2 rounded-md hairline border-border px-3 py-2 text-sm text-muted">
                {{ t('detail.noHash') }}
                <button type="button" class="lm-btn lm-btn--sm" :class="touchHit" :disabled="hashing" :aria-busy="hashing" @click="calculateHash">
                  {{ hashing ? t('detail.calculatingHash') : t('detail.calculateHash') }}
                </button>
              </p>
              <dl>
                <div v-if="item.sha256" :class="fieldClass">
                  <dt>{{ t('detail.hash') }}</dt>
                  <dd :class="valueClass">
                    <span class="lm-mono min-w-0 flex-1" :title="item.sha256">{{ shortHash(item.sha256) }}</span>
                    <button type="button" :class="[miniButton, touchIcon]" :aria-label="t('detail.copyHash')" :title="t('detail.copyHash')" @click="copy(item.sha256!)">
                      <AppIcon name="copy" :size="14" />
                    </button>
                  </dd>
                </div>
                <div v-if="modelId" :class="fieldClass">
                  <dt>{{ t('detail.modelId') }}</dt>
                  <dd :class="valueClass">
                    <span class="lm-mono min-w-0 flex-1">{{ modelId }}</span>
                    <button type="button" :class="[miniButton, touchIcon]" :aria-label="t('detail.copyModelId')" :title="t('detail.copyModelId')" @click="copy(String(modelId))">
                      <AppIcon name="copy" :size="14" />
                    </button>
                  </dd>
                </div>
                <div v-if="versionId" :class="fieldClass">
                  <dt>{{ t('detail.versionId') }}</dt>
                  <dd :class="valueClass">
                    <span class="lm-mono min-w-0 flex-1">{{ versionId }}</span>
                    <button type="button" :class="[miniButton, touchIcon]" :aria-label="t('detail.copyVersionId')" :title="t('detail.copyVersionId')" @click="copy(String(versionId))">
                      <AppIcon name="copy" :size="14" />
                    </button>
                  </dd>
                </div>
              </dl>
            </section>

            <!-- Usage tips (LoRAs): a strength chip sets the Send strength; x removes; the form adds a preset. -->
            <section v-if="isLora">
              <h3 :class="blockTitleClass">{{ t('detail.usageTips') }}</h3>
              <ul v-if="tipEntries.length" :class="chipsClass" :aria-label="t('detail.usageTips')">
                <li v-for="entry in tipEntries" :key="entry.key" class="lm-chip pr-[2px] tabular-nums">
                  <button
                    v-if="entry.strength !== null && canSend"
                    type="button"
                    class="cursor-pointer hover:text-accent"
                    :class="touchHit"
                    :title="t('detail.useStrength', { value: entry.strength })"
                    @click="strength = entry.strength"
                  >
                    {{ entry.text }}
                  </button>
                  <span v-else>{{ entry.text }}</span>
                  <button
                    type="button"
                    class="inline-grid size-[20px] cursor-pointer place-items-center rounded-pill text-muted hover:text-danger"
                    :class="touchIcon"
                    :aria-label="t('detail.removeTip', { tip: entry.text })"
                    :disabled="savingField"
                    @click="saveTip(entry.key, null)"
                  >
                    <AppIcon name="close" :size="12" />
                  </button>
                </li>
              </ul>
              <form class="mt-2 flex gap-1" @submit.prevent="saveTip(newTip.key, newTip.value)">
                <label class="sr-only" for="drawer-tip-key">{{ t('detail.tipKey') }}</label>
                <select id="drawer-tip-key" v-model="newTip.key" class="lm-select min-h-control-sm min-w-0 flex-1 text-xs" :class="touchHit">
                  <option v-for="key in USAGE_TIP_KEYS" :key="key" :value="key">{{ t(`detail.tip.${key}` as MessageKey) }}</option>
                </select>
                <label class="sr-only" for="drawer-tip-value">{{ t('detail.tipValue') }}</label>
                <input
                  id="drawer-tip-value"
                  v-model="newTip.value"
                  class="lm-input min-h-control-sm w-[5rem] text-xs tabular-nums"
                  :class="touchHit"
                  :placeholder="t('detail.tipValue')"
                />
                <button type="submit" class="lm-btn lm-btn--sm" :class="touchHit" :disabled="savingField || !newTip.value.trim()">{{ t('detail.add') }}</button>
              </form>
            </section>

            <section v-if="canSend || triggerWords.length || metaError || isLora">
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
              <p v-else class="text-sm text-muted">{{ t('detail.noTriggerWords') }}</p>
              <p v-if="metaError" class="lm-error-text">{{ metaError }}</p>
              <form class="mt-2 flex gap-1" @submit.prevent="addTriggerWord">
                <label class="sr-only" for="drawer-new-word">{{ t('detail.addTriggerWord') }}</label>
                <input
                  id="drawer-new-word"
                  v-model="newWord"
                  class="lm-input min-h-control-sm flex-1 text-xs"
                  :class="touchHit"
                  :placeholder="t('detail.addTriggerWord')"
                  :disabled="savingField || metaLoading"
                />
                <button type="submit" class="lm-btn lm-btn--sm" :class="touchHit" :disabled="savingField || metaLoading || !newWord.trim()">{{ t('detail.add') }}</button>
              </form>
            </section>

            <section>
              <label class="lm-label" for="drawer-notes"><h3 :class="blockTitleClass">{{ t('detail.notes') }}</h3></label>
              <textarea id="drawer-notes" ref="notesField" v-model="notes" class="lm-textarea" :placeholder="t('detail.notesPlaceholder')"></textarea>
              <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
                <span class="mr-auto text-xs text-muted" aria-live="polite">{{ notesDirty ? t('detail.unsavedNotes') : '' }}</span>
                <button type="button" class="lm-btn lm-btn--primary" :class="touchHit" :disabled="!notesDirty || savingNotes" @click="saveNotes">
                  {{ t('common.save') }}
                </button>
              </div>
            </section>

            <section v-if="modelDescription && versionDescription">
              <h3 :class="blockTitleClass">{{ t('detail.aboutVersion') }}</h3>
              <!-- eslint-disable-next-line vue/no-v-html -- sanitized with an allow-list -->
              <div class="lm-prose text-sm" v-html="versionDescription"></div>
            </section>
          </div>

          <!-- Right pane: the tab list and the panels. Only this part changes with a tab or thumbnail. -->
          <div class="flex min-h-0 min-w-0 flex-col">
            <div class="flex flex-none gap-1 overflow-x-auto hairline-b border-border px-5 phone:px-3" role="tablist" :aria-label="t('detail.tabsLabel')">
              <button
                v-for="(entry, index) in tabs"
                :id="`tab-${entry}`"
                :key="entry"
                type="button"
                role="tab"
                class="-mb-px inline-flex cursor-pointer items-center gap-2 border-b-2 px-3 py-3 font-medium whitespace-nowrap phone:min-h-touch touch:min-h-touch"
                :class="tab === entry ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'"
                :aria-selected="tab === entry"
                :aria-controls="`panel-${entry}`"
                :tabindex="tab === entry ? 0 : -1"
                @click="selectTab(entry)"
                @keydown="onTabKey($event, index)"
              >
                {{ t(TAB_LABELS[entry]) }}
                <span v-if="entry === 'versions' && item.update_available" class="lm-badge lm-badge--accent">{{ t('card.update') }}</span>
              </button>
            </div>

            <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto p-5 tablet:overflow-visible phone:px-4" data-testid="drawer-pane">
              <!-- Examples: one large image, the thumbnails select it; the generation data of the shown image below. -->
              <section v-show="tab === 'examples'" id="panel-examples" role="tabpanel" aria-labelledby="tab-examples" class="flex flex-col gap-4">
                <div class="flex items-center gap-2">
                  <h3 class="lm-overline flex items-center gap-2">
                    {{ t('detail.examples') }}
                    <span v-if="images.length" class="tabular-nums">{{ images.length }}</span>
                    <span v-if="localImages" class="lm-badge lm-badge--success normal-case">{{ t('examples.localCount', { count: localImages }) }}</span>
                  </h3>
                  <button type="button" class="lm-btn lm-btn--sm lm-btn--ghost ml-auto" :class="touchHit" :disabled="metaLoading" @click="examplesOpen = true">
                    <AppIcon name="image" :size="14" />{{ t('examples.manage') }}
                  </button>
                </div>

                <div v-if="metaLoading" class="lm-skeleton h-[min(30rem,60vw)] rounded-md"></div>
                <button
                  v-else-if="stageImage"
                  type="button"
                  class="flex cursor-zoom-in items-center justify-center overflow-hidden rounded-md hairline border-border bg-sunken"
                  :aria-label="t('detail.openExample', { index: shot + 1, count: images.length })"
                  data-testid="drawer-stage"
                  @click="openLightbox(shot, $event)"
                >
                  <LazyMedia
                    :key="stageImage.url"
                    class="h-[min(30rem,60vw)] w-full"
                    :media-class="['size-full object-contain', isBlurred(stageImage.nsfwLevel, blurMature) && blurClass]"
                    :src="stageImage.url"
                    :kind="isVideo(stageImage) ? 'video' : 'image'"
                    loading="eager"
                    autoplay
                    loop
                    retry
                  />
                </button>
                <div v-else-if="previewUrl" class="flex items-center justify-center overflow-hidden rounded-md hairline border-border bg-sunken">
                  <!-- Fixed-height box: the cover never shifts the layout while it loads. -->
                  <LazyMedia
                    class="h-[min(30rem,60vw)] w-full"
                    :media-class="['size-full object-contain', coverBlurred && blurClass]"
                    :src="previewUrl"
                    loading="eager"
                    fetchpriority="high"
                    autoplay
                    loop
                    retry
                  />
                </div>

                <div v-if="metaLoading" class="flex gap-2 overflow-hidden">
                  <div v-for="n in 6" :key="n" class="lm-skeleton size-[4.5rem] flex-none rounded-sm"></div>
                </div>
                <div v-else-if="images.length > 1" class="flex gap-2 overflow-x-auto pb-1" role="group" :aria-label="t('detail.examples')">
                  <button
                    v-for="(image, index) in images"
                    :key="`${index}-${image.url}`"
                    type="button"
                    class="relative size-[4.5rem] flex-none cursor-pointer overflow-hidden rounded-sm hairline bg-sunken"
                    :class="index === shot ? 'border-accent ring-2 ring-accent' : 'border-border opacity-75 hover:opacity-100'"
                    :aria-label="t('detail.showExample', { index: index + 1, count: images.length })"
                    :aria-pressed="index === shot"
                    :title="imageHints[index] || undefined"
                    data-testid="drawer-thumb"
                    @click="shot = index"
                  >
                    <LazyMedia
                      class="size-full"
                      :media-class="['size-full object-cover', isBlurred(image.nsfwLevel, blurMature) && blurClass]"
                      :src="image.url"
                      :kind="isVideo(image) ? 'video' : 'image'"
                      :icon-size="20"
                    />
                    <span v-if="isVideo(image)" class="absolute inset-0 grid place-items-center text-on-scrim" aria-hidden="true">
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
                </div>
                <p v-if="!metaLoading && !images.length && item.from_civitai" class="text-xs text-muted">{{ t('detail.noExamples') }}</p>

                <div v-if="stageImage && !metaLoading" class="flex flex-col gap-4 rounded-md hairline border-border bg-surface p-4">
                  <GenerationDetails :view="stageView">
                    <template #empty>
                      <p class="text-sm text-muted">{{ t('generation.none') }}</p>
                    </template>
                  </GenerationDetails>
                </div>
              </section>

              <!-- Description -->
              <section v-show="tab === 'description'" id="panel-description" role="tabpanel" aria-labelledby="tab-description">
                <StateBlock v-if="metaLoading" kind="loading" />
                <!-- eslint-disable-next-line vue/no-v-html -- sanitized with an allow-list -->
                <div v-else-if="description" class="lm-prose max-w-[62ch]" v-html="description"></div>
                <StateBlock v-else kind="empty" :title="t('detail.noDescription')" />
              </section>

              <!-- Versions -->
              <section v-show="tab === 'versions'" id="panel-versions" role="tabpanel" aria-labelledby="tab-versions" class="flex flex-col gap-3">
                <StateBlock v-if="versionsLoading" kind="loading" />
                <StateBlock v-else-if="versionsError" kind="error" :message="versionsError" @retry="loadVersions" />
                <StateBlock v-else-if="!versions?.versions?.length" kind="empty" :title="t('detail.noVersions')" />
                <template v-else>
                  <div class="flex flex-wrap items-center justify-between gap-2 rounded-md hairline border-border px-3 py-2 text-sm text-muted">
                    <span>{{ versions.shouldIgnore ? t('detail.updatesOff') : t('detail.updatesOn') }}</span>
                    <button type="button" class="lm-btn lm-btn--sm" :class="touchHit" :disabled="ignoring" data-testid="ignore-updates" @click="toggleIgnore">
                      {{ versions.shouldIgnore ? t('detail.trackUpdates') : t('detail.ignoreUpdates') }}
                    </button>
                  </div>
                  <ul class="flex flex-col gap-2">
                    <li
                      v-for="row in versionRows"
                      :key="row.version.versionId"
                      class="flex items-center gap-3 rounded-md hairline bg-surface p-2 phone:flex-wrap"
                      :class="row.version.versionId === versionId ? 'border-accent' : 'border-border'"
                      :aria-current="row.version.versionId === versionId ? 'true' : undefined"
                      :data-testid="`version-${row.version.versionId}`"
                    >
                      <LazyMedia
                        class="lm-thumb h-[72px] w-[56px]"
                        media-class="size-full object-cover"
                        :src="row.version.previewUrl ? withMountPrefix(row.version.previewUrl) : ''"
                        :icon-size="18"
                      />
                      <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
                        <strong class="wrap-anywhere">{{ row.version.name }}</strong>
                        <div class="flex flex-wrap gap-2 text-xs text-muted">
                          <span v-if="row.version.baseModel">{{ row.version.baseModel }}</span>
                          <span v-if="row.version.releasedAt">{{ formatDate(row.version.releasedAt) }}</span>
                          <span v-if="row.version.sizeBytes">{{ formatBytes(row.version.sizeBytes) }}</span>
                        </div>
                        <div class="flex flex-wrap gap-1">
                          <span v-if="row.version.versionId === versionId" class="lm-badge lm-badge--accent">{{ t('detail.current') }}</span>
                          <span v-if="row.owned" class="lm-badge lm-badge--success">{{ t('detail.inLibrary') }}</span>
                          <span v-else-if="row.version.hasBeenDownloaded" class="lm-badge">{{ t('detail.downloaded') }}</span>
                          <span v-if="!row.owned && row.flags.newer" class="lm-badge lm-badge--accent">{{ t('detail.newer') }}</span>
                          <span v-if="row.version.isEarlyAccess" class="lm-badge lm-badge--warning">{{ t('detail.earlyAccess') }}</span>
                          <span v-if="row.flags.paid" class="lm-badge lm-badge--warning">{{ t('detail.paid') }}</span>
                          <span v-if="row.flags.freeNow" class="lm-badge">{{ t('detail.freeNow') }}</span>
                          <span
                            v-if="!row.owned && classificationChip(row.version.versionId)"
                            class="lm-badge"
                            :class="classificationChip(row.version.versionId)!.tone"
                            :title="t('detail.updateChipHint')"
                            data-testid="update-chip"
                          >{{ classificationChip(row.version.versionId)!.label }}</span>
                        </div>
                        <!-- Which local file(s) this version is; several files (variants) each get their own Delete. -->
                        <ul v-if="row.files.length" class="mt-1 flex flex-col gap-1" :aria-label="t('detail.inLibrary')">
                          <li v-for="file in row.files" :key="file.filePath" class="flex flex-wrap items-center gap-x-2 text-xs text-muted" data-testid="local-file">
                            <span class="min-w-0 wrap-anywhere" :title="file.filePath">
                              {{ t('versions.inLibraryAs', { file: fileNameOf(file.filePath) }) }}
                              {{ t('versions.inFolder', { folder: file.folder || t('versions.rootFolder') }) }}<template v-if="file.sizeBytes"> · {{ formatBytes(file.sizeBytes) }}</template>
                            </span>
                            <button
                              v-if="row.files.length > 1 && !row.downloading"
                              type="button"
                              class="lm-btn lm-btn--ghost lm-btn--sm text-danger"
                              :class="touchHit"
                              :aria-label="t('versions.deleteFileLabel', { version: row.version.name || '', file: fileNameOf(file.filePath) })"
                              data-testid="delete-file"
                              @click="requestDeleteFile(row.version, file)"
                            >
                              <AppIcon name="trash" :size="14" />{{ t('versions.deleteFile') }}
                            </button>
                          </li>
                        </ul>
                        <p v-if="row.owned && row.downloading" class="text-xs text-muted">{{ t('versions.downloadingNoDelete') }}</p>
                      </div>
                      <!-- Fixed-width actions column so every row lines up: Queue download for versions you do not
                           have, Delete for a version you own as one file (several files: Delete per file above). -->
                      <div class="flex w-[168px] flex-none items-center justify-end gap-1 phone:w-full">
                        <a
                          v-if="versionUrl(row.version.versionId)"
                          :class="[miniButton, touchIcon]"
                          :href="versionUrl(row.version.versionId)"
                          target="_blank"
                          rel="noopener noreferrer"
                          :aria-label="t('versions.openOnCivitai', { version: row.version.name || '' })"
                          :title="t('detail.civitai')"
                          data-testid="version-civitai"
                        >
                          <AppIcon name="external" :size="14" />
                        </a>
                        <button
                          v-if="row.owned && row.files.length === 1 && !row.downloading"
                          type="button"
                          class="lm-btn lm-btn--sm text-danger"
                          :class="touchHit"
                          :aria-label="t('versions.deleteFileLabel', { version: row.version.name || '', file: fileNameOf(row.files[0].filePath) })"
                          data-testid="delete-version"
                          @click="requestDeleteFile(row.version, row.files[0])"
                        >
                          <AppIcon name="trash" :size="14" />{{ t('versions.deleteFile') }}
                        </button>
                        <template v-if="!row.owned">
                          <button type="button" class="lm-btn lm-btn--sm" :class="touchHit" @click="queueVersion(row.version.versionId)">
                            <AppIcon name="download" :size="14" />{{ t('detail.queueVersion') }}
                          </button>
                          <button
                            type="button"
                            class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm"
                            :class="touchIcon"
                            :aria-label="t('download.fromVersion')"
                            :title="t('download.title')"
                            @click="emit('download', `https://civitai.com/models/${modelId}?modelVersionId=${row.version.versionId}`)"
                          >
                            <AppIcon name="folder" :size="14" />
                          </button>
                        </template>
                      </div>
                    </li>
                  </ul>
                </template>
              </section>

              <!-- Recipes (LoRAs): recipes that use this file; a recipe opens on the Recipes page. -->
              <section v-if="isLora" v-show="tab === 'recipes'" id="panel-recipes" role="tabpanel" aria-labelledby="tab-recipes">
                <StateBlock v-if="recipesLoading" kind="loading" />
                <StateBlock v-else-if="recipesError" kind="error" :message="recipesError" @retry="loadRecipes" />
                <StateBlock v-else-if="!item.sha256" kind="empty" :title="t('detail.recipesNoHash')" />
                <StateBlock v-else-if="!recipes?.length" kind="empty" :title="t('detail.noRecipes')" />
                <ul v-else class="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
                  <li v-for="recipe in recipes" :key="recipe.id">
                    <a
                      class="flex flex-col gap-1 rounded-md text-fg no-underline hover:no-underline"
                      :href="router.resolve({ path: '/recipes', query: { open: recipe.id } }).href"
                      data-testid="drawer-recipe"
                      @click.prevent="openRecipe(recipe.id)"
                    >
                      <LazyMedia
                        class="aspect-[3/4] w-full overflow-hidden rounded-md hairline border-border bg-sunken"
                        :media-class="['size-full object-cover', isBlurred(recipe.preview_nsfw_level, blurMature) && blurClass]"
                        :src="recipe.file_url ? withMountPrefix(recipe.file_url) : ''"
                        :icon-size="20"
                      />
                      <span class="truncate text-sm font-medium">{{ recipe.title || recipe.id }}</span>
                      <span class="text-xs text-muted">
                        {{ t('recipes.loras', { count: recipe.loras?.length ?? 0 }) }}<template v-if="recipe.base_model"> · {{ recipe.base_model }}</template>
                      </span>
                    </a>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>

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
</template>
