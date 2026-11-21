<script setup lang="ts">
/**
 * Settings: every section of the classic settings modal, driven by
 * config/settingsSchema.ts and grouped into tabs and cards by
 * config/settingsTabs.ts (presentation only; the model, validation and save
 * flow are useSettingsForm / utils/settingsModel.ts).
 *
 * - Tabs: WAI-ARIA tab list, the active tab is in the URL
 *   (/settings/<tab>, reload-safe, deep-linkable) and remembered in
 *   localStorage; legacy `#set-<section>` / `#field-<key>` links still work.
 * - Search: one box searches every tab; results are grouped by tab, tabs show
 *   their number of matches, picking a result opens its tab and highlights it.
 * - Changes: per-tab unsaved counts, a sticky save bar (N unsaved changes,
 *   Discard, Save) that only appears with unsaved edits, per-field "Reset"
 *   when a value differs from its default and "Reset tab to defaults…" with
 *   a confirm that lists what changes. Nothing is stored before Save.
 * - Unsaved-changes guard on route leave and tab close.
 */
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useEventListener, useLocalStorage, useMediaQuery, useTimeoutFn } from '@vueuse/core'
import AppIcon from '@/components/AppIcon.vue'
import ThemeOptions from '@/components/ThemeOptions.vue'
import AboutPanel from '@/components/settings/AboutPanel.vue'
import BackupsPanel from '@/components/settings/BackupsPanel.vue'
import ExampleImagesPanel from '@/components/settings/ExampleImagesPanel.vue'
import MetadataArchivePanel from '@/components/settings/MetadataArchivePanel.vue'
import SettingsField from '@/components/settings/SettingsField.vue'
import SettingsTabList from '@/components/settings/SettingsTabList.vue'
import { createModelApi } from '@/api/endpoints'
import { systemApi } from '@/api/maintenance'
import { ALL_FIELDS, LLM_PRESETS, SETTINGS_SECTIONS } from '@/config/settingsSchema'
import { DEFAULT_SETTINGS_TAB, SETTINGS_TAB_STORAGE_KEY, SETTINGS_TABS } from '@/config/settingsTabs'
import { useConfirm, useToasts, copyText } from '@/composables/useFeedback'
import { confirmLeave, useSettingsForm } from '@/composables/useSettingsForm'
import { useTheme } from '@/composables/useTheme'
import { withMountPrefix } from '@/utils/basePath'
import { isVisible, type DraftValue, type FieldDef } from '@/utils/settingsModel'
import {
  applyReset,
  buildTabs,
  cardDomId,
  fieldDomId,
  resolveSettingsLocation,
  searchSettings,
  settingsTabPath,
  tabChangeCounts,
  tabResetPlan,
  type ResolvedCard,
  type SearchHit,
} from '@/utils/settingsTabs'
import { t } from '@/i18n'

const toasts = useToasts()
const { confirm } = useConfirm()
const route = useRoute()
const router = useRouter()
const { userThemesDir } = useTheme()
const classicUrl = withMountPrefix('/loras')
const form = useSettingsForm(ALL_FIELDS)
const { server, draft, errors, changed, dirty, loadError, saveError, saving, showErrors } = form
const tabs = buildTabs(SETTINGS_TABS, ALL_FIELDS)
const narrow = useMediaQuery('(max-width: 900px)')
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const storedTab = useLocalStorage<string>(SETTINGS_TAB_STORAGE_KEY, DEFAULT_SETTINGS_TAB, { writeDefaults: false, onError: () => undefined })

const query = ref('')
const roots = shallowRef<Record<string, string[]>>({})
const llmModels = shallowRef<Record<string, string[]>>({})
const loadingModels = ref(false)
const scroller = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const highlight = ref<string | null>(null)
const { start: clearHighlightLater } = useTimeoutFn(() => (highlight.value = null), 2200, { immediate: false })

// --------------------------------------------------------------------------- tabs and URL

const routeTab = computed(() => (typeof route.params.tab === 'string' ? route.params.tab : ''))
const activeId = computed(() => resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { param: routeTab.value, stored: storedTab.value }).tab)
const activeTab = computed(() => tabs.find((tab) => tab.id === activeId.value)!)
const scrollByTab = new Map<string, number>()
/** Set while reveal() switches tabs: it scrolls to its own target, so the tab watcher must not restore. */
let revealing = false

