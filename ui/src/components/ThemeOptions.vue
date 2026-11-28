<script setup lang="ts">
/** Theme, density, text size and highlight colour, used by the top-bar menu and Settings. */
import { computed } from 'vue'
import { useTheme, type Density } from '@/composables/useTheme'
import { TEXT_SCALES, useAppearance } from '@/composables/useAppearance'
import { BUILTIN_SURFACES, DEFAULT_HIGHLIGHT, HIGHLIGHT_PRESETS, resolveHighlight } from '@/themes/highlight'
import { SYSTEM_THEME } from '@/themes/registry'
import { t } from '@/i18n'

const { choice, density, available, activeTheme, setTheme, setDensity } = useTheme()
const { highlight, scale, setHighlight, setScale } = useAppearance()
const densities: Density[] = ['comfortable', 'compact']
// Swatches show the colour as it applies to the active scheme (after the contrast clamp).
const resolved = (id: string) => resolveHighlight(id, activeTheme.value.scheme, BUILTIN_SURFACES[activeTheme.value.scheme]).accent
const swatches = computed(() => HIGHLIGHT_PRESETS.map((preset) => ({ id: preset.id, color: resolved(preset.id) })))
const isCustom = computed(() => highlight.value.startsWith('#'))
const customValue = computed(() => (isCustom.value ? highlight.value : resolved(highlight.value)))
// A custom colour the contrast clamp changed: say what it became.
const adjusted = computed(() => (isCustom.value && resolved(highlight.value) !== highlight.value.toLowerCase() ? resolved(highlight.value) : ''))
const name = `theme-${Math.random().toString(36).slice(2, 8)}`
const optionClass = 'lm-row flex cursor-pointer items-center gap-2 px-2 py-1'
</script>

<template>
  <div class="flex flex-col gap-4">
    <fieldset class="min-w-0">
      <legend class="lm-label">{{ t('theme.label') }}</legend>
      <label :class="optionClass">
        <input type="radio" class="m-0 accent-accent" :name="name" :checked="choice === SYSTEM_THEME" @change="setTheme(SYSTEM_THEME)" />
        <span>{{ t('theme.system') }}</span>
      </label>
      <label v-for="theme in available" :key="theme.id" :class="optionClass" :title="theme.description">
        <input type="radio" class="m-0 accent-accent" :name="name" :checked="choice === theme.id" @change="setTheme(theme.id)" />
        <!-- The swatch carries data-theme itself, so it renders with that theme's tokens. -->
        <span
          class="inline-grid size-[18px] place-items-center rounded-pill hairline border-border-strong bg-page"
          :data-theme="theme.id"
          aria-hidden="true"
        >
          <span class="size-[8px] rounded-pill bg-accent"></span>
        </span>
        <span>{{ theme.label }}</span>
        <span v-if="theme.source === 'user'" class="lm-badge">{{ t('theme.user') }}</span>
      </label>
    </fieldset>
    <fieldset class="min-w-0">
      <legend class="lm-label">{{ t('theme.density') }}</legend>
      <div class="flex rounded-sm bg-sunken p-[2px]">
        <label v-for="value in densities" :key="value" class="flex-1">
          <input
            type="radio"
            :name="`${name}-density`"
            :checked="density === value"
            class="peer sr-only"
            @change="setDensity(value)"
          />
          <span
            class="block cursor-pointer rounded-sm px-2 py-1 text-center text-sm text-muted peer-checked:bg-surface peer-checked:text-fg peer-checked:shadow-sm peer-focus-visible:focus-ring"
          >
            {{ t(value === 'compact' ? 'theme.compact' : 'theme.comfortable') }}
          </span>
        </label>
      </div>
    </fieldset>
    <fieldset class="min-w-0">
      <legend class="lm-label">{{ t('appearance.textSize') }}</legend>
      <div class="flex rounded-sm bg-sunken p-[2px]">
        <label v-for="value in TEXT_SCALES" :key="value" class="flex-1" :title="t(`appearance.scale.${value}Label`)">
          <input
            type="radio"
            :name="`${name}-scale`"
            :checked="scale === value"
            :aria-label="t(`appearance.scale.${value}Label`)"
            class="peer sr-only"
            @change="setScale(value)"
          />
          <span
            class="block cursor-pointer rounded-sm px-2 py-1 text-center text-sm text-muted peer-checked:bg-surface peer-checked:text-fg peer-checked:shadow-sm peer-focus-visible:focus-ring"
            aria-hidden="true"
          >
            {{ t(`appearance.scale.${value}`) }}
          </span>
        </label>
      </div>
    </fieldset>
    <fieldset class="min-w-0">
      <legend class="lm-label">{{ t('appearance.highlight') }}</legend>
      <div class="flex flex-wrap gap-1">
        <label v-for="swatch in swatches" :key="swatch.id" :title="t(`appearance.highlight.${swatch.id}`)">
          <input
            type="radio"
            :name="`${name}-highlight`"
            :checked="highlight === swatch.id"
            :aria-label="t(`appearance.highlight.${swatch.id}`)"
            class="peer sr-only"
            @change="setHighlight(swatch.id)"
          />
          <span
            class="block size-[28px] cursor-pointer rounded-pill hairline border-border-strong p-[3px] peer-checked:ring-selected peer-focus-visible:focus-ring"
            aria-hidden="true"
          >
            <span class="block size-full rounded-pill" :style="{ backgroundColor: swatch.color }"></span>
          </span>
        </label>
      </div>
      <div class="mt-2 flex items-center gap-2">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="color"
            class="h-control-sm w-[44px] cursor-pointer rounded-sm hairline border-field-border bg-field p-[2px]"
            :value="customValue"
            @input="setHighlight(($event.target as HTMLInputElement).value)"
          />
          {{ t('appearance.highlight.custom') }}
        </label>
        <button
          type="button"
          class="lm-btn lm-btn--sm lm-btn--ghost ml-auto"
          :disabled="highlight === DEFAULT_HIGHLIGHT"
          @click="setHighlight(DEFAULT_HIGHLIGHT)"
        >
          {{ t('appearance.highlight.reset') }}
        </button>
      </div>
      <p v-if="adjusted" class="lm-hint flex items-center gap-2" role="status" data-testid="highlight-adjusted">
        <span class="size-[12px] flex-none rounded-pill hairline border-border-strong" :style="{ backgroundColor: adjusted }" aria-hidden="true"></span>
        {{ t('appearance.highlight.adjusted', { color: adjusted }) }}
      </p>
      <p class="lm-hint">{{ t('appearance.highlight.note') }}</p>
    </fieldset>
  </div>
</template>
