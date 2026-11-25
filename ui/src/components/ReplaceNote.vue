<script setup lang="ts">
/**
 * The replace request of a queue / history row: "Will replace <file> when
 * finished" while it waits, then "Replaced <file>" (with Restore while the
 * staged copy can still be undone) or "Kept <file>: could not replace
 * (<reason>)". Renders nothing for a row without a replace request.
 */
import { computed, ref } from 'vue'
import { useNow } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import { undoDelete } from '@/api/endpoints'
import type { QueueItem } from '@/api/types'
import { useToasts } from '@/composables/useFeedback'
import { replaceInfoOf, replaceLines, type ReplaceTarget } from '@/utils/versionManagement'
import { t } from '@/i18n'

const props = defineProps<{ item: QueueItem | null }>()
const emit = defineEmits<{ restored: [path: string] }>()

const toasts = useToasts()
// Seconds are enough: the Restore button only has to disappear before the purge.
const now = useNow({ interval: 15_000 })
const restoring = ref<string | null>(null)
const restored = ref<Set<string>>(new Set())

const lines = computed(() =>
  replaceLines(replaceInfoOf(props.item), props.item?.status, now.value.getTime() / 1000).map((line) => ({
    ...line,
    restore: line.restore && !restored.value.has(line.restore.path) ? line.restore : null,
  })),
)
const toneClass = { muted: 'text-muted', success: 'text-success', warning: 'text-warning' } as const

async function restore(target: ReplaceTarget): Promise<void> {
  if (!target.batchId || restoring.value) return
  restoring.value = target.path
  try {
    await undoDelete(target.batchId)
    restored.value = new Set([...restored.value, target.path])
    toasts.success(t('replace.row.restored', { file: target.fileName }))
    emit('restored', target.path)
  } catch (error) {
    toasts.error(t('replace.row.restoreFailed', { file: target.fileName, error: (error as Error)?.message || '' }))
  } finally {
    restoring.value = null
  }
}
</script>

<template>
  <ul v-if="lines.length" class="flex flex-col gap-1 text-xs" data-testid="replace-note">
    <li v-for="line in lines" :key="line.key" class="flex flex-wrap items-center gap-2">
      <AppIcon name="refresh" :size="12" class="flex-none" :class="toneClass[line.tone]" />
      <span class="min-w-0 wrap-anywhere" :class="toneClass[line.tone]">{{ line.text }}</span>
      <button
        v-if="line.restore"
        type="button"
        class="lm-btn lm-btn--ghost lm-btn--sm phone:min-h-touch"
        :aria-label="t('replace.row.restoreLabel', { file: line.restore.fileName })"
        :disabled="restoring === line.restore.path"
        @click="restore(line.restore)"
      >
        {{ t('replace.row.restorable') }}
      </button>
    </li>
  </ul>
</template>
