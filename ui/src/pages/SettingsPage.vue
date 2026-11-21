<script setup lang="ts">
/**
 * Settings (phase B2b): every section of the classic settings modal, driven
 * by config/settingsSchema.ts. One draft, one "Save changes" (only changed
 * keys, validated keys first, backend errors shown, then re-read), a
 * per-field reset to the default, a filter box, secrets that are never shown
 * and an unsaved-changes guard (route leave + tab close). The panels
 * (example-image download, metadata archive, backups, about) act directly.
 */
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import AppIcon from '@/components/AppIcon.vue'
import StateBlock from '@/components/StateBlock.vue'
import ThemeOptions from '@/components/ThemeOptions.vue'
import AboutPanel from '@/components/settings/AboutPanel.vue'
import BackupsPanel from '@/components/settings/BackupsPanel.vue'
import ExampleImagesPanel from '@/components/settings/ExampleImagesPanel.vue'
import MetadataArchivePanel from '@/components/settings/MetadataArchivePanel.vue'
import SettingsField from '@/components/settings/SettingsField.vue'
import { createModelApi } from '@/api/endpoints'
import { systemApi } from '@/api/maintenance'
import { ALL_FIELDS, LLM_PRESETS, SETTINGS_SECTIONS, type SectionDef } from '@/config/settingsSchema'
import { useToasts, copyText } from '@/composables/useFeedback'
import { confirmLeave, useSettingsForm } from '@/composables/useSettingsForm'
import { useTheme } from '@/composables/useTheme'
import { withMountPrefix } from '@/utils/basePath'
import { isVisible, matchesQuery, type DraftValue, type FieldDef } from '@/utils/settingsModel'
import { t } from '@/i18n'

const toasts = useToasts()
const route = useRoute()
const { userThemesDir } = useTheme()
const classicUrl = withMountPrefix('/loras')
const form = useSettingsForm(ALL_FIELDS)
const { server, draft, errors, changed, dirty, loadError, saveError, saving, showErrors } = form
const query = ref('')
const roots = shallowRef<Record<string, string[]>>({})
const llmModels = shallowRef<Record<string, string[]>>({})
const loadingModels = ref(false)

const changedSet = computed(() => new Set(changed.value))

function sectionFields(section: SectionDef): FieldDef[] {
  if (!draft.value) return []
  return section.fields.filter((field) => isVisible(field, draft.value!) && (matchesQuery(t(field.label), query.value) || matchesQuery(t(section.title), query.value)))
}

const visibleSections = computed(() =>
  SETTINGS_SECTIONS.filter((section) => !query.value.trim() || sectionFields(section).length || matchesQuery(t(section.title), query.value)),
)
const sectionChanges = (section: SectionDef) => section.fields.filter((field) => changedSet.value.has(field.key)).length

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

async function save(): Promise<void> {
  await form.save()
  if (saveError.value) await nextTick(() => document.getElementById('settings-save-error')?.focus())
}

function scrollToHash(): void {
  const hash = route.hash.replace(/^#/, '')
  if (!hash) return
  const target = document.getElementById(`${hash}-row`) ?? document.getElementById(hash)
  target?.scrollIntoView({ block: 'start' })
  target?.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true })
}

onBeforeRouteLeave(() => confirmLeave(dirty.value))
useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
})

onMounted(async () => {
  loadRoots()
  if (await form.load()) {
    await nextTick()
    scrollToHash()
  }
})

