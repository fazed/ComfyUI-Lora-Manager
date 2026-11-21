<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import StateBlock from '@/components/StateBlock.vue'
import ThemeOptions from '@/components/ThemeOptions.vue'
import { createModelApi, settingsApi } from '@/api/endpoints'
import { useAppSettings } from '@/composables/useAppSettings'
import { useToasts } from '@/composables/useFeedback'
import { useTheme } from '@/composables/useTheme'
import { withMountPrefix } from '@/utils/basePath'
import {
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
  ROOT_KEYS,
  TEMPLATE_TYPES,
  TOGGLE_KEYS,
  buildSettingsPatch,
  draftFromSettings,
  validateConcurrency,
  type SettingsDraft,
} from '@/utils/settingsForm'
import { t, type MessageKey } from '@/i18n'

const toasts = useToasts()
const { settings, error, load, patch } = useAppSettings()
const { userThemesDir } = useTheme()
const classicUrl = withMountPrefix('/loras')

const draft = ref<SettingsDraft | null>(null)
const roots = ref<Record<string, string[]>>({})
const saving = ref(false)
const saveError = ref<string | null>(null)

const concurrencyError = computed(() =>
  draft.value && validateConcurrency(draft.value.concurrency)
    ? t('settings.integerRange', { min: MIN_CONCURRENCY, max: MAX_CONCURRENCY })
    : null,
)
const changes = computed(() => (settings.value && draft.value ? buildSettingsPatch(settings.value, draft.value) : {}))
const dirty = computed(() => Object.keys(changes.value).length > 0 || (!!draft.value && !!concurrencyError.value))

function rootOptions(key: string, prefix: string): string[] {
  const list = roots.value[prefix] ?? []
  const current = draft.value?.roots[key]
  return current && !list.includes(current) ? [current, ...list] : list
}

async function init(force = false): Promise<void> {
  const value = await load(force)
  if (value) draft.value = draftFromSettings(value)
}

function reset(): void {
  if (settings.value) draft.value = draftFromSettings(settings.value)
  saveError.value = null
}

async function save(): Promise<void> {
  if (!draft.value) return
  if (concurrencyError.value) {
    saveError.value = t('settings.invalid')
    return
  }
  const payload = changes.value
  if (!Object.keys(payload).length) {
    toasts.push(t('settings.noChanges'))
    return
  }
  saving.value = true
  saveError.value = null
  try {
    await settingsApi.update(payload)
    patch(payload)
    // Re-read so normalised values (e.g. clamped integers) are shown.
    await init(true)
    toasts.success(t('settings.savedOk'))
  } catch (err) {
    saveError.value = (err as Error).message
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void init(true)
  for (const prefix of ['loras', 'checkpoints', 'embeddings'] as const) {
    createModelApi(prefix)
      .roots()
      .then((value) => (roots.value = { ...roots.value, [prefix]: value }))
      .catch(() => undefined)
  }
})

