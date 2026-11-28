<script setup lang="ts">
/** Installed version and the user-started update check (GitHub, read-only): Settings > About and the Notifications dialog. */
import { onMounted, ref, shallowRef } from 'vue'
import { systemApi } from '@/api/maintenance'
import { normaliseUpdate, type UpdateInfo } from '@/utils/maintenance'
import { t } from '@/i18n'

const props = defineProps<{ nightly: boolean }>()
const version = ref('')
const checking = ref(false)
const update = shallowRef<UpdateInfo | null>(null)

async function check(): Promise<void> {
  checking.value = true
  try {
    update.value = normaliseUpdate(await systemApi.checkUpdates(props.nightly))
  } finally {
    checking.value = false
  }
}

onMounted(async () => {
  try {
    version.value = (await systemApi.versionInfo()).version
  } catch {
    version.value = '-'
  }
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="text-sm"><span class="text-muted">{{ t('about.version') }}:</span> <span class="font-mono">{{ version || '…' }}</span></p>
    <div class="flex flex-wrap items-center gap-2">
      <button type="button" class="lm-btn lm-btn--sm" :disabled="checking" @click="check">{{ checking ? t('about.checking') : t('about.checkUpdates') }}</button>
      <p v-if="update" class="text-sm" role="status" :class="update.error ? 'text-danger' : update.available ? 'text-warning' : 'text-success'">
        {{ update.error ? t('about.updateError', { error: update.error }) : update.available ? t('about.updateAvailable', { latest: update.latest, current: update.current }) : t('about.upToDate', { version: update.current }) }}
      </p>
    </div>
    <ul v-if="update?.available && update.changelog.length" class="list-disc pl-5 text-xs text-muted">
      <li v-for="(line, i) in update.changelog" :key="i">{{ line }}</li>
    </ul>
    <p class="lm-hint">{{ t('about.updateHint') }}</p>
  </div>
</template>
