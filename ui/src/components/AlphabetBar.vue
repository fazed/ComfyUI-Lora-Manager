<script setup lang="ts">
/**
 * First-letter filter (LoRAs: the list endpoint's `first_letter`). Collapsed
 * to one "A-Z" button by default (open state remembered in `lm-ui.alpha.open`);
 * the letters are toggle buttons, pressing the active one again clears it.
 * Every letter stays enabled: per-letter counts for the current filter need
 * a backend change (plan Phase 9).
 */
import { useLocalStorage } from '@vueuse/core'
import { ALPHABET, letterLabel } from '@/utils/alphabet'
import { t } from '@/i18n'

const letter = defineModel<string>({ required: true })
const props = defineProps<{ idPrefix: string }>()

const open = useLocalStorage('lm-ui.alpha.open', false, { writeDefaults: false })
const lettersId = `${props.idPrefix}-letters`

function label(value: string): string {
  const { key, params } = letterLabel(value)
  return t(key, params)
}

const letterClass =
  'inline-grid h-[1.5rem] min-w-[1.5rem] cursor-pointer place-items-center rounded-sm px-1 text-xs text-muted hover:bg-sunken hover:text-fg aria-pressed:bg-accent aria-pressed:font-bold aria-pressed:text-on-accent'
</script>

<template>
  <div class="flex min-w-0 items-center gap-1">
    <button
      type="button"
      class="lm-btn lm-btn--ghost lm-btn--sm flex-none font-mono"
      :class="{ 'text-fg': letter }"
      :aria-expanded="open"
      :aria-controls="lettersId"
      :aria-label="letter ? `${t('alpha.toggle')}: ${label(letter)}` : t('alpha.toggle')"
      :title="t('alpha.toggle')"
      @click="open = !open"
    >
      {{ letter || t('alpha.all') }}
    </button>
    <div v-show="open" :id="lettersId" class="flex min-w-0 flex-wrap gap-px" role="group" :aria-label="t('alpha.label')">
      <button
        v-for="value in ALPHABET"
        :key="value"
        type="button"
        :class="letterClass"
        :aria-pressed="letter === value"
        :aria-label="label(value)"
        :title="label(value)"
        @click="letter = letter === value ? '' : value"
      >
        {{ value }}
      </button>
    </div>
  </div>
</template>
