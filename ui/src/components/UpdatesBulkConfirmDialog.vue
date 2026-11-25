<script setup lang="ts">
/**
 * Summary confirm of "Update selected": what is queued (count, size,
 * folders) and, per row, what happens to the old version: Keep (default for
 * every row, never preselected otherwise) or Replace the newest file you own
 * of that line once the new download is verified. "Keep all" / "Replace all"
 * set every row that has an old file.
 */
import { computed, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import type { BulkItem } from '@/utils/updates'
import { bulkConfirmMessage, summarizeBulk } from '@/utils/updates'
import { defaultReplaceSelection, ownedFilesForGroup } from '@/utils/versionManagement'
import { t } from '@/i18n'

const props = defineProps<{ items: BulkItem[] }>()
const emit = defineEmits<{ confirm: [items: BulkItem[]]; cancel: [] }>()

const rows = computed(() =>
  props.items.map((item) => {
    const files = ownedFilesForGroup(item.group, item.candidate)
    const [path] = defaultReplaceSelection(files)
    const file = files.find((entry) => entry.filePath === path) ?? null
    return { item, file }
  }),
)
/** Row keys set to Replace. Starts empty: Keep for every row. */
const replacing = ref<Set<string>>(new Set())
const replaceCount = computed(() => rows.value.filter((row) => row.file && replacing.value.has(row.item.key)).length)
const message = computed(() => bulkConfirmMessage(summarizeBulk(props.items), replaceCount.value))
const replaceable = computed(() => rows.value.filter((row) => row.file))

function setRow(key: string, replace: boolean): void {
  const next = new Set(replacing.value)
  if (replace) next.add(key)
  else next.delete(key)
  replacing.value = next
}

function setAll(replace: boolean): void {
  replacing.value = replace ? new Set(replaceable.value.map((row) => row.item.key)) : new Set()
}

function confirm(): void {
  emit(
    'confirm',
    rows.value.map((row) =>
      row.file && replacing.value.has(row.item.key) ? { ...row.item, replacePaths: [row.file.filePath] } : { ...row.item, replacePaths: undefined },
    ),
  )
}
</script>

<template>
  <ModalShell
    :title="t('updates.bulk.confirmTitle', { count: items.length, models: items.length === 1 ? t('updates.model') : t('updates.models') })"
    title-id="bulk-update-confirm-title"
    wide
    @close="emit('cancel')"
  >
    <form class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5" data-testid="bulk-confirm" @submit.prevent="confirm">
      <p class="whitespace-pre-line text-muted" data-testid="bulk-confirm-message">{{ message }}</p>

      <section v-if="replaceable.length" class="flex flex-col gap-2" aria-labelledby="bulk-replace-heading">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 id="bulk-replace-heading" class="text-md">{{ t('replace.bulk.heading') }}</h3>
          <div class="flex gap-2">
            <button type="button" class="lm-btn lm-btn--sm phone:min-h-touch" data-testid="bulk-keep-all" @click="setAll(false)">
              {{ t('replace.bulk.keepAll') }}
            </button>
            <button type="button" class="lm-btn lm-btn--sm phone:min-h-touch" data-testid="bulk-replace-all" @click="setAll(true)">
              {{ t('replace.bulk.replaceAll') }}
            </button>
          </div>
        </div>
        <p class="text-sm text-muted text-pretty">{{ t('replace.bulk.hint') }}</p>
        <ul class="flex flex-col gap-1">
          <li
            v-for="row in rows"
            :key="row.item.key"
            class="flex flex-wrap items-center gap-2 rounded-md hairline border-border p-2"
          >
            <span class="min-w-0 flex-1 wrap-anywhere">
              {{ row.item.group.modelName }} <span class="text-muted">{{ row.item.candidate.name }}</span>
            </span>
            <select
              v-if="row.file"
              class="lm-input w-auto max-w-full phone:min-h-touch phone:w-full"
              :aria-label="t('replace.bulk.rowLabel', { name: row.item.group.modelName || '' })"
              :value="replacing.has(row.item.key) ? 'replace' : 'keep'"
              :data-testid="`bulk-row-${row.item.key}`"
              @change="setRow(row.item.key, ($event.target as HTMLSelectElement).value === 'replace')"
            >
              <option value="keep">{{ t('replace.bulk.keepRow') }}</option>
              <option value="replace">{{ t('replace.bulk.replaceRow', { file: row.file.fileName }) }}</option>
            </select>
            <span v-else class="text-xs text-muted">{{ t('replace.bulk.noOld') }}</span>
          </li>
        </ul>
        <p class="text-xs text-muted text-pretty">{{ t('replace.explain') }}</p>
      </section>

      <div class="flex flex-wrap justify-end gap-2 phone:flex-col phone:items-stretch">
        <button type="button" class="lm-btn phone:min-h-touch" autofocus @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button type="submit" class="lm-btn phone:min-h-touch" :class="replaceCount ? 'lm-btn--danger' : 'lm-btn--primary'" data-testid="bulk-confirm-submit">
          {{ t('updates.bulk.confirm', { count: items.length }) }}
        </button>
      </div>
    </form>
  </ModalShell>
</template>
