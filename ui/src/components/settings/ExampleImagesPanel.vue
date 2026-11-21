<script setup lang="ts">
/**
 * Library-wide example-image download (background job on the server) with
 * pause / resume / stop, polled every 2 s while it runs. Uses the SAVED
 * folder and optimize setting, not unsaved edits.
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useExampleDownload } from '@/composables/useExampleImages'
import { formatElapsed } from '@/utils/exampleImages'
import { t, type MessageKey } from '@/i18n'

const props = defineProps<{ savedPath: string; optimize: boolean }>()
const dl = useExampleDownload()
const { status, actionBusy } = dl
const running = computed(() => status.value.downloading)

onMounted(() => void dl.init())
onBeforeUnmount(() => dl.dispose())
void props
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="!savedPath" class="text-sm text-muted">{{ t('examples.needPath') }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <button v-if="!running" type="button" class="lm-btn lm-btn--sm lm-btn--primary" :disabled="!savedPath || actionBusy" @click="dl.start(optimize)">{{ t('examples.allStart') }}</button>
      <template v-else>
        <button v-if="status.state === 'paused'" type="button" class="lm-btn lm-btn--sm" :disabled="actionBusy" @click="dl.resume()">{{ t('examples.resume') }}</button>
        <button v-else type="button" class="lm-btn lm-btn--sm" :disabled="actionBusy || status.state === 'stopping'" @click="dl.pause()">{{ t('examples.pause') }}</button>
        <button type="button" class="lm-btn lm-btn--sm lm-btn--danger" :disabled="actionBusy || status.state === 'stopping'" @click="dl.stop()">{{ t('examples.stop') }}</button>
      </template>
      <span class="lm-badge" :class="status.state === 'error' ? 'lm-badge--danger' : status.state === 'completed' ? 'lm-badge--success' : running ? 'lm-badge--accent' : ''">
        {{ t(`examples.state.${status.state}` as MessageKey) }}
      </span>
    </div>
    <div v-if="running || status.total" class="flex flex-col gap-1" aria-live="polite">
      <div class="h-[8px] overflow-hidden rounded-pill bg-sunken" role="progressbar" :aria-valuenow="status.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="t('examples.progress', { completed: status.completed, total: status.total })">
        <div class="h-full bg-accent transition-[width]" :style="{ width: `${status.percent}%` }"></div>
      </div>
      <p class="text-xs text-muted">
        {{ t('examples.progress', { completed: status.completed, total: status.total }) }}
        <template v-if="status.elapsedSeconds"> · {{ t('examples.elapsed', { time: formatElapsed(status.elapsedSeconds) }) }}</template>
        <template v-if="status.failed"> · {{ t('examples.failed', { count: status.failed, retryable: status.retryable }) }}</template>
      </p>
      <p v-if="status.current && running" class="truncate text-xs text-muted">{{ t('examples.current', { name: status.current }) }}</p>
      <ul v-if="status.errors.length" class="text-xs text-danger">
        <li v-for="(err, i) in status.errors" :key="i" class="wrap-anywhere">{{ err }}</li>
      </ul>
    </div>
  </div>
</template>
