<script setup lang="ts">
/**
 * Updates (phase 1): one row per model line with a real newer version, from
 * the read-only overview endpoint (GET /api/lm/{prefix}/updates/overview).
 * Likely / Possible / All filter, "Checked N days ago" and the count of
 * models that were never checked; Update queues the new version into the
 * folder of the current file. "Check now" (Civitai) runs only after a confirm.
 * Refresh (button / `r`) re-reads the overview: no scan, no Civitai request.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import AppIcon from '@/components/AppIcon.vue'
import PageShell from '@/components/PageShell.vue'
import StateBlock from '@/components/StateBlock.vue'
import UpdateIgnoredRow from '@/components/UpdateIgnoredRow.vue'
import UpdateRow from '@/components/UpdateRow.vue'
import UpdatesBulkBar from '@/components/UpdatesBulkBar.vue'
import UpdatesBulkConfirmDialog from '@/components/UpdatesBulkConfirmDialog.vue'
import OldVersionsView from '@/components/OldVersionsView.vue'
import { useReplaceChoice } from '@/composables/useReplaceChoice'
import { fileNameOf, ownedFilesForGroup } from '@/utils/versionManagement'
import type { ModelPrefix, UpdateCandidate, UpdateGroup } from '@/api/types'
import { useAppSettings } from '@/composables/useAppSettings'
import { useBulkUpdate } from '@/composables/useBulkUpdate'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import { useRefreshHandler } from '@/composables/useRefresh'
import { useUpdateIgnore } from '@/composables/useUpdateIgnore'
import { useUpdates, useUpdatesSummary } from '@/composables/useUpdates'
import { LIBRARIES } from '@/config/libraries'
import {
  autoSelectable,
  bulkSizeText,
  canQueue,
  checkedAgoText,
  currentCard,
  deriveDestination,
  filterCounts,
  groupsForFilter,
  ignoredEntries,
  isUpdatePrefix,
  primaryCandidate,
  summarizeBulk,
  typeLikelyText,
  UPDATE_PREFIXES,
  UPDATES_FILTERS,
  type BulkItem,
  type IgnoredEntry,
  type IgnoreChange,
  type UpdateRowModel,
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
/** Update candidates, or the "Old versions" cleanup view (version management). */
const view = ref<'updates' | 'old'>('updates')
/** Lines with older owned versions of the active type (null until the view loaded it). */
const oldCount = ref<number | null>(null)
const oldView = ref<{ load(options?: { throwOnError?: boolean }): Promise<void> } | null>(null)
watch(prefix, () => (oldCount.value = null))
const replaceChoice = useReplaceChoice()

function resetAlwaysKeep(): void {
  replaceChoice.resetAlwaysKeep()
  toasts.success(t('replace.alwaysKeepResetDone'))
}

const updates = useUpdates(prefix)
/** Likely count per type (shared with the top-bar badge); missing until read. */
const likelyByType = useUpdatesSummary().byPrefix
const { loading, error, errorStatus } = updates

// Ignore / restore: the page shows the overview with the changes still being stored.
const ignore = useUpdateIgnore({ prefix, overview: updates.overview, reload: () => updates.load() })
const overview = ignore.view

const blurMature = computed(() => settings.value?.blur_mature_content !== false)
const civitaiHost = computed(() => String(settings.value?.civitai_host || 'civitai.com'))
const typeLabel = (value: ModelPrefix) => t(LIBRARIES[value].title)

const counts = computed(() => filterCounts(overview.value))
const rows = computed(() => {
  const list: UpdateRowModel[] = []
  if (filter.value === 'ignored') return list
  for (const group of groupsForFilter(overview.value?.groups ?? [], filter.value)) {
    const candidate = primaryCandidate(group, filter.value)
    if (!candidate) continue
    list.push({ group, candidate, more: filter.value === 'all' ? 0 : group.candidates.length - 1 })
  }
  return list
})
const ignored = computed<IgnoredEntry[]>(() => (filter.value === 'ignored' ? ignoredEntries(overview.value?.groups ?? []) : []))