const cardClass = 'lm-panel flex flex-col gap-3 p-5'
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="lm-page flex w-full max-w-[980px] flex-col gap-4">
      <header class="lm-page-header mb-0">
        <div>
          <h1>{{ t('settings.title') }}</h1>
          <p class="mt-2 text-muted">
            {{ t('settings.intro') }}
            <a :href="classicUrl">{{ t('common.openClassic') }} <AppIcon name="external" :size="12" /></a>
          </p>
        </div>
      </header>

      <section :class="cardClass" aria-labelledby="set-appearance">
        <h2 id="set-appearance" class="text-lg">{{ t('settings.appearance') }}</h2>
        <ThemeOptions />
        <p class="lm-hint">{{ t('settings.userThemesHint', { dir: userThemesDir || '<settings dir>/ui-themes' }) }}</p>
      </section>

      <StateBlock v-if="error && !draft" kind="error" :title="t('settings.loadError')" :message="error" @retry="init(true)" />
      <StateBlock v-else-if="!draft" kind="loading" />
      <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="save">
        <section :class="cardClass" aria-labelledby="set-roots">
          <h2 id="set-roots" class="text-lg">{{ t('settings.defaultRoots') }}</h2>
          <div class="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
            <div v-for="root in ROOT_KEYS" :key="root.key" class="min-w-0">
              <label class="lm-label" :for="root.key">{{ t(`settings.${root.key}` as MessageKey) }}</label>
              <select :id="root.key" v-model="draft.roots[root.key]" class="lm-select">
                <option value="">{{ t('common.none') }}</option>
                <option v-for="option in rootOptions(root.key, root.prefix)" :key="option" :value="option">{{ option }}</option>
              </select>
            </div>
          </div>
        </section>

        <section :class="cardClass" aria-labelledby="set-templates">
          <h2 id="set-templates" class="text-lg">{{ t('settings.templates') }}</h2>
          <div class="grid grid-cols-2 gap-4 phone:grid-cols-1">
            <template v-for="type in TEMPLATE_TYPES" :key="type">
              <div class="min-w-0">
                <label class="lm-label" :for="`fn-${type}`">{{ t('settings.download_filename_templates', { type }) }}</label>
                <input :id="`fn-${type}`" v-model="draft.filenameTemplates[type]" class="lm-input font-mono text-xs" spellcheck="false" />
              </div>
              <div class="min-w-0">
                <label class="lm-label" :for="`path-${type}`">{{ t('settings.download_path_templates', { type }) }}</label>
                <input :id="`path-${type}`" v-model="draft.pathTemplates[type]" class="lm-input font-mono text-xs" spellcheck="false" />
              </div>
            </template>
          </div>
          <p class="lm-hint">{{ t('settings.download_filename_templates.hint') }}</p>
          <p class="lm-hint">{{ t('settings.download_path_templates.hint') }}</p>
        </section>

        <section :class="cardClass" aria-labelledby="set-downloads">
          <h2 id="set-downloads" class="text-lg">{{ t('settings.downloads') }}</h2>
          <div class="max-w-[220px] min-w-0">
            <label class="lm-label" for="concurrency">{{ t('settings.download_queue_max_concurrent') }}</label>
            <input
              id="concurrency"
              v-model="draft.concurrency"
              class="lm-input"
              type="number"
              inputmode="numeric"
              :min="MIN_CONCURRENCY"
              :max="MAX_CONCURRENCY"
              :aria-invalid="!!concurrencyError"
              aria-describedby="concurrency-hint"
            />
            <p v-if="concurrencyError" class="lm-error-text" role="alert">{{ concurrencyError }}</p>
            <p id="concurrency-hint" class="lm-hint">
              {{ t('settings.download_queue_max_concurrent.hint', { min: MIN_CONCURRENCY, max: MAX_CONCURRENCY }) }}
            </p>
          </div>
          <label class="lm-check">
            <input v-model="draft.toggles.skip_previously_downloaded_model_versions" type="checkbox" />
            {{ t('settings.skip_previously_downloaded_model_versions') }}
          </label>
        </section>

        <section :class="cardClass" aria-labelledby="set-library">
          <h2 id="set-library" class="text-lg">{{ t('settings.library') }}</h2>
          <label v-for="key in TOGGLE_KEYS.filter((k) => k !== 'skip_previously_downloaded_model_versions')" :key="key" class="lm-check">
            <input v-model="draft.toggles[key]" type="checkbox" />
            {{ t(`settings.${key}` as MessageKey) }}
          </label>
        </section>

        <div
          class="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 rounded-md hairline bg-elevated px-4 py-3 shadow-md"
          :class="dirty ? 'border-accent' : 'border-border'"
        >
          <span class="mr-auto text-muted" aria-live="polite">{{ dirty ? t('settings.unsaved') : t('settings.noChanges') }}</span>
          <p v-if="saveError" class="lm-error-text" role="alert">{{ saveError }}</p>
          <button type="button" class="lm-btn" :disabled="!dirty || saving" @click="reset">{{ t('settings.reset') }}</button>
          <button type="submit" class="lm-btn lm-btn--primary" :disabled="!dirty || saving">{{ t('settings.saveAll') }}</button>
        </div>
      </form>
    </div>
  </div>
</template>