function selectTab(id: string): void {
  if (query.value) query.value = ''
  if (id === activeId.value && routeTab.value === id) return
  if (scroller.value) scrollByTab.set(activeId.value, scroller.value.scrollTop)
  void router.replace({ path: settingsTabPath(id) })
}

// Remember the tab, restore its scroll position (top for a tab not seen yet), canonicalise the URL.
watch(
  activeId,
  async (id, previous) => {
    storedTab.value = id
    if (previous === undefined || revealing) return
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scrollByTab.get(id) ?? 0
  },
  { immediate: true },
)
watch(routeTab, (param) => {
  // Only while this page is the current route (the route also changes when leaving it).
  if (route.name === 'settings' && param !== activeId.value) void router.replace({ path: settingsTabPath(activeId.value) })
})

// --------------------------------------------------------------------------- fields

const changedSet = computed(() => new Set(changed.value))
const changeCounts = computed(() => tabChangeCounts(tabs, changed.value))
const visibleFields = (card: ResolvedCard): FieldDef[] => (draft.value ? card.fields.filter((field) => isVisible(field, draft.value!)) : [])

function update(field: FieldDef, value: DraftValue): void {
  if (!draft.value) return
  draft.value = { ...draft.value, [field.key]: value }
}

function errorOf(field: FieldDef) {
  const error = errors.value[field.key]
  // Errors show while typing for changed fields, and for all fields after a save attempt.
  return error && (showErrors.value || changedSet.value.has(field.key)) ? error : null
}

function rootOptionsFor(field: FieldDef): string[] {
  return field.rootsSource ? (roots.value[field.rootsSource] ?? []) : []
}

function suggestionsFor(field: FieldDef): string[] | undefined {
  if (field.key === 'llm_model') return llmModels.value[String(draft.value?.llm_provider ?? '')] ?? []
  if (field.key === 'llm_api_base') return Object.values(LLM_PRESETS)
  return undefined
}

async function loadModels(): Promise<void> {
  loadingModels.value = true
  try {
    const provider = String(draft.value?.llm_provider ?? '')
    if (provider === 'ollama') {
      llmModels.value = { ...llmModels.value, ollama: await systemApi.ollamaModels(String(draft.value?.llm_api_base ?? '')) }
    } else {
      llmModels.value = { ...llmModels.value, ...(await systemApi.providerModels()) }
    }
  } catch (err) {
    toasts.error((err as Error).message)
  } finally {
    loadingModels.value = false
  }
}

function loadRoots(): void {
  const set = (key: string, list: string[]) => (roots.value = { ...roots.value, [key]: list })
  createModelApi('loras').roots().then((list) => set('loras', list)).catch(() => undefined)
  createModelApi('embeddings').roots().then((list) => set('embeddings', list)).catch(() => undefined)
  systemApi.checkpointRoots().then((list) => set('checkpoints', list)).catch(() => undefined)
  systemApi.unetRoots().then((list) => set('unet', list)).catch(() => undefined)
  systemApi
    .otherRootsBySubtype()
    .then((map) => {
      for (const [sub, list] of Object.entries(map)) set(`other:${sub}`, list)
    })
    .catch(() => undefined)
}

async function openSettingsFolder(): Promise<void> {
  try {
    const result = await systemApi.openSettingsFolder()
    if (result.mode === 'clipboard' && result.path) {
      const ok = await copyText(result.path)
      toasts.push(ok ? t('examples.pathCopied') : t('examples.pathIs', { path: result.path }))
    } else toasts.push(t('examples.folderOpened'))
  } catch (err) {
    toasts.error((err as Error).message)
  }
}

// --------------------------------------------------------------------------- search

const searching = computed(() => query.value.trim().length > 0)
const search = computed(() => searchSettings(tabs, query.value, { draft: draft.value }))
const firstResult = ref<HTMLButtonElement[]>([])

function hitKey(hit: SearchHit): string {
  return hit.field ? hit.field.key : `card:${hit.cardId}`
}

