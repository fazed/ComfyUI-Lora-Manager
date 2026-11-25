<script setup lang="ts">
/**
 * "Replace or keep" prompt before an update is queued (mounted once in
 * App.vue, driven by `useReplaceChoice`). One owned file: a sentence naming
 * it. Several: a checkbox per file, only the newest owned one preselected.
 * Replace is disabled while nothing is ticked. "Don't ask again" applies to
 * Keep both only; Replace is never remembered.
 */
import { computed, ref, watch } from 'vue'
import ModalShell from './ModalShell.vue'
import { useReplaceChoice } from '@/composables/useReplaceChoice'
import { formatBytes } from '@/utils/format'
import { t } from '@/i18n'

const choice = useReplaceChoice()
const request = choice.pending
const picked = ref<Set<string>>(new Set())
const remember = ref(false)
const titleId = 'replace-choice-title'

watch(
  request,
  (value) => {
    picked.value = new Set(value?.initial ?? [])
    remember.value = false
  },
  { immediate: true },
)

const files = computed(() => request.value?.files ?? [])
const single = computed(() => files.value.length === 1)
const count = computed(() => picked.value.size)
const sizeText = (bytes: number | null) => (bytes ? formatBytes(bytes) : t('versions.delete.sizeUnknown'))
const versionText = (name: string | null) => name || t('updates.unknownVersion')
const folderText = (folder: string) => folder || t('versions.rootFolder')

function toggle(path: string, value: boolean): void {
  const next = new Set(picked.value)
  if (value) next.add(path)
  else next.delete(path)
  picked.value = next
}

function replace(): void {
  if (!count.value) return
  // Keep the dialog's order (newest first) in the request.
  const paths = files.value.map((file) => file.filePath).filter((path) => picked.value.has(path))
  choice.answer({ mode: 'replace', paths })
}
</script>

<template>
  <ModalShell
    v-if="request"
    :title="t('replace.title', { name: request.modelName, version: request.versionName })"
    :title-id="titleId"
    @close="choice.answer(null)"
  >
    <form class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5" data-testid="replace-dialog" @submit.prevent="replace">
      <p v-if="single" class="text-pretty">
        {{ t('replace.youHave', { version: versionText(files[0].versionName), file: files[0].fileName, size: sizeText(files[0].sizeBytes) }) }}
        <span class="block text-xs text-muted wrap-anywhere">{{ t('replace.fileFolder', { folder: folderText(files[0].folder) }) }}</span>
      </p>
      <fieldset v-else class="flex flex-col gap-2">
        <legend class="mb-2 text-pretty">{{ t('replace.youHaveMany') }}</legend>
        <label
          v-for="file in files"
          :key="file.filePath"
          class="flex min-h-control cursor-pointer items-start gap-2 rounded-md hairline border-border p-2 phone:min-h-touch"
        >
          <input
            type="checkbox"
            class="mt-1 flex-none"
            :checked="picked.has(file.filePath)"
            :data-path="file.filePath"
            @change="toggle(file.filePath, ($event.target as HTMLInputElement).checked)"
          />
          <span class="flex min-w-0 flex-col">
            <span class="wrap-anywhere">{{ t('replace.fileLabel', { version: versionText(file.versionName), file: file.fileName, size: sizeText(file.sizeBytes) }) }}</span>
            <span class="text-xs text-muted wrap-anywhere">{{ t('replace.fileFolder', { folder: folderText(file.folder) }) }}</span>
          </span>
        </label>
      </fieldset>

      <div class="flex flex-col gap-1 text-sm text-muted">
        <p class="text-pretty">{{ t('replace.explain') }}</p>
        <p>{{ t('replace.keepExplain') }}</p>
      </div>

      <label class="flex min-h-control cursor-pointer items-start gap-2 text-sm phone:min-h-touch">
        <input v-model="remember" type="checkbox" class="mt-1 flex-none" data-testid="replace-remember" aria-describedby="replace-remember-hint" />
        <span class="flex flex-col">
          <span>{{ t('replace.remember') }}</span>
          <span id="replace-remember-hint" class="text-xs text-muted">{{ t('replace.rememberHint') }}</span>
        </span>
      </label>

      <p v-if="!count" class="text-sm text-warning" role="status">{{ t('replace.noneSelected') }}</p>

      <div class="flex flex-wrap justify-end gap-2 phone:flex-col phone:items-stretch">
        <button type="button" class="lm-btn phone:min-h-touch" data-testid="replace-cancel" @click="choice.answer(null)">{{ t('replace.cancel') }}</button>
        <button type="button" class="lm-btn phone:min-h-touch" data-testid="replace-keep" autofocus @click="choice.answer({ mode: 'keep' }, remember)">
          {{ t('replace.keep') }}
        </button>
        <button type="submit" class="lm-btn lm-btn--danger phone:min-h-touch" data-testid="replace-confirm" :disabled="!count">
          {{ count > 1 ? t('replace.replaceCount', { count }) : t('replace.replace') }}
        </button>
      </div>
    </form>
  </ModalShell>
</template>
