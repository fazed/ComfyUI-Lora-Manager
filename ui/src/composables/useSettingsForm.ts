/**
 * Settings page state: the schema-driven draft, validation, dirty tracking,
 * the save flow (confirm side effects, validated keys first, re-read after
 * any outcome) and the unsaved-changes guard.
 */

import { computed, ref, shallowRef } from 'vue'
import { settingsApi } from '@/api/endpoints'
import type { SettingsMap } from '@/api/types'
import { useAppSettings } from '@/composables/useAppSettings'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import {
  buildPatch,
  changedFields,
  draftFromSettings,
  patchEffects,
  resetToDefault,
  sanitizeSettings,
  validateDraft,
  type Draft,
  type FieldDef,
  type SecretDraft,
} from '@/utils/settingsModel'
import { t } from '@/i18n'

export function useSettingsForm(fields: FieldDef[]) {
  const toasts = useToasts()
  const { confirm } = useConfirm()
  const app = useAppSettings()
  const server = shallowRef<SettingsMap | null>(null)
  const draft = ref<Draft | null>(null)
  const loadError = ref<string | null>(null)
  const saveError = ref<string | null>(null)
  const saving = ref(false)
  const showErrors = ref(false)

  const errors = computed(() => (draft.value ? validateDraft(fields, draft.value) : {}))
  const patch = computed(() => (server.value && draft.value ? buildPatch(server.value, draft.value, fields) : {}))
  const changed = computed(() => (server.value && draft.value ? changedFields(server.value, draft.value, fields) : []))
  const dirty = computed(() => changed.value.length > 0)

  async function load(): Promise<boolean> {
    loadError.value = null
    try {
      const raw = await settingsApi.get()
      const clean = sanitizeSettings(raw)
      server.value = clean
      draft.value = draftFromSettings(clean, fields)
      app.patch(clean)
      return true
    } catch (err) {
      loadError.value = (err as Error).message
      return false
    }
  }

  /** Re-reads the server values but keeps the user's edits for fields that were not saved. */
  async function reloadKeeping(keys: string[]): Promise<void> {
    const kept = draft.value ? Object.fromEntries(keys.map((key) => [key, draft.value![key]])) : {}
    if (await load()) draft.value = { ...draft.value!, ...kept }
  }

  function discard(): void {
    if (server.value) draft.value = draftFromSettings(server.value, fields)
    saveError.value = null
    showErrors.value = false
  }

  function resetField(field: FieldDef): void {
    if (draft.value) draft.value = { ...draft.value, [field.key]: resetToDefault(field) }
  }

  function setSecret(key: string, value: SecretDraft): void {
    if (draft.value) draft.value = { ...draft.value, [key]: value }
  }

  async function save(): Promise<boolean> {
    if (!draft.value || !server.value) return false
    showErrors.value = true
    if (Object.keys(errors.value).length) {
      saveError.value = t('settings.invalid')
      return false
    }
    const body = patch.value
    if (!Object.keys(body).length) {
      toasts.push(t('settings.noChanges'))
      return false
    }
    const effects = patchEffects(changed.value, fields)
    if (effects.length) {
      const lines = effects.map((field) => `• ${t(field.label)}: ${field.confirm ? t(field.confirm) : t(`set.effect.${field.effect}` as 'set.effect.restart')}`)
      const ok = await confirm({ title: t('set.confirmTitle'), message: `${t('set.confirmIntro')}\n${lines.join('\n')}`, confirmLabel: t('settings.saveAll'), danger: effects.some((f) => f.effect === 'moves-files' || f.effect === 'relocates-settings') })
      if (!ok) return false
    }
    saving.value = true
    saveError.value = null
    const pending = [...changed.value]
    try {
      await settingsApi.update(body)
      await load()
      showErrors.value = false
      toasts.success(t('settings.savedOk'))
      return true
    } catch (err) {
      // Keys before the failing one may already be saved: show the truth, keep the edits.
      saveError.value = t('set.saveFailed', { error: (err as Error).message })
      await reloadKeeping(pending)
      return false
    } finally {
      saving.value = false
    }
  }

  return { server, draft, errors, patch, changed, dirty, loadError, saveError, saving, showErrors, load, discard, resetField, setSecret, save }
}

/** Confirm text for leaving the page with unsaved changes. */
export async function confirmLeave(dirty: boolean): Promise<boolean> {
  if (!dirty) return true
  const { confirm } = useConfirm()
  return confirm({ title: t('set.leaveTitle'), message: t('set.leaveMessage'), confirmLabel: t('set.leaveConfirm'), danger: true })
}
