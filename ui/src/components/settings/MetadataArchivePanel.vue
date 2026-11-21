<script setup lang="ts">
/** Metadata archive database: status, download (multi-GB, confirm) and removal (confirm). */
import { onMounted } from 'vue'
import { useMetadataArchive } from '@/composables/useMaintenance'
import { formatBytes } from '@/utils/format'
import { t } from '@/i18n'

const emit = defineEmits<{ changed: [] }>()
const archive = useMetadataArchive()
const { status, busy, error } = archive

async function download(): Promise<void> {
  if (await archive.download()) emit('changed')
}
async function remove(): Promise<void> {
  if (await archive.remove()) emit('changed')
}

onMounted(() => void archive.load())
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="error" class="lm-error-text" role="alert">{{ error }}</p>
    <div v-if="status" class="flex flex-wrap gap-2 text-sm">
      <span class="lm-badge" :class="status.available ? 'lm-badge--success' : ''">{{ status.available ? t('archive.available', { size: formatBytes(status.size) }) : t('archive.missing') }}</span>
      <span class="lm-badge" :class="status.enabled ? 'lm-badge--accent' : ''">{{ status.enabled ? t('archive.enabled') : t('archive.disabled') }}</span>
    </div>
    <p v-if="busy === 'download'" class="flex items-center gap-2 text-sm" role="status">
      <span class="size-[14px] animate-spinner rounded-pill border-2 border-border border-t-accent" aria-hidden="true"></span>{{ t('archive.downloading') }}
    </p>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="lm-btn lm-btn--sm" :disabled="!!busy || status?.available" @click="download">{{ t('archive.download') }}</button>
      <button type="button" class="lm-btn lm-btn--sm lm-btn--danger" :disabled="!!busy || !status?.available" @click="remove">{{ t('archive.remove') }}</button>
    </div>
  </div>
</template>
