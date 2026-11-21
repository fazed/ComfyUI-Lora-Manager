<script setup lang="ts">
/**
 * Auto-organize (library toolbar "Organize…"). Flow: choose the model type,
 * run the PREVIEW (GET auto-organize?dry_run=true - nothing moves), review the
 * planned moves, then "Start organizing…" asks an explicit confirm that names
 * the type and says files WILL be moved. The real run (POST) is a single long
 * request; while it runs the dialog polls auto-organize-progress. Only folders
 * change (path template); file names stay.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import ModalShell from './ModalShell.vue'
import { createModelApi } from '@/api/endpoints'
import type { ModelPrefix, OrganizeProgress, OrganizeResponse } from '@/api/types'
import { LIBRARIES } from '@/config/libraries'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import { displayPath, groupOrganizePlan, type OrganizePlan } from '@/utils/modelActions'
import { t } from '@/i18n'

const props = defineProps<{ prefix: ModelPrefix }>()
const emit = defineEmits<{ close: []; organized: [prefix: ModelPrefix] }>()

/** Rows shown per list before "… and N more". */
const ROW_LIMIT = 200
const POLL_MS = 1000

const { confirm } = useConfirm()
const toasts = useToasts()
const prefix = ref<ModelPrefix>(props.prefix)
const api = computed(() => createModelApi(prefix.value))
const typeLabel = computed(() => t(LIBRARIES[prefix.value].title))

type Phase = 'idle' | 'previewing' | 'previewed' | 'running' | 'done'
const phase = ref<Phase>('idle')
const plan = ref<OrganizePlan | null>(null)
const roots = ref<string[]>([])
const error = ref<string | null>(null)
const progress = ref<OrganizeProgress | null>(null)
const result = ref<OrganizeResponse | null>(null)
const busy = computed(() => phase.value === 'previewing' || phase.value === 'running')

watch(prefix, () => {
  plan.value = null
  result.value = null
  error.value = null
  phase.value = 'idle'
})

const { pause: stopPolling, resume: startPolling } = useIntervalFn(
  async () => {
    try {
      const snapshot = await api.value.autoOrganizeProgress()
      if (snapshot && phase.value === 'running') progress.value = snapshot
    } catch {
      /* progress is best-effort; the run's own response is authoritative */
    }
  },
  POLL_MS,
  { immediate: false },
)
onBeforeUnmount(stopPolling)

async function runPreview(): Promise<void> {
  phase.value = 'previewing'
  error.value = null
  result.value = null
  try {
    const [response, rootList] = await Promise.all([api.value.autoOrganizePreview(), api.value.roots().catch(() => [])])
    roots.value = rootList
    plan.value = groupOrganizePlan(response)
    phase.value = 'previewed'
  } catch (err) {
    error.value = t('organize.previewFailed', { error: (err as Error).message })
    phase.value = 'idle'
  }
}

async function start(): Promise<void> {
  if (!plan.value?.moves.length) return
  const ok = await confirm({
    title: t('organize.confirmTitle', { type: typeLabel.value }),
    message: t('organize.confirmMessage', {
      count: plan.value.moves.length,
      type: typeLabel.value,
      template: plan.value.template || '(flat)',
    }),
    confirmLabel: t('organize.confirmLabel'),
    danger: true,
  })
  if (!ok) return
  phase.value = 'running'
  error.value = null
  progress.value = { status: 'started', processed: 0, total: plan.value.total }
  startPolling()
  try {
    result.value = await api.value.autoOrganizeRun()
    const summary = result.value.summary ?? {}
    toasts.success(
      t('organize.done', { moved: summary.success ?? 0, skipped: summary.skipped ?? 0, failed: summary.failures ?? 0 }),
    )
  } catch (err) {
    error.value = t('organize.failed', { error: (err as Error).message })
  } finally {
    stopPolling()
    phase.value = 'done'
    plan.value = null
    emit('organized', prefix.value)
  }
}

const percent = computed(() => {
  const total = progress.value?.total ?? 0
  return total ? Math.min(100, Math.round(((progress.value?.processed ?? 0) / total) * 100)) : 0
})
const sectionTitle = 'lm-overline mb-2'
const listClass = 'flex max-h-[min(280px,35vh)] flex-col gap-1 overflow-y-auto rounded-md hairline border-border bg-surface p-2 text-xs'
</script>

