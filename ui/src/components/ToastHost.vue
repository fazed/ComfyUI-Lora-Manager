<script setup lang="ts">
import AppIcon, { type IconName } from './AppIcon.vue'
import { useToasts, type ToastKind } from '@/composables/useFeedback'
import { t } from '@/i18n'

const { toasts, dismiss } = useToasts()

/** Per-kind accent: left border color and icon. */
const KIND: Record<ToastKind, { border: string; icon: IconName; iconClass: string }> = {
  info: { border: 'border-l-accent', icon: 'sparkle', iconClass: '' },
  success: { border: 'border-l-success', icon: 'check', iconClass: 'text-success' },
  error: { border: 'border-l-danger', icon: 'alert', iconClass: 'text-danger' },
}
</script>

<template>
  <div
    class="fixed right-4 bottom-4 z-90 flex max-w-[min(420px,calc(100vw-var(--lm-space-8)))] flex-col gap-2"
    role="status"
    aria-live="polite"
  >
    <TransitionGroup
      enter-active-class="transition-[opacity,translate] duration-(--lm-motion-normal)"
      leave-active-class="transition-[opacity,translate] duration-(--lm-motion-normal)"
      enter-from-class="translate-y-[8px] opacity-0"
      leave-to-class="translate-y-[8px] opacity-0"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="flex items-center gap-2 rounded-md hairline border-l-4 border-border bg-elevated py-2 pr-2 pl-3 text-sm shadow-md"
        :class="KIND[toast.kind].border"
      >
        <AppIcon :name="KIND[toast.kind].icon" :class="KIND[toast.kind].iconClass" />
        <span class="flex-1">{{ toast.message }}</span>
        <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm" :aria-label="t('common.close')" @click="dismiss(toast.id)">
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
