<script setup lang="ts">
/**
 * Diagnostics (port of the classic Doctor): runs the read-only checks on
 * open, shows every check with its severity and offers the classic fixes.
 * Fixes that change the server confirm first (see useDoctor).
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon, { type IconName } from '@/components/AppIcon.vue'
import EnvironmentPanel from '@/components/EnvironmentPanel.vue'
import PageShell from '@/components/PageShell.vue'
import StateBlock from '@/components/StateBlock.vue'
import { useDoctor } from '@/composables/useMaintenance'
import { useRefreshHandler } from '@/composables/useRefresh'
import { actionKind, type CheckStatus } from '@/utils/maintenance'
import { withMountPrefix } from '@/utils/basePath'
import { t, type MessageKey } from '@/i18n'

const router = useRouter()
const doctor = useDoctor()
const { report, loading, busy, error } = doctor
const classicUrl = withMountPrefix('/loras')

const STATUS: Record<CheckStatus, { icon: IconName; text: string; border: string; badge: string }> = {
  ok: { icon: 'check', text: 'text-success', border: 'border-l-success', badge: 'bg-success-soft text-success' },
  warning: { icon: 'alert', text: 'text-warning', border: 'border-l-warning', badge: 'bg-warning-soft text-warning' },
  error: { icon: 'alert', text: 'text-danger', border: 'border-l-danger', badge: 'bg-danger-soft text-danger' },
}

async function runAction(id: string): Promise<void> {
  switch (actionKind(id)) {
    case 'repair-cache':
      await doctor.repairCache()
      break
    case 'resolve-filename-conflicts':
      await doctor.resolveConflicts()
      break
    case 'open-settings':
      await router.push({ path: '/settings', hash: '#set-general' })
      break
    case 'open-settings-syntax-format':
      await router.push({ path: '/settings', hash: '#field-lora_syntax_format' })
      break
    case 'reload-page':
      location.reload()
      break
    default:
      location.href = classicUrl
  }
}

const isFix = (id: string) => id === 'repair-cache' || id === 'resolve-filename-conflicts'

onMounted(() => void doctor.run())
// `r` runs the checks again; the page keeps its own "Run again" button instead of the shell's Refresh.
useRefreshHandler({
  run: async () => {
    if (!loading.value && !busy.value) await doctor.run()
  },
  button: false,
})
</script>

<template>
  <PageShell :title="t('doctor.title')">
    <template #description>{{ t('doctor.intro') }}</template>
    <template #actions>
      <button type="button" class="lm-btn" :disabled="loading || !!busy" aria-keyshortcuts="R" :title="t('doctor.rerunShortcut')" @click="doctor.run()">
        <AppIcon name="refresh" :size="16" />{{ loading ? t('doctor.running') : report ? t('doctor.rerun') : t('doctor.run') }}
      </button>
      <button type="button" class="lm-btn" :disabled="!report || !!busy" :title="t('doctor.exportHint')" @click="doctor.exportBundle()">
        <AppIcon name="download" :size="16" />{{ t('doctor.export') }}
      </button>
    </template>

      <StateBlock v-if="loading && !report" kind="loading" />
      <StateBlock v-else-if="error && !report" kind="error" :title="t('doctor.loadError')" :message="error" @retry="doctor.run()" />
      <template v-else-if="report">
        <section class="lm-panel flex items-center gap-3 p-4" :class="STATUS[report.status].text" aria-live="polite">
          <AppIcon :name="STATUS[report.status].icon" :size="24" />
          <div class="min-w-[min(100%,260px)] flex-1">
            <p class="text-md font-bold">{{ t(`doctor.status.${report.status}` as MessageKey) }}</p>
            <p class="text-sm text-muted">
              {{ report.issueCount ? t('doctor.summary', { count: report.issueCount }) : t('doctor.summaryOk') }}
              · {{ t('doctor.checkedAt', { time: report.checkedAt ? new Date(report.checkedAt).toLocaleString() : '-', version: report.appVersion }) }}
            </p>
          </div>
        </section>

        <ul class="flex flex-col gap-3" :aria-busy="loading">
          <li v-for="check in report.checks" :key="check.id" class="lm-panel flex flex-col gap-2 border-l-4 p-4" :class="STATUS[check.status].border">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="min-w-0 flex-1 text-md">{{ check.title }}</h2>
              <span class="lm-badge" :class="STATUS[check.status].badge">{{ t(`doctor.status.${check.status}` as MessageKey) }}</span>
            </div>
            <p>{{ check.summary }}</p>
            <ul v-if="check.details.length" class="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
              <li v-for="(detail, i) in check.details" :key="i" class="wrap-anywhere" :class="detail.status ? STATUS[detail.status].text : ''">{{ detail.text }}</li>
            </ul>
            <div v-if="check.actions.length" class="flex flex-wrap gap-2">
              <button
                v-for="action in check.actions"
                :key="action.id"
                type="button"
                class="lm-btn lm-btn--sm"
                :class="action.id === 'resolve-filename-conflicts' ? 'lm-btn--danger' : isFix(action.id) || action.id === 'reload-page' ? 'lm-btn--primary' : ''"
                :disabled="!!busy || loading"
                :aria-busy="busy === action.id"
                @click="runAction(action.id)"
              >
                {{ actionKind(action.id) === 'unknown' ? action.label : t(`doctor.action.${action.id}` as MessageKey) }}
              </button>
            </div>
          </li>
        </ul>

        <section class="lm-panel flex flex-col gap-3 p-4" aria-labelledby="doctor-env">
          <h2 id="doctor-env" class="text-md">{{ t('doctor.environment') }}</h2>
          <EnvironmentPanel />
        </section>
      </template>
  </PageShell>
</template>
