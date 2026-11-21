<script setup lang="ts">
/**
 * One schema-driven settings row: label, effect chips and help text on the
 * left, the control (toggle switch, select, number, text, path, list, map,
 * template, root select, checkboxes, secret) with its inline error on the
 * right, and a calm "Reset" text button at the row's right edge that only
 * appears when the value differs from the default. One column on narrow
 * screens. A changed (unsaved) row gets a thin accent bar on its left edge.
 *
 * Secrets are never pre-filled: they show "Configured" and take a new value
 * in a password input (with a show/hide toggle), or are removed explicitly.
 */
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { PATH_TEMPLATE_PRESETS } from '@/config/settingsSchema'
import { canResetField, fieldDomId, formatDraftValue } from '@/utils/settingsTabs'
import { resetToDefault, type DraftValue, type FieldDef, type SecretDraft, type ValidationError } from '@/utils/settingsModel'
import { t } from '@/i18n'

const props = defineProps<{
  field: FieldDef
  value: DraftValue
  error?: ValidationError | null
  changed?: boolean
  /** Briefly emphasised after a search jump / deep link. */
  highlighted?: boolean
  /** root fields */
  rootOptions?: string[]
  /** secret fields */
  configured?: boolean
  /** text fields: suggestions (datalist) */
  suggestions?: string[]
}>()
const emit = defineEmits<{ update: [value: DraftValue]; reset: [] }>()

const id = computed(() => fieldDomId(props.field.key))
const labelId = computed(() => `${id.value}-label`)
const hintId = computed(() => `${id.value}-hint`)
const errorId = computed(() => `${id.value}-error`)
const describedBy = computed(() => [props.field.hint ? hintId.value : '', props.error ? errorId.value : ''].filter(Boolean).join(' ') || undefined)
const errorText = computed(() => (props.error ? t(props.error.key, props.error.params) : ''))
const text = computed(() => (typeof props.value === 'string' ? props.value : ''))
const secret = computed(() => (props.field.type === 'secret' ? (props.value as SecretDraft) : { mode: 'keep' as const, value: '' }))
const reveal = ref(false)
const secretInput = ref<HTMLInputElement | null>(null)
// "Set up…/Change…" replaces the button with the input: move focus into it.
watch(
  () => secret.value.mode,
  async (mode, previous) => {
    if (mode === 'set' && previous !== 'set') {
      await nextTick()
      secretInput.value?.focus()
    }
    if (mode !== 'set') reveal.value = false
  },
)
const showReset = computed(() => canResetField(props.field, props.value))
const defaultText = computed(() => (props.field.default !== undefined && props.field.type !== 'secret' ? formatDraftValue(props.field, resetToDefault(props.field)) : ''))
const options = computed(() => {
  const list = props.field.options ?? []
  // Keep an unknown stored value selectable instead of silently showing another one.
  return text.value && props.field.type === 'select' && !list.some((o) => o.value === text.value) ? [{ value: text.value, label: text.value }, ...list] : list
})
const roots = computed(() => {
  const list = props.rootOptions ?? []
  return text.value && !list.includes(text.value) ? [text.value, ...list] : list
})
const multiline = computed(() => ['list', 'map', 'textarea'].includes(props.field.type))
/** Controls that are a group (no single input to point a <label for> at). */
const grouped = computed(() => props.field.type === 'checkboxes' || props.field.type === 'secret')

const CHIPS: Partial<Record<NonNullable<FieldDef['effect']>, { label: Parameters<typeof t>[0]; tone: string }>> = {
  'classic-only': { label: 'set.classicBadge', tone: '' },
  restart: { label: 'set.restartBadge', tone: 'lm-badge--warning' },
  'moves-files': { label: 'set.chip.movesFiles', tone: 'lm-badge--danger' },
  'relocates-settings': { label: 'set.chip.relocates', tone: 'lm-badge--danger' },
  'rebuilds-roots': { label: 'set.chip.rescan', tone: '' },
}
const chip = computed(() => (props.field.effect ? CHIPS[props.field.effect] : undefined))

function setSecret(next: SecretDraft): void {
  emit('update', next)
}