const savedExamplePath = computed(() => String(server.value?.example_images_path ?? ''))
const savedOptimize = computed(() => server.value?.optimize_example_images !== false)
const nightly = computed(() => server.value?.update_channel === 'nightly')
const cardClass = 'lm-panel flex flex-col gap-4 p-5 scroll-mt-4 phone:p-4'
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="lm-page flex w-full max-w-[1180px] gap-6">
      <!-- Section navigation (wide screens only) -->
      <nav class="sticky top-0 max-h-[calc(100vh-var(--lm-topbar-height)-var(--lm-space-8))] w-[200px] flex-none self-start overflow-y-auto narrow:hidden" :aria-label="t('set.sections')">
        <ul class="flex flex-col gap-1">
          <li v-for="section in visibleSections" :key="section.id">
            <a :href="`#set-${section.id}`" class="lm-row lm-row--nav flex min-h-control items-center gap-2 px-2 text-sm no-underline">
              <span class="min-w-0 flex-1 truncate">{{ t(section.title) }}</span>
              <span v-if="sectionChanges(section)" class="lm-badge lm-badge--accent">{{ sectionChanges(section) }}</span>
            </a>
          </li>
        </ul>
      </nav>

      <div class="flex min-w-0 flex-1 flex-col gap-4">
        <header class="lm-page-header mb-0 flex flex-wrap items-end gap-3">
          <div class="min-w-0 flex-1">
            <h1>{{ t('settings.title') }}</h1>
            <p class="mt-2 text-muted">
              {{ t('settings.intro') }}
              <a :href="classicUrl">{{ t('common.openClassic') }} <AppIcon name="external" :size="12" /></a>
            </p>
            <p v-if="server?.settings_file" class="mt-1 text-xs text-muted wrap-anywhere">{{ t('set.settingsFile', { path: String(server.settings_file) }) }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2 phone:w-full">
            <label class="sr-only" for="settings-filter">{{ t('set.searchLabel') }}</label>
            <input id="settings-filter" v-model="query" class="lm-input w-[220px] phone:w-full" type="search" :placeholder="t('set.search')" />
            <button type="button" class="lm-btn lm-btn--ghost" @click="openSettingsFolder"><AppIcon name="folder" :size="16" />{{ t('set.openSettingsFolder') }}</button>
          </div>
        </header>

        <StateBlock v-if="loadError && !draft" kind="error" :title="t('settings.loadError')" :message="loadError" @retry="form.load()" />
        <StateBlock v-else-if="!draft" kind="loading" />
        <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="save">
          <p v-if="!visibleSections.length" class="text-muted">{{ t('set.noMatch', { query }) }}</p>
          <section v-for="section in visibleSections" :id="`set-${section.id}`" :key="section.id" :class="cardClass" :aria-labelledby="`set-${section.id}-title`">
            <div>
              <h2 :id="`set-${section.id}-title`" class="text-lg">{{ t(section.title) }}</h2>
              <p v-if="section.description" class="mt-1 text-sm text-muted">{{ t(section.description) }}</p>
            </div>

            <template v-if="section.panels?.includes('appearance') && !query">
              <ThemeOptions />
              <p class="lm-hint">{{ t('settings.userThemesHint', { dir: userThemesDir || '<settings dir>/ui-themes' }) }}</p>
            </template>

            <div v-if="sectionFields(section).length" class="grid grid-cols-2 gap-x-6 gap-y-4 tablet:grid-cols-1">
              <SettingsField
                v-for="field in sectionFields(section)"
                :key="field.key"
                :class="['toggle', 'list', 'map', 'textarea', 'secret', 'checkboxes'].includes(field.type) ? 'col-span-2 tablet:col-span-1' : ''"
                :field="field"
                :value="draft[field.key]"
                :error="errorOf(field)"
                :changed="changedSet.has(field.key)"
                :root-options="rootOptionsFor(field)"
                :configured="field.secretFlag ? !!server?.[field.secretFlag] : false"
                :suggestions="suggestionsFor(field)"
                @update="update(field, $event)"
                @reset="form.resetField(field)"
              >
                <button v-if="field.key === 'llm_model'" type="button" class="lm-btn lm-btn--sm self-start" :disabled="loadingModels" @click="loadModels">{{ t('set.loadModels') }}</button>
              </SettingsField>
            </div>

            <template v-if="!query">
              <ExampleImagesPanel v-if="section.panels?.includes('exampleImagesDownload')" :saved-path="savedExamplePath" :optimize="savedOptimize" />
              <MetadataArchivePanel v-if="section.panels?.includes('metadataArchive')" @changed="form.reloadKeeping(changed)" />
              <BackupsPanel v-if="section.panels?.includes('backups')" />
              <AboutPanel v-if="section.panels?.includes('about')" :nightly="nightly" />
            </template>
          </section>

          <div
            class="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-md hairline bg-elevated px-4 py-3 shadow-md"
            :class="dirty ? 'border-accent' : 'border-border'"
          >
            <span class="mr-auto text-muted" aria-live="polite">{{ dirty ? t('set.unsavedCount', { count: changed.length }) : t('settings.noChanges') }}</span>
            <p v-if="saveError" id="settings-save-error" class="lm-error-text basis-full" role="alert" tabindex="-1">{{ saveError }}</p>
            <button type="button" class="lm-btn" :disabled="!dirty || saving" @click="form.discard()">{{ t('settings.reset') }}</button>
            <button type="submit" class="lm-btn lm-btn--primary" :disabled="!dirty || saving" :aria-busy="saving">{{ t('settings.saveAll') }}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