// --- bulk update ---------------------------------------------------------------
/** Rows whose Update action is available right now, by row key. */
const selectableRows = computed(() => {
  const map = new Map<string, BulkItem>()
  for (const row of rows.value) {
    if (updates.queuing.value === row.candidate.versionId) continue
    if (!canQueue(updates.rowState(row.candidate.versionId))) continue
    map.set(row.group.key, { key: row.group.key, group: row.group, candidate: row.candidate, destination: destinationFor(row.group) })
  }
  return map
})
const bulk = useBulkUpdate({
  selectable: () => selectableRows.value,
  queueUpdate: updates.queueUpdate,
  afterRun: () => updates.refreshQueue(),
})
const autoKeys = computed(() =>
  rows.value.filter((row) => selectableRows.value.has(row.group.key) && autoSelectable(row, updates.rowState(row.candidate.versionId))).map((row) => row.group.key),
)
const bulkSummary = computed(() => summarizeBulk(bulk.selected.value))
const showBulkBar = computed(() => view.value === 'updates' && filter.value !== 'ignored' && (selectableRows.value.size > 0 || bulk.selected.value.length > 0 || !!bulk.result.value))
// A type switch starts with an empty selection (the rows belong to another type).
watch(prefix, () => {
  bulk.clear()
  bulk.dismissResult()
})

/** The summary confirm of Update selected (with the per-row Keep / Replace choice); null = closed. */
const bulkConfirm = ref<BulkItem[] | null>(null)

function onBulkUpdate(): void {
  const items = bulk.selected.value
  if (!items.length || bulk.submitting.value) return
  bulkConfirm.value = items
}

async function onBulkConfirmed(confirmed: BulkItem[]): Promise<void> {
  bulkConfirm.value = null
  // Re-read the selection: a row may have been queued while the confirm was open. The replace
  // choice made in the confirm is carried over by row key (Keep for anything not chosen).
  const chosen = new Map(confirmed.map((item) => [item.key, item.replacePaths]))
  const items = bulk.selected.value.map((item) => ({ ...item, replacePaths: chosen.get(item.key) }))
  const result = await bulk.run(items)
  if (!result) return
  announcement.value = t('updates.bulk.announce', {
    added: result.added.length,
    duplicates: result.duplicates.length,
    failed: result.failed.length,
  })
}

// --- ignore / restore -------------------------------------------------------------
function versionLabel(group: UpdateGroup, candidate: UpdateCandidate | null): { name: string; version: string } {
  return { name: group.modelName || '', version: candidate ? candidate.name || '' : t('updates.ignored.allVersions') }
}

async function changeIgnore(change: IgnoreChange, label: { name: string; version: string }, undoable: boolean): Promise<void> {
  const outcome = await ignore.apply(change)
  if (!outcome.ok) {
    if (outcome.message) toasts.error(t('updates.ignore.failed', { message: outcome.message }))
    return
  }
  let text: string
  if (!change.ignore) text = change.versionId === null ? t('updates.restoredModel', label) : t('updates.restored', label)
  else if (change.versionId === null) text = t('updates.ignore.modelDone', label)
  else text = t('updates.ignore.versionDone', label)
  announcement.value = text
  if (!undoable) {
    toasts.success(text)
    return
  }
  toasts.push(text, 'success', 10_000, {
    label: t('updates.undo'),
    run: () => void changeIgnore({ ...change, ignore: !change.ignore }, label, false),
  })
}

function onIgnore(group: UpdateGroup, candidate: UpdateCandidate, scope: 'version' | 'model'): void {
  const change: IgnoreChange = { modelId: group.modelId, versionId: scope === 'model' ? null : candidate.versionId, ignore: true }
  bulk.toggle(group.key, false)
  void changeIgnore(change, versionLabel(group, scope === 'model' ? null : candidate), true)
}

function onRestore(entry: IgnoredEntry): void {
  const candidate = entry.kind === 'version' ? entry.candidate : null
  const change: IgnoreChange = { modelId: entry.group.modelId, versionId: candidate?.versionId ?? null, ignore: false }
  void changeIgnore(change, versionLabel(entry.group, candidate), true)
}

