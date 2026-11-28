<script setup lang="ts">
/** Version, update check (GitHub, read-only), environment and what still lives in the classic UI. */
import EnvironmentPanel from '@/components/EnvironmentPanel.vue'
import VersionCheck from './VersionCheck.vue'
import { t } from '@/i18n'

defineProps<{ nightly: boolean }>()
</script>

<template>
  <div class="flex flex-col gap-4">
    <VersionCheck :nightly="nightly" />
    <EnvironmentPanel />
    <p class="lm-hint">{{ t('about.stillClassic') }}</p>
  </div>
</template>
