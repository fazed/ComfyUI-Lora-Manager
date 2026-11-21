<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { useToasts } from '@/composables/useFeedback'
import { t } from '@/i18n'

const { toasts, dismiss } = useToasts()
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast--${toast.kind}`">
        <AppIcon :name="toast.kind === 'error' ? 'alert' : toast.kind === 'success' ? 'check' : 'sparkle'" />
        <span class="toast__text">{{ toast.message }}</span>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('common.close')" @click="dismiss(toast.id)">
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: var(--lm-space-4);
  bottom: var(--lm-space-4);
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-2);
  max-width: min(420px, calc(100vw - var(--lm-space-8)));
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--lm-space-2);
  padding: var(--lm-space-2) var(--lm-space-2) var(--lm-space-2) var(--lm-space-3);
  border: var(--lm-border-width) solid var(--lm-color-border);
  border-left-width: 4px;
  border-radius: var(--lm-radius-md);
  background: var(--lm-color-elevated);
  box-shadow: var(--lm-shadow-md);
  font-size: var(--lm-font-size-sm);
}

.toast--success {
  border-left-color: var(--lm-color-success);
}

.toast--success > .lm-icon {
  color: var(--lm-color-success);
}

.toast--error {
  border-left-color: var(--lm-color-danger);
}

.toast--error > .lm-icon {
  color: var(--lm-color-danger);
}

.toast--info {
  border-left-color: var(--lm-color-accent);
}

.toast__text {
  flex: 1;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--lm-motion-normal) var(--lm-ease),
    transform var(--lm-motion-normal) var(--lm-ease);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
