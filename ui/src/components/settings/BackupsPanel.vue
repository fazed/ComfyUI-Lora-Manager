<script setup lang="ts">
/**
 * Backups: the stored snapshots (auto backups, newest first), "Download a
 * backup now" (export = download, nothing stays on the server) and the
 * restore dialog with a typed confirm that lists every file it overwrites.
 * There is no delete endpoint; see ui/README.md.
 */
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import ModalShell from '@/components/ModalShell.vue'
import StateBlock from '@/components/StateBlock.vue'
import { useBackups } from '@/composables/useMaintenance'
import { formatBytes } from '@/utils/format'
import { RESTORED_FILES, RESTORE_CONFIRM_WORD, restoreConfirmed, validateBackupFile } from '@/utils/maintenance'
import { t } from '@/i18n'

const backups = useBackups()
const { status, loading, busy, error } = backups
const restoreOpen = ref(false)
const file = ref<File | null>(null)
const typed = ref('')
const fileError = computed(() => (file.value ? validateBackupFile(file.value) : null))
const canRestore = computed(() => !!file.value && !fileError.value && restoreConfirmed(typed.value) && !busy.value)

function openRestore(): void {
  file.value = null
  typed.value = ''
  error.value = null
  restoreOpen.value = true
}

async function doRestore(): Promise<void> {
  if (!canRestore.value) return
  if (await backups.restore(file.value, typed.value)) restoreOpen.value = false
}

const when = (mtime: number) => (mtime ? new Date(mtime * 1000).toLocaleString() : '-')

onMounted(() => void backups.load())
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap gap-2">
      <button type="button" class="lm-btn lm-btn--primary" :disabled="!!busy" :title="t('backups.exportHint')" @click="backups.exportNow()">
        <AppIcon name="download" :size="16" />{{ t('backups.export') }}
      </button>
      <button type="button" class="lm-btn lm-btn--danger" :disabled="!!busy" @click="openRestore">
        <AppIcon name="upload" :size="16" />{{ t('backups.restore') }}
      </button>
      <button type="button" class="lm-btn lm-btn--ghost" :disabled="!!busy" @click="backups.openFolder()">
        <AppIcon name="folder" :size="16" />{{ t('backups.openFolder') }}
      </button>
    </div>
    <p class="lm-hint">{{ t('backups.exportHint') }}</p>

    <h3 class="text-sm font-medium">{{ t('backups.list') }}</h3>
    <StateBlock v-if="loading && !status" kind="loading" />
    <p v-else-if="error && !restoreOpen" class="lm-error-text" role="alert">{{ error }}</p>
    <template v-else-if="status">
      <p class="text-xs text-muted wrap-anywhere">{{ t('backups.location', { path: status.backupDir || '-' }) }}</p>
      <p v-if="!status.snapshots.length" class="text-muted">{{ t('backups.none') }}</p>
      <ul v-else class="flex flex-col divide-y divide-border rounded-md hairline border-border">
        <li v-for="snap in status.snapshots" :key="snap.name" class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span class="min-w-0 flex-1 truncate font-mono text-xs" :title="snap.path">{{ snap.name }}</span>
          <span class="lm-badge" :class="snap.auto ? '' : 'lm-badge--accent'">{{ snap.auto ? t('backups.auto') : t('backups.manual') }}</span>
          <span class="text-muted tabular-nums">{{ formatBytes(snap.size) }}</span>
          <span class="text-muted">{{ when(snap.mtime) }}</span>
        </li>
      </ul>
      <p class="lm-hint">{{ t('backups.noDelete') }}</p>
    </template>

    <ModalShell v-if="restoreOpen" :title="t('backups.restoreTitle')" title-id="restore-title" :busy="busy === 'restore'" wide @close="restoreOpen = false">
      <form class="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5" @submit.prevent="doRestore">
        <div class="flex gap-2 rounded-md border-l-4 border-l-danger bg-danger-soft p-3 text-sm" role="note">
          <AppIcon name="alert" :size="18" class="flex-none text-danger" />
          <div class="flex flex-col gap-2">
            <p>{{ t('backups.restoreWarning') }}</p>
            <p class="font-medium">{{ t('backups.restoreFiles') }}</p>
            <ul class="list-disc pl-5">
              <li v-for="item in RESTORED_FILES" :key="item">{{ item }}</li>
            </ul>
            <p class="font-medium">{{ t('backups.restoreRestart') }}</p>
          </div>
        </div>
        <button type="button" class="lm-btn lm-btn--sm self-start" :disabled="!!busy" @click="backups.exportNow()">
          <AppIcon name="download" :size="14" />{{ t('backups.downloadFirst') }}
        </button>
        <div>
          <label class="lm-label" for="restore-file">{{ t('backups.chooseFile') }}</label>
          <input id="restore-file" class="lm-input" type="file" accept=".zip,application/zip" @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
          <p v-if="fileError" class="lm-error-text" role="alert">{{ fileError }}</p>
          <p v-else-if="file" class="lm-hint">{{ file.name }} · {{ formatBytes(file.size) }}</p>
        </div>
        <div>
          <label class="lm-label" for="restore-word">{{ t('backups.typeLabel') }}</label>
          <input id="restore-word" v-model="typed" class="lm-input max-w-[15rem] font-mono" autocomplete="off" spellcheck="false" :placeholder="RESTORE_CONFIRM_WORD" />
        </div>
        <p v-if="error" class="lm-error-text" role="alert">{{ error }}</p>
        <div class="lm-dialog-footer">
          <button type="button" class="lm-btn" :disabled="busy === 'restore'" @click="restoreOpen = false">{{ t('common.cancel') }}</button>
          <button type="submit" class="lm-btn lm-btn--danger" :disabled="!canRestore" :aria-busy="busy === 'restore'">{{ t('backups.restoreConfirm') }}</button>
        </div>
      </form>
    </ModalShell>
  </div>
</template>