/** Opens the tab of a field or card, scrolls it into view, focuses its control and highlights it briefly. */
async function reveal(tabId: string, target: { fieldKey?: string | null; cardId?: string | null }): Promise<void> {
  query.value = ''
  if (tabId !== activeId.value) {
    if (scroller.value) scrollByTab.set(activeId.value, scroller.value.scrollTop)
    revealing = true
    try {
      await router.replace({ path: settingsTabPath(tabId) })
      await nextTick()
    } finally {
      revealing = false
    }
  }
  await nextTick()
  const element = target.fieldKey ? document.getElementById(`${fieldDomId(target.fieldKey)}-row`) : target.cardId ? document.getElementById(cardDomId(target.cardId)) : null
  if (!element) return
  element.scrollIntoView({ block: target.fieldKey ? 'center' : 'start', behavior: reducedMotion.value ? 'auto' : 'smooth' })
  const focusable = target.fieldKey ? element.querySelector<HTMLElement>('input, select, textarea, button') : element.querySelector<HTMLElement>('h3')
  focusable?.focus({ preventScroll: true })
  highlight.value = target.fieldKey ?? `card:${target.cardId}`
  clearHighlightLater()
}

function openHit(hit: SearchHit): void {
  void reveal(hit.tabId, { fieldKey: hit.field?.key ?? null, cardId: hit.cardId })
}

function onSearchKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && query.value) {
    event.preventDefault()
    query.value = ''
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const first = search.value.groups[0]?.hits[0]
    if (first) openHit(first)
  } else if (event.key === 'ArrowDown' && firstResult.value[0]) {
    event.preventDefault()
    firstResult.value[0].focus()
  }
}

// --------------------------------------------------------------------------- reset, save

const resetPlan = computed(() => (draft.value ? tabResetPlan(activeTab.value, draft.value) : []))
const tabHasDefaults = computed(() => activeTab.value.cards.some((card) => card.fields.some((field) => field.default !== undefined && field.type !== 'secret')))

async function resetTab(): Promise<void> {
  const plan = resetPlan.value
  if (!draft.value || !plan.length) return
  const lines = plan.map((item) => `• ${item.label}: ${item.from} → ${item.to}`)
  const ok = await confirm({
    title: t('set.resetTabTitle', { tab: t(activeTab.value.title) }),
    message: `${t('set.resetTabIntro')}\n${lines.join('\n')}`,
    confirmLabel: t('set.resetTabConfirm', { count: plan.length }),
  })
  if (!ok || !draft.value) return
  draft.value = applyReset(draft.value, plan, ALL_FIELDS)
  toasts.push(t('set.resetTabDone', { count: plan.length }))
}

async function save(): Promise<void> {
  await form.save()
  if (saveError.value) await nextTick(() => document.getElementById('settings-save-error')?.focus())
  else if (showErrors.value && Object.keys(errors.value).length) {
    // Validation failed: open the tab of the first invalid field.
    const key = Object.keys(errors.value)[0]
    const tab = tabs.find((x) => x.cards.some((c) => c.fields.some((f) => f.key === key)))
    if (tab) await reveal(tab.id, { fieldKey: key })
  }
}

const unsavedLabel = computed(() => (changed.value.length === 1 ? t('set.unsavedOne') : t('set.unsavedCount', { count: changed.value.length })))
const showBar = computed(() => dirty.value || saving.value || !!saveError.value)

onBeforeRouteLeave(() => confirmLeave(dirty.value))
useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
})

async function load(): Promise<void> {
  if (!(await form.load())) return
  // Deep link (#field-<key>, #card-<id>, legacy #set-<section>): open its tab and show it.
  const target = resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { param: routeTab.value, hash: route.hash, stored: storedTab.value })
  if (target.fieldKey || target.cardId) await reveal(target.tab, target)
}

onMounted(() => {
  loadRoots()
  // Canonical URL right away (/settings -> /settings/<tab>), keeping a deep-link hash for load().
  const target = resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { param: routeTab.value, hash: route.hash, stored: storedTab.value })
  if (routeTab.value !== target.tab) void router.replace({ path: settingsTabPath(target.tab), hash: route.hash })
  void load()
})

const savedExamplePath = computed(() => String(server.value?.example_images_path ?? ''))
const savedOptimize = computed(() => server.value?.optimize_example_images !== false)
const nightly = computed(() => server.value?.update_channel === 'nightly')
</script>

