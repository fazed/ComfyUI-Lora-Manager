<script setup lang="ts">
/**
 * One entry of the Updates page's Ignored view: an ignored model (all its
 * versions) or one ignored version, with Restore.
 */
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { formatBytes, formatDate } from '@/utils/format'
import type { IgnoredEntry } from '@/utils/updates'
import { t } from '@/i18n'

const props = defineProps<{ entry: IgnoredEntry; busy: boolean }>()
const emit = defineEmits<{ restore: [] }>()

const name = computed(() => props.entry.group.modelName || t('updates.unknownVersion'))
const version = computed(() =>
  props.entry.kind === 'model' ? t('updates.ignored.allVersions') : props.entry.candidate.name || t('updates.unknownVersion'),
)
const candidate = computed(() => (props.entry.kind === 'version' ? props.entry.candidate : null))
const headingId = computed(() => `ignored-${props.entry.key.replace(/[^a-z0-9-]/gi, '-')}`)
</script>

<template>
  <li class="lm-panel flex items-center gap-3 p-3 phone:flex-wrap" :aria-labelledby="headingId">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <h3 :id="headingId" class="min-w-0 truncate text-md font-bold" :title="name">{{ name }}</h3>
        <span v-if="entry.group.baseModel && entry.kind === 'version'" class="lm-badge">{{ entry.group.baseModel }}</span>
        <span class="lm-badge">{{ t('updates.ignored') }}</span>
      </div>
      <p class="text-sm tabular-nums">
        <span class="text-fg">{{ version }}</span>
        <template v-if="candidate">
          <span class="ml-2 text-muted">{{ formatDate(candidate.releasedAt) }}</span>
          <span v-if="candidate.sizeBytes" class="ml-2 text-muted">{{ formatBytes(candidate.sizeBytes) }}</span>
        </template>
      </p>
      <p class="text-xs text-muted">
        {{ entry.kind === 'model' ? t('updates.ignored.modelNote') : t('updates.ignored.versionNote') }}
      </p>
    </div>
    <button
      type="button"
      class="lm-btn phone:ml-auto phone:min-h-touch"
      :disabled="busy"
      :aria-label="t('updates.restoreLabel', { name, version })"
      @click="emit('restore')"
    >
      <AppIcon name="eye" :size="16" />{{ t('updates.restore') }}
    </button>
  </li>
</template>