function restoreBusy(entry: IgnoredEntry): boolean {
  return ignore.isBusy({ modelId: entry.group.modelId, versionId: entry.kind === 'version' ? entry.candidate.versionId : null })
}
function rowIgnoreBusy(group: UpdateGroup, candidate: UpdateCandidate): boolean {
  return ignore.isBusy({ modelId: group.modelId, versionId: null }) || ignore.isBusy({ modelId: group.modelId, versionId: candidate.versionId })
}
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
  // Replace or keep the versions of this line you already own (asked before anything is queued).
  const decision = await replaceChoice.ask({ modelName: name, versionName: version, files: ownedFilesForGroup(group, candidate) })
  if (!decision) return
  const replacePaths = decision.mode === 'replace' ? decision.paths : []
  const result = await updates.queueUpdate(group, candidate, { replacePaths })
  if (result.kind === 'queued') {
    const text = replacePaths.length && result.replaceAttached
      ? t('replace.queuedReplace', { name, version, file: replacePaths.map(fileNameOf).join(', ') })
      : t('updates.queued', { name, version })
    toasts.success(text)
    announcement.value = text
  } else if (result.kind === 'duplicate') {
    const text = replacePaths.length ? t('replace.notAttached') : t('updates.alreadyQueued', { name, version })
    toasts.push(text, replacePaths.length ? 'warning' : 'info')
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
  } else if (outcome === 'stopped') {
    const text = t('updates.checkStopped')
    toasts.push(text)
    announcement.value = text
  } else if (outcome === 'error') {
    toasts.error(t('updates.checkFailed', { message: message || t('common.error') }))
  }
}

async function onStopCheck(): Promise<void> {
  if (await updates.stopCheck()) announcement.value = t('updates.stopping')
}

onMounted(() => {
  void loadSettings()
  void updates.load()
})

