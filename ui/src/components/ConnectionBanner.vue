<script setup lang="ts">
/**
 * Shell banner above every page while Civitai work cannot run: the browser is
 * offline (`navigator.onLine`), or the download worker is in its Civitai
 * rate-limit cooldown (`worker.rate_limited` / `retry_after` of the polled
 * download queue). Retry re-reads the queue state; the banner leaves on its
 * own once the condition clears. No request of its own beyond that poll.
 */
import { computed } from 'vue'
import { useOnline } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import { useDownloadQueue } from '@/composables/useDownloadQueue'
import { t } from '@/i18n'

const online = useOnline()
const { worker, refresh } = useDownloadQueue(5000)

const message = computed(() => {
  if (!online.value) return t('banner.offline')
  if (!worker.value?.rate_limited) return ''
  const seconds = worker.value.retry_after ?? 0
  return seconds > 0 ? t('banner.rateLimitedIn', { seconds }) : t('banner.rateLimited')
})
</script>

<template>
  <div
    v-if="message"
    class="flex flex-none items-center gap-3 hairline-b border-warning bg-warning-soft px-4 py-2 text-sm text-warning"
    role="status"
    :aria-label="t('banner.label')"
    data-testid="connection-banner"
  >
    <AppIcon name="alert" :size="16" class="flex-none" />
    <span class="min-w-0 flex-1">{{ message }}</span>
    <button type="button" class="lm-btn lm-btn--sm flex-none" @click="refresh()">
      <AppIcon name="refresh" :size="14" />{{ t('common.retry') }}
    </button>
  </div>
</template>
