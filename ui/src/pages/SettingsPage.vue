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
</script>

<template>
  <div class="settings-scroll">
    <div class="lm-page settings">
      <header class="lm-page-header">
        <div>
          <h1>{{ t('settings.title') }}</h1>
          <p class="lm-muted settings__intro">
            {{ t('settings.intro') }}
            <a :href="classicUrl">{{ t('common.openClassic') }} <AppIcon name="external" :size="12" /></a>
          </p>
        </div>
      </header>

      <section class="settings__card lm-panel" aria-labelledby="set-appearance">
        <h2 id="set-appearance">{{ t('settings.appearance') }}</h2>
        <ThemeOptions />
        <p class="lm-hint">{{ t('settings.userThemesHint', { dir: userThemesDir || '<settings dir>/ui-themes' }) }}</p>
      </section>

      <StateBlock v-if="error && !draft" kind="error" :title="t('settings.loadError')" :message="error" @retry="init(true)" />
      <StateBlock v-else-if="!draft" kind="loading" />
      <form v-else class="settings__form" novalidate @submit.prevent="save">
        <section class="settings__card lm-panel" aria-labelledby="set-roots">
          <h2 id="set-roots">{{ t('settings.defaultRoots') }}</h2>
          <div class="settings__grid">
            <div v-for="root in ROOT_KEYS" :key="root.key" class="settings__field">
              <label class="lm-label" :for="root.key">{{ t(`settings.${root.key}` as MessageKey) }}</label>
              <select :id="root.key" v-model="draft.roots[root.key]" class="lm-select">
                <option value="">{{ t('common.none') }}</option>
                <option v-for="option in rootOptions(root.key, root.prefix)" :key="option" :value="option">{{ option }}</option>
              </select>
            </div>
          </div>
        </section>

        <section class="settings__card lm-panel" aria-labelledby="set-templates">
          <h2 id="set-templates">{{ t('settings.templates') }}</h2>
          <div class="settings__grid settings__grid--pairs">
            <template v-for="type in TEMPLATE_TYPES" :key="type">
              <div class="settings__field">
                <label class="lm-label" :for="`fn-${type}`">{{ t('settings.download_filename_templates', { type }) }}</label>
                <input :id="`fn-${type}`" v-model="draft.filenameTemplates[type]" class="lm-input lm-mono-input" spellcheck="false" />
              </div>
              <div class="settings__field">
                <label class="lm-label" :for="`path-${type}`">{{ t('settings.download_path_templates', { type }) }}</label>
                <input :id="`path-${type}`" v-model="draft.pathTemplates[type]" class="lm-input lm-mono-input" spellcheck="false" />
              </div>
            </template>
          </div>
          <p class="lm-hint">{{ t('settings.download_filename_templates.hint') }}</p>
          <p class="lm-hint">{{ t('settings.download_path_templates.hint') }}</p>
        </section>

        <section class="settings__card lm-panel" aria-labelledby="set-downloads">
          <h2 id="set-downloads">{{ t('settings.downloads') }}</h2>
          <div class="settings__field settings__field--narrow">
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
          <label class="settings__toggle">
            <input v-model="draft.toggles.skip_previously_downloaded_model_versions" type="checkbox" />
            {{ t('settings.skip_previously_downloaded_model_versions') }}
          </label>
        </section>

        <section class="settings__card lm-panel" aria-labelledby="set-library">
          <h2 id="set-library">{{ t('settings.library') }}</h2>
          <label v-for="key in TOGGLE_KEYS.filter((k) => k !== 'skip_previously_downloaded_model_versions')" :key="key" class="settings__toggle">
            <input v-model="draft.toggles[key]" type="checkbox" />
            {{ t(`settings.${key}` as MessageKey) }}
          </label>
        </section>

        <div class="settings__bar" :class="{ 'settings__bar--dirty': dirty }">
          <span class="lm-muted" aria-live="polite">{{ dirty ? t('settings.unsaved') : t('settings.noChanges') }}</span>
          <p v-if="saveError" class="lm-error-text" role="alert">{{ saveError }}</p>
          <button type="button" class="lm-btn" :disabled="!dirty || saving" @click="reset">{{ t('settings.reset') }}</button>
          <button type="submit" class="lm-btn lm-btn--primary" :disabled="!dirty || saving">{{ t('settings.saveAll') }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.settings-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.settings {
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-4);
  max-width: 980px;
  width: 100%;
}

.settings .lm-page-header {
  margin-bottom: 0;
}

.settings__intro {
  margin: var(--lm-space-2) 0 0;
}

.settings__form {
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-4);
}

.settings__card {
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-3);
  padding: var(--lm-space-5);
}

.settings__card h2 {
  font-size: var(--lm-font-size-lg);
}

.settings__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--lm-space-4);
}

.settings__grid--pairs {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.settings__field {
  min-width: 0;
}

@media (max-width: 720px) {
  .settings__grid--pairs {
    grid-template-columns: minmax(0, 1fr);
  }
}

.settings__field--narrow {
  max-width: 220px;
}

.lm-mono-input {
  font-family: var(--lm-font-mono);
  font-size: var(--lm-font-size-xs);
}

.settings__toggle {
  display: flex;
  align-items: center;
  gap: var(--lm-space-2);
  cursor: pointer;
}

.settings__toggle input {
  accent-color: var(--lm-color-accent);
}

.settings__bar {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--lm-space-2);
  padding: var(--lm-space-3) var(--lm-space-4);
  border: var(--lm-border-width) solid var(--lm-color-border);
  border-radius: var(--lm-radius-md);
  background: var(--lm-color-elevated);
  box-shadow: var(--lm-shadow-md);
}

.settings__bar > .lm-muted {
  margin-right: auto;
}

.settings__bar--dirty {
  border-color: var(--lm-color-accent);
}
</style>