<template>
  <div ref="scroller" class="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
    <div class="lm-page mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-5">
      <header class="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div class="min-w-[min(100%,260px)] flex-1">
          <h1 class="text-2xl">{{ t('settings.title') }}</h1>
          <p class="mt-1 text-sm text-muted">
            {{ t('settings.intro') }}
            <a :href="classicUrl">{{ t('common.openClassic') }} <AppIcon name="external" :size="12" /></a>
          </p>
        </div>
        <div class="relative w-[300px] phone:w-full">
          <label class="sr-only" for="settings-filter">{{ t('set.searchShortcut') }}</label>
          <AppIcon name="search" :size="16" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            id="settings-filter"
            ref="searchInput"
            v-model="query"
            class="lm-input pr-[40px] pl-[calc(var(--lm-space-3)*2+16px)] [&::-webkit-search-cancel-button]:appearance-none"
            type="search"
            autocomplete="off"
            :placeholder="t('set.search')"
            aria-controls="settings-search-results"
            @keydown="onSearchKey"
          />
          <button v-if="query" type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm absolute top-1/2 right-1 -translate-y-1/2 text-muted" :aria-label="t('set.searchClear')" :title="t('set.searchClear')" @click="query = ''; searchInput?.focus()">
            <AppIcon name="close" :size="14" />
          </button>
        </div>
      </header>

      <div class="grid flex-1 grid-cols-[220px_minmax(0,1fr)] content-start items-start gap-6 tablet:grid-cols-1 tablet:gap-4">
        <!-- Tabs: sticky vertical list on wide screens, horizontal strip below the tablet breakpoint -->
        <div class="sticky top-0 z-10 self-start bg-page tablet:-mx-6 tablet:px-6 tablet:py-2 tablet:hairline-b tablet:border-border phone:-mx-4 phone:px-4">
          <SettingsTabList :tabs="tabs" :active="activeId" :orientation="narrow ? 'horizontal' : 'vertical'" :changes="changeCounts" :matches="searching ? search.counts : null" @select="selectTab" />
        </div>

        <div class="flex min-w-0 flex-col gap-4">
          <!-- Load error: banner with retry (also when a re-read after saving failed) -->
          <div v-if="loadError" class="flex flex-wrap items-center gap-3 rounded-md hairline border-danger bg-danger-soft px-4 py-3 text-sm" role="alert">
            <AppIcon name="alert" :size="18" class="flex-none text-danger" />
            <p class="min-w-0 flex-1 text-fg">{{ t('set.loadFailed', { error: loadError }) }}</p>
            <button type="button" class="lm-btn lm-btn--sm" @click="load()"><AppIcon name="refresh" :size="14" />{{ t('common.retry') }}</button>
          </div>

          <!-- Search results across all tabs -->
          <section v-if="searching" id="settings-search-results" class="flex flex-col gap-4" aria-live="polite" :aria-label="t('set.searchResults', { count: search.total, query: query.trim() })">
            <p v-if="search.total" class="text-sm text-muted">{{ t('set.searchResults', { count: search.total, query: query.trim() }) }}</p>
            <div v-if="!search.total" class="lm-panel flex flex-col items-center gap-2 px-6 py-10 text-center">
              <AppIcon name="search" :size="28" class="text-muted" />
              <p class="font-medium">{{ t('set.searchEmptyTitle', { query: query.trim() }) }}</p>
              <p class="max-w-[48ch] text-sm text-muted">{{ t('set.searchEmptyHint') }}</p>
              <button type="button" class="lm-btn lm-btn--sm mt-2" @click="query = ''; searchInput?.focus()">{{ t('set.searchClear') }}</button>
            </div>
            <section v-for="group in search.groups" :key="group.tab.id" class="lm-panel overflow-hidden" :aria-labelledby="`search-group-${group.tab.id}`">
              <h2 :id="`search-group-${group.tab.id}`" class="flex items-center gap-2 hairline-b border-border bg-sunken px-4 py-2 text-sm">
                <AppIcon :name="group.tab.icon" :size="16" class="text-muted" />{{ t(group.tab.title) }}
                <span class="lm-badge">{{ group.hits.length }}</span>
              </h2>
              <ul class="divide-y divide-border">
                <li v-for="hit in group.hits" :key="hitKey(hit)">
                  <button ref="firstResult" type="button" class="lm-row flex w-full cursor-pointer flex-col items-start gap-[2px] rounded-none px-4 py-3 text-left" @click="openHit(hit)">
                    <span class="text-sm font-medium text-fg">{{ hit.field ? t(hit.field.label) : t(hit.cardTitle) }}</span>
                    <span class="text-xs text-muted">{{ t(group.tab.title) }} › {{ hit.field ? t(hit.cardTitle) : t('set.searchPanel') }}</span>
                    <span v-if="hit.field?.hint" class="line-clamp-1 text-xs text-muted">{{ t(hit.field.hint) }}</span>
                  </button>
                </li>
              </ul>
            </section>
          </section>

          <!-- Loading skeleton -->
          <div v-else-if="!draft && !loadError" class="flex flex-col gap-4" role="status" aria-busy="true">
            <span class="sr-only">{{ t('set.loadingSettings') }}</span>
            <div v-for="n in 2" :key="n" class="lm-panel flex flex-col gap-4 p-5" aria-hidden="true">
              <div class="lm-skeleton h-[18px] w-[180px] rounded-sm"></div>
              <div v-for="row in 3" :key="row" class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 tablet:grid-cols-1">
                <div class="lm-skeleton h-[14px] w-3/4 rounded-sm"></div>
                <div class="lm-skeleton h-control rounded-sm"></div>
              </div>
            </div>
          </div>

          <!-- The active tab -->
          <form
            v-else-if="draft"
            :id="`settings-panel-${activeTab.id}`"
            role="tabpanel"
            :aria-labelledby="`settings-tab-${activeTab.id}`"
            class="flex flex-col gap-4"
            novalidate
            @submit.prevent="save"
          >
            <div>
              <h2 class="text-xl">{{ t(activeTab.title) }}</h2>
              <p class="mt-1 text-sm text-muted">{{ t(activeTab.description) }}</p>
            </div>

            <section
              v-for="card in activeTab.cards"
              :id="cardDomId(card.id)"
              :key="card.id"
              class="lm-panel scroll-mt-[calc(var(--lm-topbar-height)+var(--lm-space-6))] overflow-hidden shadow-sm transition-colors duration-(--lm-motion-normal)"
              :class="[card.tone === 'danger' ? 'border-l-[3px] border-l-danger' : '', highlight === `card:${card.id}` ? 'bg-accent-soft' : '']"
              :aria-labelledby="`${cardDomId(card.id)}-title`"
            >
              <header class="flex items-start gap-3 hairline-b border-border px-5 py-4 phone:px-4">
                <AppIcon v-if="card.tone === 'danger'" name="alert" :size="18" class="mt-[2px] flex-none text-danger" />
                <div class="min-w-0">
                  <h3 :id="`${cardDomId(card.id)}-title`" class="text-md outline-none" tabindex="-1">{{ t(card.title) }}</h3>
                  <p v-if="card.description" class="mt-1 text-sm text-muted">{{ t(card.description) }}</p>
                </div>
              </header>

              <div v-if="visibleFields(card).length" class="divide-y divide-border">
                <SettingsField
                  v-for="field in visibleFields(card)"
                  :key="field.key"
                  :field="field"
                  :value="draft[field.key]"
                  :error="errorOf(field)"
                  :changed="changedSet.has(field.key)"
                  :highlighted="highlight === field.key"
                  :root-options="rootOptionsFor(field)"
                  :configured="field.secretFlag ? !!server?.[field.secretFlag] : false"
                  :suggestions="suggestionsFor(field)"
                  @update="update(field, $event)"
                  @reset="form.resetField(field)"
                >
                  <button v-if="field.key === 'llm_model'" type="button" class="lm-btn lm-btn--sm self-start" :disabled="loadingModels" @click="loadModels">{{ t('set.loadModels') }}</button>
                </SettingsField>
              </div>

              <div v-for="panel in card.panels" :key="panel" class="flex flex-col gap-3 px-5 py-4 phone:px-4" :class="visibleFields(card).length ? 'hairline-t border-border' : ''">
                <template v-if="panel === 'appearance'">
                  <ThemeOptions />
                  <p class="lm-hint">{{ t('settings.userThemesHint', { dir: userThemesDir || '<settings dir>/ui-themes' }) }}</p>
                </template>
                <template v-else-if="panel === 'settingsFile'">
                  <div class="flex flex-wrap items-center gap-3">
                    <div class="min-w-0 flex-1">
                      <p class="text-xs text-muted">{{ t('set.settingsFilePath') }}</p>
                      <p class="font-mono text-xs wrap-anywhere">{{ server?.settings_file ? String(server.settings_file) : '-' }}</p>
                    </div>
                    <button type="button" class="lm-btn lm-btn--sm" @click="openSettingsFolder"><AppIcon name="folder" :size="14" />{{ t('set.openSettingsFolder') }}</button>
                  </div>
                </template>
                <template v-else-if="panel === 'diagnostics'">
                  <div class="grid grid-cols-2 gap-3 phone:grid-cols-1">
                    <RouterLink to="/doctor" class="lm-row flex items-start gap-3 rounded-md hairline border-border p-3 text-fg no-underline">
                      <AppIcon name="pulse" :size="18" class="mt-[2px] flex-none text-accent" />
                      <span class="flex flex-col gap-1"><span class="text-sm font-medium">{{ t('set.diag.doctor') }}</span><span class="text-xs text-muted">{{ t('set.diag.doctorHint') }}</span></span>
                    </RouterLink>
                    <RouterLink to="/stats" class="lm-row flex items-start gap-3 rounded-md hairline border-border p-3 text-fg no-underline">
                      <AppIcon name="chart" :size="18" class="mt-[2px] flex-none text-accent" />
                      <span class="flex flex-col gap-1"><span class="text-sm font-medium">{{ t('set.diag.stats') }}</span><span class="text-xs text-muted">{{ t('set.diag.statsHint') }}</span></span>
                    </RouterLink>
                  </div>
                </template>
                <ExampleImagesPanel v-else-if="panel === 'exampleImagesDownload'" :saved-path="savedExamplePath" :optimize="savedOptimize" />
                <MetadataArchivePanel v-else-if="panel === 'metadataArchive'" @changed="form.reloadKeeping(changed)" />
                <BackupsPanel v-else-if="panel === 'backups'" />
                <AboutPanel v-else-if="panel === 'about'" :nightly="nightly" />
              </div>
            </section>

            <!-- Tab footer: reset this tab -->
            <div v-if="tabHasDefaults" class="flex flex-wrap items-center justify-end gap-3 pt-1">
              <p v-if="!resetPlan.length" class="text-xs text-muted">{{ t('set.resetTabNone') }}</p>
              <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm text-muted" :disabled="!resetPlan.length" @click="resetTab">
                <AppIcon name="refresh" :size="14" />{{ t('set.resetTab') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Sticky save bar: only with unsaved changes; in the flow at the end, so it never hides the last field -->
    <div v-if="showBar && draft" class="sticky bottom-0 z-20 mt-auto animate-fade-in px-6 pb-4 phone:px-3 phone:pb-3">
      <div class="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 rounded-md hairline border-accent bg-elevated px-4 py-3 shadow-lg" role="region" :aria-label="t('settings.unsaved')">
        <span class="size-[8px] flex-none rounded-pill bg-accent" aria-hidden="true"></span>
        <span class="mr-auto text-sm font-medium" aria-live="polite">{{ saving ? t('set.saving') : dirty ? unsavedLabel : t('settings.noChanges') }}</span>
        <p v-if="saveError" id="settings-save-error" class="basis-full text-xs text-danger" role="alert" tabindex="-1">{{ saveError }}</p>
        <button type="button" class="lm-btn" :disabled="!dirty || saving" @click="form.discard()">{{ t('settings.reset') }}</button>
        <button type="button" class="lm-btn lm-btn--primary" :disabled="!dirty || saving" :aria-busy="saving" @click="save">
          <span v-if="saving" class="size-[14px] animate-spinner rounded-pill border-2 border-on-accent border-t-transparent" aria-hidden="true"></span>{{ t('settings.saveAll') }}
        </button>
      </div>
    </div>
  </div>
</template>
