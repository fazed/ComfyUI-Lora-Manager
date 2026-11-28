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
  <div
    class="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center"
    :class="kind === 'error' ? 'text-danger' : 'text-muted'"
    :role="kind === 'error' ? 'alert' : 'status'"
  >
    <div
      v-if="kind === 'loading'"
      class="size-[1.75rem] animate-spinner rounded-pill border-[3px] border-border border-t-accent"
      aria-hidden="true"
    ></div>
    <AppIcon v-else :name="kind === 'error' ? 'alert' : icon" :size="28" />
    <p class="font-medium text-fg">
      {{ title || (kind === 'loading' ? t('common.loading') : kind === 'error' ? t('common.error') : t('library.emptyTitle')) }}
    </p>
    <p v-if="message" class="max-w-[48ch] text-sm text-muted">{{ message }}</p>
    <button v-if="kind === 'error'" type="button" class="lm-btn" @click="$emit('retry')">
      <AppIcon name="refresh" :size="16" />{{ t('common.retry') }}
    </button>
    <slot />
  </div>
</template>
