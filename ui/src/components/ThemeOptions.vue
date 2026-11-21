<script setup lang="ts">
/** Theme + density radio groups, used by the top-bar menu and Settings. */
import { useTheme, type Density } from '@/composables/useTheme'
import { SYSTEM_THEME } from '@/themes/registry'
import { t } from '@/i18n'

defineProps<{ compact?: boolean }>()

const { choice, density, available, setTheme, setDensity } = useTheme()
const densities: Density[] = ['comfortable', 'compact']
const name = `theme-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <div class="theme-options" :class="{ 'theme-options--compact': compact }">
    <fieldset class="theme-options__group">
      <legend class="lm-label">{{ t('theme.label') }}</legend>
      <label class="theme-options__option">
        <input type="radio" :name="name" :checked="choice === SYSTEM_THEME" @change="setTheme(SYSTEM_THEME)" />
        <span>{{ t('theme.system') }}</span>
      </label>
      <label v-for="theme in available" :key="theme.id" class="theme-options__option" :title="theme.description">
        <input type="radio" :name="name" :checked="choice === theme.id" @change="setTheme(theme.id)" />
        <span class="theme-options__swatch" :data-theme="theme.id" aria-hidden="true"><span></span></span>
        <span>{{ theme.label }}</span>
        <span v-if="theme.source === 'user'" class="lm-badge">{{ t('theme.user') }}</span>
      </label>
    </fieldset>
    <fieldset class="theme-options__group">
      <legend class="lm-label">{{ t('theme.density') }}</legend>
      <div class="theme-options__segmented">
        <label v-for="value in densities" :key="value" class="theme-options__segment">
          <input
            type="radio"
            :name="`${name}-density`"
            :checked="density === value"
            class="visually-hidden"
            @change="setDensity(value)"
          />
          <span>{{ t(value === 'compact' ? 'theme.compact' : 'theme.comfortable') }}</span>
        </label>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.theme-options {
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-4);
}

.theme-options__group {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

.theme-options__option {
  display: flex;
  align-items: center;
  gap: var(--lm-space-2);
  padding: var(--lm-space-1) var(--lm-space-2);
  border-radius: var(--lm-radius-sm);
  cursor: pointer;
}

.theme-options__option:hover {
  background: var(--lm-color-sunken);
}

.theme-options__option input {
  accent-color: var(--lm-color-accent);
  margin: 0;
}

/* The swatch carries data-theme itself, so it renders with that theme's tokens. */
.theme-options__swatch {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: var(--lm-border-width) solid var(--lm-color-border-strong);
  border-radius: var(--lm-radius-pill);
  background: var(--lm-color-bg);
}

.theme-options__swatch span {
  width: 8px;
  height: 8px;
  border-radius: var(--lm-radius-pill);
  background: var(--lm-color-accent);
}

.theme-options__segmented {
  display: flex;
  padding: 2px;
  border-radius: var(--lm-radius-sm);
  background: var(--lm-color-sunken);
}

.theme-options__segment {
  flex: 1;
}

.theme-options__segment span {
  display: block;
  padding: var(--lm-space-1) var(--lm-space-2);
  border-radius: var(--lm-radius-sm);
  text-align: center;
  font-size: var(--lm-font-size-sm);
  cursor: pointer;
  color: var(--lm-color-muted);
}

.theme-options__segment input:checked + span {
  background: var(--lm-color-surface);
  color: var(--lm-color-text);
  box-shadow: var(--lm-shadow-sm);
}

.theme-options__segment input:focus-visible + span {
  outline: var(--lm-focus-ring-width) solid var(--lm-color-focus);
}
</style>