function toggleCheck(value: string, checked: boolean): void {
  const list = new Set(Array.isArray(props.value) ? props.value : [])
  if (checked) list.add(value)
  else list.delete(value)
  emit('update', [...list])
}
</script>

<template>
  <div
    :id="id + '-row'"
    class="relative grid scroll-mt-[calc(var(--lm-topbar-height)+var(--lm-space-8))] grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-x-6 gap-y-2 px-5 py-4 transition-colors duration-(--lm-motion-normal) tablet:grid-cols-1 phone:px-4"
    :class="highlighted ? 'bg-accent-soft' : ''"
    :data-key="field.key"
  >
    <span v-if="changed" class="absolute inset-y-3 left-0 w-[3px] rounded-pill bg-accent" aria-hidden="true"></span>

    <!-- Label, chips, help text -->
    <div class="flex min-w-0 flex-col gap-1">
      <div class="flex min-h-control-sm flex-wrap items-center gap-x-2 gap-y-1">
        <component :is="grouped ? 'span' : 'label'" :id="labelId" :for="grouped ? undefined : id" class="text-sm font-medium text-fg" :class="grouped ? '' : 'cursor-pointer'">
          {{ t(field.label) }}<span v-if="changed" class="sr-only"> ({{ t('set.changedDot') }})</span>
        </component>
        <span v-if="chip" class="lm-badge" :class="chip.tone">{{ t(chip.label) }}</span>
      </div>
      <p v-if="field.hint" :id="hintId" class="text-xs text-muted">{{ t(field.hint) }}</p>
    </div>

    <!-- Control + reset slot (fixed width, so controls line up whether or not Reset shows) -->
    <div class="flex min-w-0 items-start gap-2">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <!-- toggle -->
        <div v-if="field.type === 'toggle'" class="flex min-h-control items-center">
          <input
            :id="id"
            type="checkbox"
            role="switch"
            class="lm-switch"
            :checked="value === true"
            :aria-checked="value === true"
            :aria-describedby="describedBy"
            @change="emit('update', ($event.target as HTMLInputElement).checked)"
          />
        </div>

        <!-- select -->
        <select v-else-if="field.type === 'select'" :id="id" class="lm-select" :value="text" :aria-describedby="describedBy" @change="emit('update', ($event.target as HTMLSelectElement).value)">
          <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>

        <!-- root -->
        <select v-else-if="field.type === 'root'" :id="id" class="lm-select" :value="text" :aria-describedby="describedBy" @change="emit('update', ($event.target as HTMLSelectElement).value)">
          <option value="">{{ t('set.noRoot') }}</option>
          <option v-for="option in roots" :key="option" :value="option">{{ option }}</option>
        </select>

        <!-- number -->
        <input
          v-else-if="field.type === 'number'"
          :id="id"
          class="lm-input max-w-[200px] tabular-nums"
          type="number"
          inputmode="decimal"
          :min="field.min"
          :max="field.max"
          :step="field.step ?? (field.integer ? 1 : 'any')"
          :value="text"
          :aria-invalid="!!error"
          :aria-describedby="describedBy"
          @input="emit('update', ($event.target as HTMLInputElement).value)"
        />

        <!-- multi-line -->
        <textarea
          v-else-if="multiline"
          :id="id"
          class="lm-textarea min-h-[96px] font-mono text-xs"
          :rows="field.type === 'textarea' ? 3 : 4"
          spellcheck="false"
          :value="text"
          :aria-invalid="!!error"
          :aria-describedby="describedBy"
          @input="emit('update', ($event.target as HTMLTextAreaElement).value)"
        ></textarea>

        <!-- checkboxes -->
        <div v-else-if="field.type === 'checkboxes'" role="group" :aria-labelledby="labelId" class="flex min-h-control flex-wrap items-center gap-x-5 gap-y-2">
          <label v-for="option in field.options" :key="option.value" class="lm-check text-sm">
            <input type="checkbox" class="size-[16px]" :checked="Array.isArray(value) && value.includes(option.value)" @change="toggleCheck(option.value, ($event.target as HTMLInputElement).checked)" />
            {{ option.label }}
          </label>
        </div>

        <!-- secret: never shown; Configured / Not configured, Change… / Remove -->
        <div v-else-if="field.type === 'secret'" role="group" :aria-labelledby="labelId" class="flex flex-col gap-2">
          <div class="flex min-h-control flex-wrap items-center gap-2">
            <span class="lm-badge" :class="configured ? 'lm-badge--success' : ''">
              <AppIcon v-if="configured" name="check" :size="12" />{{ configured ? t('set.secret.configured') : t('set.secret.notConfigured') }}
            </span>
            <template v-if="secret.mode === 'keep'">
              <button type="button" class="lm-btn lm-btn--sm" @click="setSecret({ mode: 'set', value: '' })">{{ configured ? t('set.secret.change') : t('set.secret.setUp') }}</button>
              <button v-if="configured" type="button" class="lm-btn lm-btn--sm lm-btn--ghost text-danger" @click="setSecret({ mode: 'clear', value: '' })">{{ t('set.secret.clear') }}</button>
            </template>
            <template v-else>
              <span class="text-xs text-muted">{{ secret.mode === 'clear' ? t('set.secret.willClear') : t('set.secret.willSet') }}</span>
              <button type="button" class="lm-btn lm-btn--sm lm-btn--ghost" @click="setSecret({ mode: 'keep', value: '' })">{{ t('set.secret.cancel') }}</button>
            </template>
          </div>
          <div v-if="secret.mode === 'set'" class="relative flex max-w-[480px] items-center">
            <input
              :id="id"
              ref="secretInput"
              class="lm-input min-w-0 flex-1 pr-[44px] font-mono text-xs"
              :type="reveal ? 'text' : 'password'"
              autocomplete="new-password"
              spellcheck="false"
              :placeholder="t('set.secret.placeholder')"
              :value="secret.value"
              :aria-invalid="!!error"
              :aria-describedby="describedBy"
              :aria-label="t(field.label)"
              @input="setSecret({ mode: 'set', value: ($event.target as HTMLInputElement).value })"
            />
            <button
              type="button"
              class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm absolute right-1 text-muted"
              :aria-pressed="reveal"
              :aria-label="reveal ? t('set.secret.hide') : t('set.secret.show')"
              :title="reveal ? t('set.secret.hide') : t('set.secret.show')"
              @click="reveal = !reveal"
            >
              <AppIcon :name="reveal ? 'eyeOff' : 'eye'" :size="16" />
            </button>
          </div>
        </div>

        <!-- text, path, templates -->
        <template v-else>
          <input
            :id="id"
            class="lm-input"
            :class="field.type === 'text' ? '' : 'font-mono text-xs'"
            type="text"
            spellcheck="false"
            :placeholder="field.placeholder"
            :list="field.type === 'pathTemplate' || suggestions?.length ? `${id}-list` : undefined"
            :value="text"
            :aria-invalid="!!error"
            :aria-describedby="describedBy"
            @input="emit('update', ($event.target as HTMLInputElement).value)"
          />
          <datalist v-if="field.type === 'pathTemplate'" :id="`${id}-list`">
            <option v-for="preset in PATH_TEMPLATE_PRESETS.filter(Boolean)" :key="preset" :value="preset"></option>
          </datalist>
          <datalist v-else-if="suggestions?.length" :id="`${id}-list`">
            <option v-for="item in suggestions" :key="item" :value="item"></option>
          </datalist>
          <p v-if="field.type === 'pathTemplate' && !text.trim()" class="text-xs text-muted">{{ t('set.templateFlat') }}</p>
        </template>

        <p v-if="error" :id="errorId" class="flex items-center gap-1 text-xs text-danger" role="alert">
          <AppIcon name="alert" :size="12" class="flex-none" />{{ errorText }}
        </p>
        <slot />
      </div>

      <!-- Below the tablet breakpoint the slot only takes space when Reset shows (controls get the full width). -->
      <div class="flex min-h-control w-[68px] flex-none items-center justify-end tablet:w-auto">
        <button
          v-if="showReset"
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--sm px-2 text-muted hover:text-fg"
          :title="`${t('set.resetDefault')}: ${defaultText}`"
          :aria-label="t('set.resetDefaultOf', { label: t(field.label) })"
          @click="emit('reset')"
        >
          {{ t('set.resetField') }}
        </button>
      </div>
    </div>
  </div>
</template>