// Refresh (button / `r`): re-read the overview only. No scan, no Civitai.
useRefreshHandler({
  run: () => (view.value === 'old' && oldView.value ? oldView.value.load({ throwOnError: true }) : updates.load({ throwOnError: true })),
})

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

    <!-- Check now running: indeterminate (the backend reports no progress), with Stop. -->
    <div
      v-if="updates.checking.value"
      class="lm-panel flex flex-wrap items-center gap-3 border-accent px-4 py-3 text-sm"
      data-testid="check-progress"
    >
      <AppIcon name="refresh" :size="16" class="flex-none animate-spinner text-accent motion-reduce:animate-none" />
      <span class="min-w-0 flex-1 text-pretty">
        {{ updates.stopping.value ? t('updates.stopping') : t('updates.checkingLong', { type: typeLabel(prefix) }) }}
      </span>
      <button
        type="button"
        class="lm-btn lm-btn--sm phone:min-h-touch"
        :disabled="updates.stopping.value"
        :title="t('updates.stopHint')"
        @click="onStopCheck"
      >
        <AppIcon name="pause" :size="14" />{{ t('updates.stop') }}
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <div :class="segmentGroup" role="group" :aria-label="t('updates.typeLabel')">
        <button
          v-for="value in UPDATE_PREFIXES"
          :key="value"
          type="button"
          :class="segment"
          :aria-pressed="prefix === value"
          :title="likelyByType[value] !== undefined ? typeLikelyText(likelyByType[value]!) : undefined"
          :data-testid="`updates-type-${value}`"
          @click="prefix = value"
        >
          {{ typeLabel(value) }}
          <template v-if="likelyByType[value] !== undefined">
            <span class="tabular-nums" :class="prefix === value ? 'text-accent' : 'text-muted'" aria-hidden="true">{{ likelyByType[value] }}</span>
            <span class="sr-only">, {{ typeLikelyText(likelyByType[value]!) }}</span>
          </template>
        </button>
      </div>
      <div :class="segmentGroup" role="group" :aria-label="t('oldVersions.viewLabel')">
        <button type="button" :class="segment" :aria-pressed="view === 'updates'" data-testid="view-updates" @click="view = 'updates'">
          {{ t('oldVersions.updatesTab') }}
        </button>
        <button type="button" :class="segment" :aria-pressed="view === 'old'" data-testid="view-old" @click="view = 'old'">
          {{ t('oldVersions.tab') }}
          <span v-if="oldCount !== null" class="tabular-nums" :class="view === 'old' ? 'text-accent' : 'text-muted'">{{ oldCount }}</span>
        </button>
      </div>
      <div v-if="view === 'updates'" :class="segmentGroup" role="group" :aria-label="t('updates.filterLabel')">
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

    <p v-if="unchecked && view === 'updates'" class="lm-panel flex items-start gap-2 px-4 py-3 text-sm" data-testid="unchecked-notice">
      <AppIcon name="alert" :size="16" class="mt-px flex-none text-warning" />
      <span>{{ t('updates.uncheckedNotice', { count: unchecked, models: unchecked === 1 ? t('updates.model') : t('updates.models') }) }}</span>
    </p>

    <p v-if="replaceChoice.alwaysKeep.value && view === 'updates'" class="lm-panel flex flex-wrap items-center gap-2 px-4 py-3 text-sm" data-testid="always-keep-notice">
      <span class="min-w-0 flex-1">{{ t('replace.alwaysKeepNotice') }}</span>
      <button type="button" class="lm-btn lm-btn--sm phone:min-h-touch" @click="resetAlwaysKeep">{{ t('replace.alwaysKeepReset') }}</button>
    </p>

    <OldVersionsView v-if="view === 'old'" ref="oldView" :prefix="prefix" :blur-mature="blurMature" @counts="oldCount = $event" />

    <StateBlock v-else-if="error && !overview" kind="error" :title="t('updates.loadError')" :message="loadMessage" @retry="updates.load()" />

    <ul v-else-if="!overview" class="flex flex-col gap-2" aria-busy="true" :aria-label="t('updates.loading')">
      <li v-for="n in 4" :key="n" class="lm-panel flex gap-3 p-3" aria-hidden="true">
        <span class="lm-skeleton h-[5.5rem] w-[4.125rem] flex-none rounded-sm"></span>
        <span class="flex flex-1 flex-col gap-2">
          <span class="lm-skeleton h-[16px] w-[40%] rounded-sm"></span>
          <span class="lm-skeleton h-[12px] w-[70%] rounded-sm"></span>
          <span class="lm-skeleton h-[12px] w-[55%] rounded-sm"></span>
        </span>
      </li>
    </ul>

    <section
      v-else-if="filter === 'ignored'"
      class="flex flex-col gap-3"
      aria-labelledby="updates-ignored-heading"
      :aria-busy="loading || undefined"
      data-testid="ignored-view"
    >
      <h2 id="updates-ignored-heading" class="text-lg">
        {{ t('updates.ignoredListLabel') }}
        <span class="text-muted tabular-nums">{{ ignored.length }}</span>
      </h2>
      <p class="text-sm text-muted">{{ t('updates.filterHint.ignored') }}</p>
      <StateBlock
        v-if="!ignored.length"
        kind="empty"
        icon="check"
        :title="t('updates.ignored.emptyTitle')"
        :message="t('updates.ignored.emptyMessage')"
      />
      <ul v-else class="flex flex-col gap-2">
        <UpdateIgnoredRow
          v-for="entry in ignored"
          :key="entry.key"
          :entry="entry"
          :busy="restoreBusy(entry)"
          @restore="onRestore(entry)"
        />
      </ul>
    </section>

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
            :selected="bulk.isSelected(row.group.key)"
            :locked="bulk.submitting.value"
            :ignore-busy="rowIgnoreBusy(row.group, row.candidate)"
            :queue-item="updates.rowItem(row.candidate.versionId)"
            @update="onUpdate(row.group, row.candidate)"
            @select="(value) => bulk.toggle(row.group.key, value)"
            @ignore="(scope) => onIgnore(row.group, row.candidate, scope)"
          />
        </ul>

        <p v-if="filter !== 'all' && hiddenCount" class="flex flex-wrap items-center gap-2 text-sm text-muted">
          {{ t('updates.hiddenFooter', { count: hiddenCount }) }}
          <button type="button" class="lm-btn lm-btn--ghost lm-btn--sm phone:min-h-touch" @click="filter = 'all'">
            {{ t('updates.showAll') }}
          </button>
        </p>
      </section>

      <UpdatesBulkBar
        v-if="showBulkBar"
        v-model:stop-on-hard-error="bulk.stopOnHardError.value"
        :count="bulk.selected.value.length"
        :selectable-count="autoKeys.length"
        :size-text="bulkSizeText(bulkSummary)"
        :submitting="bulk.submitting.value"
        :progress="bulk.progress.value"
        :result="bulk.result.value"
        @select-all="bulk.selectOnly(autoKeys)"
        @clear="bulk.clear()"
        @submit="onBulkUpdate"
        @dismiss="bulk.dismissResult()"
      />
      <UpdatesBulkConfirmDialog v-if="bulkConfirm" :items="bulkConfirm" @confirm="onBulkConfirmed" @cancel="bulkConfirm = null" />
    </template>
  </PageShell>
</template>
