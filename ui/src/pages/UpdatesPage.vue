<script setup lang="ts">
/**
 * Updates (phase 1): one row per model line with a real newer version, from
 * the read-only overview endpoint (GET /api/lm/{prefix}/updates/overview).
 * Likely / Possible / All filter, "Checked N days ago" and the count of
 * models that were never checked; Update queues the new version into the
 * folder of the current file. "Check now" (Civitai) runs only after a confirm.
 * Refresh (button / `r`) re-reads the overview: no scan, no Civitai request.
 */
import { computed, onMounted, ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import AppIcon from '@/components/AppIcon.vue'
import PageShell from '@/components/PageShell.vue'
import StateBlock from '@/components/StateBlock.vue'
import UpdateRow from '@/components/UpdateRow.vue'
import type { ModelPrefix, UpdateCandidate, UpdateGroup } from '@/api/types'
import { useAppSettings } from '@/composables/useAppSettings'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import { useRefreshHandler } from '@/composables/useRefresh'
import { useUpdates } from '@/composables/useUpdates'
import { LIBRARIES } from '@/config/libraries'
import {
  checkedAgoText,
  currentCard,
  deriveDestination,
  filterCounts,
  groupsForFilter,
  isUpdatePrefix,
  primaryCandidate,
  UPDATE_PREFIXES,
  UPDATES_FILTERS,
  type UpdatesFilter,
} from '@/utils/updates'
import { t, type MessageKey } from '@/i18n'

const toasts = useToasts()
const { confirm } = useConfirm()
const { settings, load: loadSettings } = useAppSettings()

const storedType = useLocalStorage<string>('lm-ui.updates.type', 'loras', { writeDefaults: false })
const prefix = computed<ModelPrefix>({
  get: () => (isUpdatePrefix(storedType.value) ? storedType.value : UPDATE_PREFIXES[0]),
  set: (value) => (storedType.value = value),
})
const filter = ref<UpdatesFilter>('likely')

const updates = useUpdates(prefix)
const { overview, loading, error, errorStatus } = updates

const blurMature = computed(() => settings.value?.blur_mature_content !== false)
const civitaiHost = computed(() => String(settings.value?.civitai_host || 'civitai.com'))
const typeLabel = (value: ModelPrefix) => t(LIBRARIES[value].title)

const counts = computed(() => filterCounts(overview.value))
const rows = computed(() => {
  const list: Array<{ group: UpdateGroup; candidate: UpdateCandidate; more: number }> = []
  for (const group of groupsForFilter(overview.value?.groups ?? [], filter.value)) {
    const candidate = primaryCandidate(group, filter.value)
    if (!candidate) continue
    list.push({ group, candidate, more: filter.value === 'all' ? 0 : group.candidates.length - 1 })
  }
  return list
})
const hiddenCount = computed(() => overview.value?.totals.hidden ?? 0)
const checkedText = computed(() => checkedAgoText(overview.value?.oldestCheckedAt ?? null))
const unchecked = computed(() => overview.value?.unchecked ?? 0)
/** Nothing of this type was ever checked: an empty list means "unknown", not "up to date". */
const neverChecked = computed(() => !!overview.value && !overview.value.oldestCheckedAt && unchecked.value > 0)
const loadMessage = computed(() => (errorStatus.value === 404 ? t('updates.notAvailable') : error.value || ''))

/** Inline notice after Check now (rate limit / offline); cleared by the next successful run. */
const notice = ref<'rate_limited' | 'offline' | null>(null)
/** Polite announcements (queue results, check results). */
const announcement = ref('')

function destinationFor(group: UpdateGroup) {
  return deriveDestination(currentCard(group), updates.roots.value)
}

function filterLabel(value: UpdatesFilter): string {
  return t(`updates.filter.${value}` as MessageKey)
}

async function onUpdate(group: UpdateGroup, candidate: UpdateCandidate): Promise<void> {
  const name = group.modelName || ''
  const version = candidate.name || ''
  const result = await updates.queueUpdate(group, candidate)
  if (result.kind === 'queued') {
    const text = t('updates.queued', { name, version })
    toasts.success(text)
    announcement.value = text
  } else if (result.kind === 'duplicate') {
    const text = t('updates.alreadyQueued', { name, version })
    toasts.push(text)
    announcement.value = text
  } else {
    toasts.error(t('updates.queueFailed', { name, message: result.message }))
  }
}

async function onCheckNow(): Promise<void> {
  if (!updates.canCheck.value) return
  const ok = await confirm({
    title: t('updates.checkTitle'),
    message: t('updates.checkMessage', { type: typeLabel(prefix.value) }),
    confirmLabel: t('updates.checkConfirm'),
  })
  if (!ok) return
  announcement.value = t('updates.checking')
  const { outcome, message } = await updates.checkNow()
  if (outcome === 'done') {
    notice.value = null
    const text = `${t('updates.checkDone')} ${t('updates.announceLoaded', { likely: counts.value.likely, possible: counts.value.possible })}`
    toasts.success(text)
    announcement.value = text
  } else if (outcome === 'rate_limited') {
    notice.value = 'rate_limited'
    announcement.value = t('updates.rateLimited')
  } else if (outcome === 'offline') {
    notice.value = 'offline'
    announcement.value = t('updates.backendOffline')
  } else if (outcome === 'error') {
    toasts.error(t('updates.checkFailed', { message: message || t('common.error') }))
  }
}

onMounted(() => {
  void loadSettings()
  void updates.load()
})

// Refresh (button / `r`): re-read the overview only. No scan, no Civitai.
useRefreshHandler({ run: () => updates.load({ throwOnError: true }) })

const segment =
  'inline-flex min-h-control-sm cursor-pointer items-center gap-2 rounded-sm px-3 text-sm font-medium text-muted transition-colors hover:text-fg aria-pressed:bg-accent-soft aria-pressed:text-accent phone:min-h-touch phone:flex-1 phone:justify-center'
const segmentGroup = 'inline-flex flex-none rounded-md hairline border-field-border bg-field p-px phone:flex phone:w-full'
</script>

<template>
  <PageShell :title="t('updates.title')">
    <template #description>
      <span v-if="overview" class="flex flex-col gap-1">
        <span class="text-md font-medium text-fg">{{ checkedText }}</span>
        <span>{{ t('updates.checkedHint') }}</span>
      </span>
    </template>
    <template #actions>
      <button
        type="button"
        class="lm-btn phone:min-h-touch"
        :disabled="!updates.canCheck.value"
        :aria-busy="updates.checking.value || undefined"
        @click="onCheckNow"
      >
        <AppIcon name="refresh" :size="16" :class="{ 'animate-spinner motion-reduce:animate-none': updates.checking.value }" />
        {{ updates.checking.value ? t('updates.checking') : t('updates.checkNow') }}
      </button>
    </template>

    <p class="sr-only" aria-live="polite" role="status">{{ announcement }}</p>

    <div class="flex flex-wrap items-center gap-3">
      <div :class="segmentGroup" role="group" :aria-label="t('updates.typeLabel')">
        <button
          v-for="value in UPDATE_PREFIXES"
          :key="value"
          type="button"
          :class="segment"
          :aria-pressed="prefix === value"
          @click="prefix = value"
        >
          {{ typeLabel(value) }}
        </button>
      </div>
      <div :class="segmentGroup" role="group" :aria-label="t('updates.filterLabel')">
        <button
          v-for="value in UPDATES_FILTERS"
          :key="value"
          type="button"
          :class="segment"
          :aria-pressed="filter === value"
          :title="t(`updates.filterHint.${value}` as MessageKey)"
          @click="filter = value"
        >
          {{ filterLabel(value) }}
          <span class="tabular-nums" :class="filter === value ? 'text-accent' : 'text-muted'">{{ counts[value] }}</span>
        </button>
      </div>
    </div>

    <p v-if="!updates.online.value" class="lm-panel border-warning px-4 py-3 text-sm text-warning" role="status">
      {{ t('updates.offline') }}
    </p>
    <p v-else-if="notice === 'rate_limited'" class="lm-panel border-warning px-4 py-3 text-sm text-warning" role="status">
      {{ t('updates.rateLimited') }}
      <template v-if="updates.coolingDown.value"> {{ t('updates.cooldown') }}</template>
    </p>
    <p v-else-if="notice === 'offline'" class="lm-panel border-warning px-4 py-3 text-sm text-warning" role="status">
      {{ t('updates.backendOffline') }}
    </p>

    <p v-if="unchecked" class="lm-panel flex items-start gap-2 px-4 py-3 text-sm" data-testid="unchecked-notice">
      <AppIcon name="alert" :size="16" class="mt-px flex-none text-warning" />
      <span>{{ t('updates.uncheckedNotice', { count: unchecked, models: unchecked === 1 ? t('updates.model') : t('updates.models') }) }}</span>
    </p>

    <StateBlock v-if="error && !overview" kind="error" :title="t('updates.loadError')" :message="loadMessage" @retry="updates.load()" />

    <ul v-else-if="!overview" class="flex flex-col gap-2" aria-busy="true" :aria-label="t('updates.loading')">
      <li v-for="n in 4" :key="n" class="lm-panel flex gap-3 p-3" aria-hidden="true">
        <span class="lm-skeleton h-[88px] w-[66px] flex-none rounded-sm"></span>
        <span class="flex flex-1 flex-col gap-2">
          <span class="lm-skeleton h-[16px] w-[40%] rounded-sm"></span>
          <span class="lm-skeleton h-[12px] w-[70%] rounded-sm"></span>
          <span class="lm-skeleton h-[12px] w-[55%] rounded-sm"></span>
        </span>
      </li>
    </ul>

    <template v-else>
      <section class="flex flex-col gap-3" aria-labelledby="updates-list-heading" :aria-busy="loading || undefined">
        <h2 id="updates-list-heading" class="text-lg">
          {{ t('updates.listLabel', { filter: filterLabel(filter) }) }}
          <span class="text-muted tabular-nums">{{ rows.length }}</span>
        </h2>
        <p class="text-sm text-muted">{{ t(`updates.filterHint.${filter}` as MessageKey) }}</p>

        <StateBlock
          v-if="!rows.length && filter === 'likely' && counts.possible"
          kind="empty"
          icon="check"
          :title="t('updates.emptyTitle')"
          :message="t('updates.emptyLikely', { count: counts.possible, updates: counts.possible === 1 ? t('updates.update') : t('updates.updatesWord') })"
        >
          <button type="button" class="lm-btn" @click="filter = 'possible'">{{ t('updates.showPossible') }}</button>
        </StateBlock>
        <StateBlock
          v-else-if="!rows.length"
          kind="empty"
          :icon="neverChecked ? 'alert' : 'check'"
          :title="neverChecked ? t('updates.emptyNeverTitle') : t('updates.emptyTitle')"
          :message="neverChecked ? t('updates.emptyNeverMessage') : t('updates.emptyChecked', { ago: checkedText })"
        >
          <button type="button" class="lm-btn" :disabled="!updates.canCheck.value" @click="onCheckNow">
            <AppIcon name="refresh" :size="16" />{{ t('updates.checkNow') }}
          </button>
        </StateBlock>
        <ul v-else class="flex flex-col gap-2">
          <UpdateRow
            v-for="row in rows"
            :key="row.group.key"
            :group="row.group"
            :candidate="row.candidate"
            :prefix="prefix"
            :state="updates.rowState(row.candidate.versionId)"
            :queuing="updates.queuing.value === row.candidate.versionId"
            :destination="destinationFor(row.group)"
            :more-count="row.more"
            :blur-mature="blurMature"
            :civitai-host="civitaiHost"
            @update="onUpdate(row.group, row.candidate)"
          />
        </ul>

        <p v-if="filter !== 'all' && hiddenCount" class="flex flex-wrap items-center gap-2 text-sm text-muted">
          {{ t('updates.hiddenFooter', { count: hiddenCount }) }}
          <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm phone:min-h-touch" @click="filter = 'all'">
            {{ t('updates.showAll') }}
          </button>
        </p>
      </section>
    </template>
  </PageShell>
</template>
