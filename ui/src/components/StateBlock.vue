<script setup lang="ts">
/** Shared loading / error / empty placeholder. */
import AppIcon, { type IconName } from './AppIcon.vue'
import { t } from '@/i18n'

withDefaults(
  defineProps<{
    kind: 'loading' | 'error' | 'empty'
    title?: string
    message?: string
    icon?: IconName
  }>(),
  { title: '', message: '', icon: 'image' },
)
defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="state" :class="`state--${kind}`" :role="kind === 'error' ? 'alert' : 'status'">
    <div v-if="kind === 'loading'" class="state__spinner" aria-hidden="true"></div>
    <AppIcon v-else :name="kind === 'error' ? 'alert' : icon" :size="28" />
    <p class="state__title">{{ title || (kind === 'loading' ? t('common.loading') : kind === 'error' ? t('common.error') : t('library.emptyTitle')) }}</p>
    <p v-if="message" class="state__message">{{ message }}</p>
    <button v-if="kind === 'error'" type="button" class="lm-btn" @click="$emit('retry')">
      <AppIcon name="refresh" :size="16" />{{ t('common.retry') }}
    </button>
    <slot />
  </div>
</template>

<style scoped>
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lm-space-2);
  padding: var(--lm-space-8) var(--lm-space-4);
  color: var(--lm-color-muted);
  text-align: center;
}

.state--error {
  color: var(--lm-color-danger);
}

.state__title {
  margin: 0;
  color: var(--lm-color-text);
  font-weight: var(--lm-font-weight-medium);
}

.state__message {
  margin: 0;
  max-width: 48ch;
  font-size: var(--lm-font-size-sm);
  color: var(--lm-color-muted);
}

.state__spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--lm-color-border);
  border-top-color: var(--lm-color-accent);
  border-radius: var(--lm-radius-pill);
  animation: state-spin 0.8s linear infinite;
}

@keyframes state-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