<template>
  <ModalShell :title="t('organize.title')" title-id="organize-title" :busy="busy" wide @close="emit('close')">
    <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
      <p class="text-sm text-muted">{{ t('organize.intro') }}</p>

      <div class="flex flex-wrap items-end gap-2">
        <div class="flex flex-col gap-1">
          <label class="lm-label" for="organize-type">{{ t('organize.type') }}</label>
          <select id="organize-type" v-model="prefix" class="lm-select w-auto min-w-[180px]" :disabled="busy">
            <option v-for="entry in Object.values(LIBRARIES)" :key="entry.prefix" :value="entry.prefix">{{ t(entry.title) }}</option>
          </select>
        </div>
        <button type="button" class="lm-btn" :disabled="busy" @click="runPreview">
          <AppIcon name="search" :size="16" />{{ phase === 'previewing' ? t('organize.previewing') : t('organize.preview') }}
        </button>
        <button
          type="button"
          class="lm-btn lm-btn--danger"
          :disabled="busy || phase !== 'previewed' || !plan?.moves.length"
          @click="start"
        >
          <AppIcon name="wand" :size="16" />{{ t('organize.start') }}
        </button>
      </div>

      <p v-if="error" class="lm-error-text text-sm" role="alert">{{ error }}</p>

      <!-- Running -->
      <div v-if="phase === 'running'" class="flex flex-col gap-2" role="status" aria-live="polite">
        <p class="text-sm">{{ t('organize.running', { processed: progress?.processed ?? 0, total: progress?.total ?? 0 }) }}</p>
        <div
          class="h-[8px] overflow-hidden rounded-pill bg-sunken"
          role="progressbar"
          :aria-valuenow="percent"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="t('organize.title')"
        >
          <div class="h-full bg-accent transition-[width]" :style="{ width: `${percent}%` }"></div>
        </div>
      </div>

      <!-- Result of a real run -->
      <div v-if="phase === 'done' && result" class="rounded-md bg-sunken p-3 text-sm" role="status">
        <p class="lm-overline mb-1">{{ t('organize.resultTitle') }}</p>
        <p>
          {{
            t('organize.done', {
              moved: result.summary?.success ?? 0,
              skipped: result.summary?.skipped ?? 0,
              failed: result.summary?.failures ?? 0,
            })
          }}
        </p>
        <ul v-if="(result.results ?? result.sample_results ?? []).some((entry) => entry.status === 'issue')" class="mt-2 flex flex-col gap-1 text-xs">
          <li v-for="(entry, index) in (result.results ?? result.sample_results ?? []).filter((e) => e.status === 'issue').slice(0, ROW_LIMIT)" :key="index">
            <strong>{{ entry.model }}</strong>: {{ entry.message }}
          </li>
        </ul>
      </div>

      <!-- Preview -->
      <template v-if="phase === 'previewed' && plan">
        <p class="text-sm">
          {{ plan.flat ? t('organize.flat') : t('organize.template', { template: plan.template ?? '' }) }}
        </p>
        <div class="flex flex-wrap gap-2" role="status">
          <span class="lm-badge lm-badge--accent">{{ t('organize.planned', { count: plan.moves.length }) }}</span>
          <span class="lm-badge">{{ t('organize.already', { count: plan.alreadyOrganized }) }}</span>
          <span class="lm-badge lm-badge--warning">{{ t('organize.skipped', { count: plan.skipped.length }) }}</span>
          <span class="lm-badge lm-badge--danger">{{ t('organize.issues', { count: plan.issues.length }) }}</span>
        </div>
        <p v-if="!plan.moves.length" class="text-sm text-muted">{{ t('organize.noMoves') }}</p>

        <section v-if="plan.moves.length" aria-labelledby="organize-moves">
          <h3 id="organize-moves" :class="sectionTitle">{{ t('organize.moves') }}</h3>
          <ol :class="listClass">
            <li v-for="move in plan.moves.slice(0, ROW_LIMIT)" :key="move.from" class="grid gap-[2px] hairline-b border-border pb-1 last:border-b-0">
              <span class="font-medium">{{ move.model }}</span>
              <span class="lm-mono text-muted">{{ displayPath(move.from, roots) }}</span>
              <span class="lm-mono"><AppIcon name="arrowDown" :size="12" /> {{ displayPath(move.to, roots) }}</span>
            </li>
            <li v-if="plan.moves.length > ROW_LIMIT" class="text-muted">{{ t('organize.moreRows', { count: plan.moves.length - ROW_LIMIT }) }}</li>
          </ol>
        </section>

        <section v-if="plan.issues.length" aria-labelledby="organize-issues">
          <h3 id="organize-issues" :class="sectionTitle">{{ t('organize.issuesList') }}</h3>
          <ul :class="listClass">
            <li v-for="(entry, index) in plan.issues.slice(0, ROW_LIMIT)" :key="index">
              <strong>{{ entry.model }}</strong>: {{ entry.message }}
            </li>
          </ul>
        </section>

        <section v-if="plan.skipped.length" aria-labelledby="organize-skipped">
          <h3 id="organize-skipped" :class="sectionTitle">{{ t('organize.skippedList') }}</h3>
          <ul :class="listClass">
            <li v-for="(entry, index) in plan.skipped.slice(0, ROW_LIMIT)" :key="index">
              <strong>{{ entry.model }}</strong>: {{ entry.message }}
            </li>
          </ul>
        </section>
      </template>
    </div>
  </ModalShell>
</template>
