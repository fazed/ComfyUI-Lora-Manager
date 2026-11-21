<script setup lang="ts">
/**
 * One schema-driven settings control (toggle, select, number, text, path,
 * list, map, template, root select, checkboxes, secret). Secrets are never
 * pre-filled: they show "Configured" and take a new value in a password
 * input, or are removed explicitly.
 */
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { PATH_TEMPLATE_PRESETS } from '@/config/settingsSchema'
import type { DraftValue, FieldDef, SecretDraft, ValidationError } from '@/utils/settingsModel'
import { t } from '@/i18n'

const props = defineProps<{
  field: FieldDef
  value: DraftValue
  error?: ValidationError | null
  changed?: boolean
  /** root fields */
  rootOptions?: string[]
  /** secret fields */
  configured?: boolean
  /** text fields: suggestions (datalist) */
  suggestions?: string[]
}>()
const emit = defineEmits<{ update: [value: DraftValue]; reset: [] }>()

const id = computed(() => `field-${props.field.key.replace(/[^\w-]/g, '_')}`)
const hintId = computed(() => `${id.value}-hint`)
const errorId = computed(() => `${id.value}-error`)
const describedBy = computed(() => [props.field.hint ? hintId.value : '', props.error ? errorId.value : ''].filter(Boolean).join(' ') || undefined)
const errorText = computed(() => (props.error ? t(props.error.key, props.error.params) : ''))
const text = computed(() => (typeof props.value === 'string' ? props.value : ''))
const secret = computed(() => (props.field.type === 'secret' ? (props.value as SecretDraft) : { mode: 'keep' as const, value: '' }))
const reveal = ref(false)
const canReset = computed(() => props.field.default !== undefined && props.field.type !== 'secret')
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
  <div :id="id + '-row'" class="flex min-w-0 flex-col gap-1 scroll-mt-[calc(var(--lm-topbar-height)+var(--lm-space-6))]" :data-key="field.key">
    <!-- toggle -->
    <div v-if="field.type === 'toggle'" class="flex items-start gap-2">
      <label class="lm-check min-w-0 flex-1">
        <input :id="id" type="checkbox" :checked="value === true" :aria-describedby="describedBy" @change="emit('update', ($event.target as HTMLInputElement).checked)" />
        <span>{{ t(field.label) }}</span>
        <span v-if="field.effect === 'classic-only'" class="lm-badge">{{ t('set.classicBadge') }}</span>
        <span v-if="field.effect === 'restart'" class="lm-badge lm-badge--warning">{{ t('set.restartBadge') }}</span>
        <span v-if="changed" class="size-[8px] rounded-pill bg-accent" :title="t('set.changedDot')" :aria-label="t('set.changedDot')"></span>
      </label>
      <button v-if="canReset" type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm text-muted" :title="t('set.resetDefault')" :aria-label="t('set.resetDefaultOf', { label: t(field.label) })" @click="emit('reset')">
        <AppIcon name="refresh" :size="14" />
      </button>
    </div>

    <template v-else>
      <div class="flex items-center gap-2">
        <component :is="field.type === 'checkboxes' || field.type === 'secret' ? 'span' : 'label'" class="lm-label mb-0 flex min-w-0 flex-1 flex-wrap items-center gap-2" :for="field.type === 'checkboxes' || field.type === 'secret' ? undefined : id" :id="`${id}-label`">
          {{ t(field.label) }}
          <span v-if="field.effect === 'classic-only'" class="lm-badge">{{ t('set.classicBadge') }}</span>
          <span v-if="field.effect === 'restart'" class="lm-badge lm-badge--warning">{{ t('set.restartBadge') }}</span>
          <span v-if="changed" class="size-[8px] rounded-pill bg-accent" :title="t('set.changedDot')" :aria-label="t('set.changedDot')"></span>
        </component>
        <button v-if="canReset" type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm text-muted" :title="t('set.resetDefault')" :aria-label="t('set.resetDefaultOf', { label: t(field.label) })" @click="emit('reset')">
          <AppIcon name="refresh" :size="14" />
        </button>
      </div>

      <!-- select -->
      <select v-if="field.type === 'select'" :id="id" class="lm-select" :value="text" :aria-describedby="describedBy" @change="emit('update', ($event.target as HTMLSelectElement).value)">
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
        class="lm-input max-w-[200px]"
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
        class="lm-textarea min-h-[84px] font-mono text-xs"
        :rows="field.type === 'textarea' ? 3 : 4"
        spellcheck="false"
        :value="text"
        :aria-invalid="!!error"
        :aria-describedby="describedBy"
        @input="emit('update', ($event.target as HTMLTextAreaElement).value)"
      ></textarea>

      <!-- checkboxes -->
      <div v-else-if="field.type === 'checkboxes'" role="group" :aria-labelledby="`${id}-label`" class="flex flex-wrap gap-x-4 gap-y-1">
        <label v-for="option in field.options" :key="option.value" class="lm-check">
          <input type="checkbox" :checked="Array.isArray(value) && value.includes(option.value)" @change="toggleCheck(option.value, ($event.target as HTMLInputElement).checked)" />
          {{ option.label }}
        </label>
      </div>

      <!-- secret -->
      <div v-else-if="field.type === 'secret'" role="group" :aria-labelledby="`${id}-label`" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="lm-badge" :class="configured ? 'lm-badge--success' : ''">{{ configured ? t('set.secret.configured') : t('set.secret.notConfigured') }}</span>
          <template v-if="secret.mode === 'keep'">
            <button type="button" class="lm-btn lm-btn--sm" @click="setSecret({ mode: 'set', value: '' })">{{ configured ? t('set.secret.change') : t('set.secret.setUp') }}</button>
            <button v-if="configured" type="button" class="lm-btn lm-btn--sm lm-btn--ghost text-danger" @click="setSecret({ mode: 'clear', value: '' })">{{ t('set.secret.clear') }}</button>
          </template>
          <template v-else>
            <span class="text-xs text-muted">{{ secret.mode === 'clear' ? t('set.secret.willClear') : t('set.secret.willSet') }}</span>
            <button type="button" class="lm-btn lm-btn--sm lm-btn--ghost" @click="setSecret({ mode: 'keep', value: '' })">{{ t('set.secret.cancel') }}</button>
          </template>
        </div>
        <div v-if="secret.mode === 'set'" class="flex max-w-[480px] items-center gap-2">
          <input
            :id="id"
            class="lm-input min-w-0 flex-1 font-mono text-xs"
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
          <button type="button" class="lm-btn lm-btn--icon lm-btn--sm" :aria-pressed="reveal" :aria-label="reveal ? t('set.secret.hide') : t('set.secret.show')" @click="reveal = !reveal">
            <AppIcon name="eye" :size="14" />
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
        <p v-if="field.type === 'pathTemplate' && !text.trim()" class="lm-hint">{{ t('set.templateFlat') }}</p>
      </template>
    </template>

    <slot />
    <p v-if="error" :id="errorId" class="lm-error-text" role="alert">{{ errorText }}</p>
    <p v-if="field.hint" :id="hintId" class="lm-hint">{{ t(field.hint) }}</p>
  </div>
</template>
