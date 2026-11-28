<script setup lang="ts">
/**
 * Bottom status bar of the app shell: refresh / scan state, the browse page's
 * result count (polite live region) and selection size, and the download
 * queue summary. Hidden on phones, where the bottom navigation takes the edge
 * (the phone toolbar keeps its own screen-reader count).
 */
import { computed } from 'vue'
import { useDownloadQueue } from '@/composables/useDownloadQueue'
import { pageStatus } from '@/composables/usePageStatus'
import { useRefresh } from '@/composables/useRefresh'
import { t } from '@/i18n'

const refresh = useRefresh()
const { active, waiting, paused } = useDownloadQueue(5000)

const scanText = computed(() => {
  if (!refresh.busy.value) return ''
  return refresh.phase.value === 'scanning' ? t('refresh.scanning') : t('refresh.busy')
})
const queueText = computed(() => {
  if (paused.value) return t('topbar.queuePaused')
  return active.value.length + waiting.value.length ? t('topbar.queue', { active: active.value.length, queued: waiting.value.length }) : ''
})
</script>

<template>
  <footer
    class="flex min-h-[1.75rem] flex-none items-center gap-5 hairline-t border-border bg-surface px-4 text-xs text-muted tabular-nums phone:hidden"
    :aria-label="t('status.label')"
  >
    <span v-if="scanText">{{ scanText }}</span>
    <span aria-live="polite">{{ pageStatus.count }}</span>
    <span v-if="pageStatus.selected">{{ t('library.selected', { count: pageStatus.selected }) }}</span>
    <RouterLink v-if="queueText" to="/downloads" class="ml-auto text-muted no-underline hover:text-fg">{{ queueText }}</RouterLink>
  </footer>
</template>
