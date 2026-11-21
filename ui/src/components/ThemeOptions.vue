<script setup lang="ts">
/** Theme + density radio groups, used by the top-bar menu and Settings. */
import { useTheme, type Density } from '@/composables/useTheme'
import { SYSTEM_THEME } from '@/themes/registry'
import { t } from '@/i18n'

const { choice, density, available, setTheme, setDensity } = useTheme()
const densities: Density[] = ['comfortable', 'compact']
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
  </div>
</template>
