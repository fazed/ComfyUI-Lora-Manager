<script setup lang="ts">
/**
 * Statistics (port of the classic statistics page): metric tiles and five
 * tabs with dependency-free SVG/CSS charts. Every chart has a text summary
 * and a "Show as table" fallback. All endpoints are read-only.
 */
import { computed, onMounted, reactive, ref, shallowRef } from 'vue'
import LazyMedia from '@/components/LazyMedia.vue'
import PageShell from '@/components/PageShell.vue'
import StateBlock from '@/components/StateBlock.vue'
import ChartCard from '@/components/charts/ChartCard.vue'
import DonutChart from '@/components/charts/DonutChart.vue'
import LineChart from '@/components/charts/LineChart.vue'
import ScatterChart from '@/components/charts/ScatterChart.vue'
import StackedBars from '@/components/charts/StackedBars.vue'
import { seriesBg } from '@/components/charts/chartClasses'
import { statsApi } from '@/api/maintenance'
import { withMountPrefix } from '@/utils/basePath'
import { formatBytes } from '@/utils/format'
import {
  averageUses,
  barPercent,
  donutSlices,
  largest,
  normaliseInsights,
  normaliseOverview,
  normaliseStorage,
  normaliseTimeline,
  normaliseUsageItems,
  seriesClass,
  stackedRows,
  tagCloud,
  topUsedAcross,
  usageRate,
  type Insight,
  type Overview,
  type StorageItem,
  type TagWeight,
  type TimelinePoint,
  type UsageItem,
} from '@/utils/stats'
import { t, type MessageKey } from '@/i18n'

type Tab = 'overview' | 'usage' | 'collection' | 'storage' | 'insights'
const TABS: Tab[] = ['overview', 'usage', 'collection', 'storage', 'insights']
const tab = ref<Tab>('overview')
const loading = ref(true)
const error = ref<string | null>(null)

const overview = shallowRef<Overview>(normaliseOverview({}))
const timeline = shallowRef<TimelinePoint[]>([])
const topUsage = shallowRef<Record<string, UsageItem[]>>({})
const baseModels = shallowRef<Record<string, Record<string, number>>>({})
const tags = shallowRef<TagWeight[]>([])
const uniqueTags = ref(0)
const storage = shallowRef<StorageItem[]>([])
const insights = shallowRef<Insight[]>([])

const LIBS = { loras: t('stats.loras'), checkpoints: t('stats.checkpoints'), embeddings: t('stats.embeddings') }
const TYPE_NAMES: Record<string, string> = { lora: 'LoRA', locon: 'LyCORIS (LoCon)', dora: 'DoRA', checkpoint: 'Checkpoint', diffusion_model: 'Diffusion model', embedding: 'Embedding' }

const tiles = computed(() => [
  { label: t('stats.totalModels'), value: overview.value.totalModels.toLocaleString() },
  { label: t('stats.totalStorage'), value: formatBytes(overview.value.totalSize) },
  { label: t('stats.totalGenerations'), value: overview.value.totalGenerations.toLocaleString() },
  { label: t('stats.usageRate'), value: `${usageRate(overview.value)}%` },
  { label: t('stats.loras'), value: overview.value.loraCount.toLocaleString() },
  { label: t('stats.checkpoints'), value: overview.value.checkpointCount.toLocaleString() },
  { label: t('stats.embeddings'), value: overview.value.embeddingCount.toLocaleString() },
])

const collectionSlices = computed(() =>
  donutSlices([
    [LIBS.loras, overview.value.loraCount],
    [LIBS.checkpoints, overview.value.checkpointCount],
    [LIBS.embeddings, overview.value.embeddingCount],
  ]),
)
const storageSlices = computed(() =>
  donutSlices([
    [LIBS.loras, overview.value.loraSize],
    [LIBS.checkpoints, overview.value.checkpointSize],
    [LIBS.embeddings, overview.value.embeddingSize],
  ]),
)
const typeSlices = computed(() =>
  donutSlices(Object.entries(overview.value.modelTypes).map(([key, value]) => [TYPE_NAMES[key] ?? key, value]), { otherLabel: t('stats.other') }),
)
const baseRows = computed(() => stackedRows(baseModels.value, LIBS))
const timelineKeys = [
  { key: 'lora' as const, name: LIBS.loras },
  { key: 'checkpoint' as const, name: LIBS.checkpoints },
  { key: 'embedding' as const, name: LIBS.embeddings },
]
const timelineTotal = computed(() => timeline.value.reduce((sum, p) => sum + p.total, 0))
const topAcross = computed(() => topUsedAcross(topUsage.value))
const topMax = computed(() => Math.max(0, ...topAcross.value.map((i) => i.usageCount)))
const biggest = computed(() => largest(storage.value))
const unusedModels = computed(() => overview.value.unusedLoras + overview.value.unusedCheckpoints + overview.value.unusedEmbeddings)

const summary = (slices: { label: string; percent: number }[]) => slices.map((s) => `${s.label} ${s.percent}%`).join(', ')

// ---------------------------------------------------------------- usage lists (paged)

type UsageType = 'lora' | 'checkpoint' | 'embedding'
const USAGE_TYPES: { type: UsageType; title: MessageKey }[] = [
  { type: 'lora', title: 'stats.topUsedLoras' },
  { type: 'checkpoint', title: 'stats.topUsedCheckpoints' },
  { type: 'embedding', title: 'stats.topUsedEmbeddings' },
]
const lists = reactive<Record<UsageType, { items: UsageItem[]; total: number; loading: boolean; loaded: boolean }>>({
  lora: { items: [], total: 0, loading: false, loaded: false },
  checkpoint: { items: [], total: 0, loading: false, loaded: false },
  embedding: { items: [], total: 0, loading: false, loaded: false },
})

async function loadUsage(type: UsageType): Promise<void> {
  const list = lists[type]
  if (list.loading) return
  list.loading = true
  try {
    const page = await statsApi.usageList(type, list.items.length, 20)
    list.items = [...list.items, ...normaliseUsageItems(page.items)]
    list.total = Number(page.total) || list.items.length
  } catch {
    /* keep what we have */
  } finally {
    list.loading = false
    list.loaded = true
  }
}

function selectTab(next: Tab): void {
  tab.value = next
  if (next === 'usage') for (const { type } of USAGE_TYPES) if (!lists[type].loaded) void loadUsage(type)
}

function onTabKey(event: KeyboardEvent): void {
  const index = TABS.indexOf(tab.value)
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!delta) return
  event.preventDefault()
  const next = TABS[(index + delta + TABS.length) % TABS.length]
  selectTab(next)
  document.getElementById(`stats-tab-${next}`)?.focus()
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [ov, usage, base, tagData, store, ins] = await Promise.all([
      statsApi.overview(),
      statsApi.usage(),
      statsApi.baseModels(),
      statsApi.tags(),
      statsApi.storage(),
      statsApi.insights(),
    ])
    overview.value = normaliseOverview(ov)
    timeline.value = normaliseTimeline(usage?.usage_timeline)
    topUsage.value = {
      loras: normaliseUsageItems(usage?.top_loras),
      checkpoints: normaliseUsageItems(usage?.top_checkpoints),
      embeddings: normaliseUsageItems(usage?.top_embeddings),
    }
    baseModels.value = base ?? {}
    tags.value = tagCloud(tagData?.top_tags)
    uniqueTags.value = Number(tagData?.total_unique_tags) || 0
    storage.value = normaliseStorage(store)
    insights.value = normaliseInsights(ins)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)

const tagSize: Record<number, string> = { 1: 'text-xs', 2: 'text-sm', 3: 'text-md', 4: 'text-lg', 5: 'text-xl' }
const insightClass: Record<string, string> = {
  warning: 'border-l-warning bg-warning-soft',
  info: 'border-l-accent bg-accent-soft',
  success: 'border-l-success bg-success-soft',
}
const tableClass = 'w-full text-left text-sm [&_th]:py-1 [&_th]:pr-3 [&_th]:font-medium [&_th]:text-muted [&_td]:py-1 [&_td]:pr-3 [&_td]:tabular-nums'
</script>

<template>
  <PageShell :title="t('stats.title')">
    <template #description>{{ t('stats.intro') }}</template>

      <StateBlock v-if="loading" kind="loading" />
      <StateBlock v-else-if="error" kind="error" :title="t('stats.loadError')" :message="error" @retry="load" />
      <template v-else>
        <ul class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3" :aria-label="t('stats.title')">
          <li v-for="tile in tiles" :key="tile.label" class="lm-panel flex flex-col gap-1 p-4">
            <span class="text-xs text-muted">{{ tile.label }}</span>
            <span class="text-xl font-bold tabular-nums">{{ tile.value }}</span>
          </li>
        </ul>

        <div role="tablist" :aria-label="t('stats.tabs')" class="flex gap-1 overflow-x-auto overflow-y-hidden hairline-b border-border" @keydown="onTabKey">
          <button
            v-for="name in TABS"
            :id="`stats-tab-${name}`"
            :key="name"
            type="button"
            role="tab"
            class="-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium"
            :class="tab === name ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'"
            :aria-selected="tab === name"
            :aria-controls="`stats-panel-${name}`"
            :tabindex="tab === name ? 0 : -1"
            @click="selectTab(name)"
          >
            {{ t(`stats.tab.${name}` as MessageKey) }}
          </button>
        </div>

        <!-- Overview -->
        <div v-if="tab === 'overview'" id="stats-panel-overview" role="tabpanel" aria-labelledby="stats-tab-overview" class="grid grid-cols-2 gap-4 tablet:grid-cols-1">
          <ChartCard id="chart-collection" :title="t('stats.collection')" :summary="summary(collectionSlices)">
            <DonutChart :slices="collectionSlices" :center-value="overview.totalModels.toLocaleString()" :center-label="t('stats.totalModels')" />
            <template #table>
              <table :class="tableClass">
                <thead><tr><th>{{ t('stats.type') }}</th><th>{{ t('stats.value') }}</th><th>{{ t('stats.share') }}</th></tr></thead>
                <tbody><tr v-for="s in collectionSlices" :key="s.label"><td>{{ s.label }}</td><td>{{ s.value }}</td><td>{{ s.percent }}%</td></tr></tbody>
              </table>
            </template>
          </ChartCard>
          <ChartCard id="chart-base" :title="t('stats.baseModels')" :summary="baseRows.slice(0, 5).map((r) => `${r.label} ${r.total}`).join(', ')">
            <StackedBars v-if="baseRows.length" :rows="baseRows" />
            <p v-else class="text-muted">{{ t('stats.noData') }}</p>
            <template #table>
              <table :class="tableClass">
                <thead><tr><th>{{ t('stats.baseModels') }}</th><th v-for="name in Object.values(LIBS)" :key="name">{{ name }}</th><th>{{ t('stats.total') }}</th></tr></thead>
                <tbody><tr v-for="r in baseRows" :key="r.label"><td>{{ r.label }}</td><td v-for="s in r.segments" :key="s.name">{{ s.value }}</td><td>{{ r.total }}</td></tr></tbody>
              </table>
            </template>
          </ChartCard>
          <ChartCard id="chart-timeline" class="col-span-2 tablet:col-span-1" :title="t('stats.timeline')" :summary="`${t('stats.total')}: ${timelineTotal}`">
            <LineChart :points="timeline" :keys="timelineKeys" />
            <template #table>
              <table :class="tableClass">
                <thead><tr><th>{{ t('stats.date') }}</th><th v-for="k in timelineKeys" :key="k.key">{{ k.name }}</th><th>{{ t('stats.total') }}</th></tr></thead>
                <tbody><tr v-for="p in timeline" :key="p.date"><td>{{ p.date }}</td><td>{{ p.lora }}</td><td>{{ p.checkpoint }}</td><td>{{ p.embedding }}</td><td>{{ p.total }}</td></tr></tbody>
              </table>
            </template>
          </ChartCard>
        </div>

        <!-- Usage -->
        <div v-else-if="tab === 'usage'" id="stats-panel-usage" role="tabpanel" aria-labelledby="stats-tab-usage" class="flex flex-col gap-4">
          <ChartCard id="chart-top" :title="t('stats.usageDistribution')" :summary="topAcross.map((i) => `${i.name} ${i.usageCount}`).join(', ')" :table="false">
            <ol v-if="topAcross.length" class="flex flex-col gap-2">
              <li v-for="item in topAcross" :key="`${item.type}-${item.name}`" class="grid grid-cols-[minmax(120px,35%)_1fr_auto] items-center gap-2 text-sm phone:grid-cols-[minmax(90px,40%)_1fr_auto]">
                <span class="truncate" :title="item.name">{{ item.name }}</span>
                <span class="h-[12px] rounded-sm bg-sunken" aria-hidden="true">
                  <span class="block h-full rounded-sm" :class="seriesBg(seriesClass(['loras', 'checkpoints', 'embeddings'].indexOf(item.type ?? '')))" :style="{ width: `${barPercent(item.usageCount, topMax)}%` }"></span>
                </span>
                <span class="tabular-nums text-muted">{{ item.usageCount }}</span>
              </li>
            </ol>
            <p v-else class="text-muted">{{ t('stats.noData') }}</p>
          </ChartCard>
          <div class="grid grid-cols-3 gap-4 narrow:grid-cols-1">
            <section v-for="u in USAGE_TYPES" :key="u.type" class="lm-panel flex min-w-0 flex-col gap-2 p-4" :aria-labelledby="`usage-${u.type}`">
              <h2 :id="`usage-${u.type}`" class="text-md">{{ t(u.title) }}</h2>
              <StateBlock v-if="!lists[u.type].loaded" kind="loading" />
              <p v-else-if="!lists[u.type].items.length" class="text-muted">{{ t('stats.noData') }}</p>
              <ol v-else class="flex max-h-[480px] flex-col gap-1 overflow-y-auto">
                <li v-for="(item, i) in lists[u.type].items" :key="`${item.name}-${i}`" class="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-sunken">
                  <LazyMedia :src="item.previewUrl ? withMountPrefix(item.previewUrl) : ''" class="size-[36px] flex-none overflow-hidden rounded-sm bg-sunken" media-class="size-full object-cover" :alt="''" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium" :title="item.name">{{ item.name }}</p>
                    <p class="truncate text-xs text-muted">{{ item.baseModel }} · {{ item.folder || t('stats.root') }}</p>
                  </div>
                  <span class="text-sm tabular-nums" :class="item.usageCount ? 'text-fg' : 'text-muted'">{{ item.usageCount }}</span>
                </li>
              </ol>
              <button
                v-if="lists[u.type].loaded && lists[u.type].items.length < lists[u.type].total"
                type="button"
                class="lm-btn lm-btn--sm self-start"
                :disabled="lists[u.type].loading"
                @click="loadUsage(u.type)"
              >
                {{ t('stats.loadMore') }} ({{ lists[u.type].items.length }}/{{ lists[u.type].total }})
              </button>
            </section>
          </div>
        </div>

        <!-- Collection -->
        <div v-else-if="tab === 'collection'" id="stats-panel-collection" role="tabpanel" aria-labelledby="stats-tab-collection" class="grid grid-cols-2 gap-4 tablet:grid-cols-1">
          <section class="lm-panel col-span-2 flex flex-col gap-3 p-4 tablet:col-span-1" aria-labelledby="tags-title">
            <h2 id="tags-title" class="text-md">{{ t('stats.tags') }}</h2>
            <ul v-if="tags.length" class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <li v-for="tag in tags" :key="tag.tag" :class="tagSize[tag.weight]" :title="`${tag.tag}: ${tag.count}`">
                <RouterLink :to="{ path: '/loras', query: { tag: tag.tag } }" class="no-underline hover:underline">{{ tag.tag }}</RouterLink>
                <span class="sr-only">: {{ tag.count }}</span>
              </li>
            </ul>
            <p v-else class="text-muted">{{ t('stats.noData') }}</p>
          </section>
          <ChartCard id="chart-types" :title="t('stats.modelTypes')" :summary="summary(typeSlices)">
            <DonutChart :slices="typeSlices" />
            <template #table>
              <table :class="tableClass">
                <thead><tr><th>{{ t('stats.type') }}</th><th>{{ t('stats.value') }}</th><th>{{ t('stats.share') }}</th></tr></thead>
                <tbody><tr v-for="s in typeSlices" :key="s.label"><td>{{ s.label }}</td><td>{{ s.value }}</td><td>{{ s.percent }}%</td></tr></tbody>
              </table>
            </template>
          </ChartCard>
          <section class="lm-panel flex flex-col gap-3 p-4" aria-labelledby="analysis-title">
            <h2 id="analysis-title" class="text-md">{{ t('stats.analysis') }}</h2>
            <dl class="grid grid-cols-2 gap-3">
              <div><dt class="text-xs text-muted">{{ t('stats.usageRate') }}</dt><dd class="text-lg font-bold">{{ usageRate(overview) }}%</dd></div>
              <div><dt class="text-xs text-muted">{{ t('stats.uniqueTags') }}</dt><dd class="text-lg font-bold">{{ uniqueTags.toLocaleString() }}</dd></div>
              <div><dt class="text-xs text-muted">{{ t('stats.unusedModels') }}</dt><dd class="text-lg font-bold">{{ unusedModels.toLocaleString() }}</dd></div>
              <div><dt class="text-xs text-muted">{{ t('stats.avgUses') }}</dt><dd class="text-lg font-bold">{{ averageUses(overview) }}</dd></div>
            </dl>
          </section>
        </div>

        <!-- Storage -->
        <div v-else-if="tab === 'storage'" id="stats-panel-storage" role="tabpanel" aria-labelledby="stats-tab-storage" class="grid grid-cols-2 gap-4 tablet:grid-cols-1">
          <ChartCard id="chart-storage" :title="t('stats.storage')" :summary="summary(storageSlices)">
            <DonutChart :slices="storageSlices" :format="(v: number) => formatBytes(v)" :center-value="formatBytes(overview.totalSize)" :center-label="t('stats.totalStorage')" />
            <template #table>
              <table :class="tableClass">
                <thead><tr><th>{{ t('stats.type') }}</th><th>{{ t('stats.size') }}</th><th>{{ t('stats.share') }}</th></tr></thead>
                <tbody><tr v-for="s in storageSlices" :key="s.label"><td>{{ s.label }}</td><td>{{ formatBytes(s.value) }}</td><td>{{ s.percent }}%</td></tr></tbody>
              </table>
            </template>
          </ChartCard>
          <section class="lm-panel flex min-w-0 flex-col gap-2 p-4" aria-labelledby="largest-title">
            <h2 id="largest-title" class="text-md">{{ t('stats.largest') }}</h2>
            <ol v-if="biggest.length" class="flex flex-col gap-1">
              <li v-for="item in biggest" :key="`${item.type}-${item.name}`" class="flex items-center gap-2 text-sm">
                <span class="size-[10px] flex-none rounded-sm" :class="seriesBg(seriesClass(['loras', 'checkpoints', 'embeddings'].indexOf(item.type)))" aria-hidden="true"></span>
                <span class="min-w-0 flex-1 truncate" :title="item.name">{{ item.name }}</span>
                <span class="max-w-[30%] truncate text-xs text-muted phone:hidden">{{ item.baseModel }}</span>
                <span class="tabular-nums text-muted">{{ formatBytes(item.size) }}</span>
              </li>
            </ol>
            <p v-else class="text-muted">{{ t('stats.noData') }}</p>
          </section>
          <ChartCard id="chart-scatter" class="col-span-2 tablet:col-span-1" :title="t('stats.sizeVsUsage')" :hint="t('stats.sizeVsUsage.hint')">
            <ScatterChart :items="storage" :names="LIBS" />
            <template #table>
              <table :class="tableClass">
                <thead><tr><th>{{ t('stats.name') }}</th><th>{{ t('stats.type') }}</th><th>{{ t('stats.size') }}</th><th>{{ t('stats.uses', { count: '' }) }}</th></tr></thead>
                <tbody><tr v-for="item in storage" :key="`${item.type}-${item.name}`"><td>{{ item.name }}</td><td>{{ LIBS[item.type as keyof typeof LIBS] }}</td><td>{{ formatBytes(item.size) }}</td><td>{{ item.usageCount }}</td></tr></tbody>
              </table>
            </template>
          </ChartCard>
        </div>

        <!-- Insights -->
        <div v-else id="stats-panel-insights" role="tabpanel" aria-labelledby="stats-tab-insights" class="flex flex-col gap-3">
          <p v-if="!insights.length" class="text-muted">{{ t('stats.noInsights') }}</p>
          <article v-for="(insight, i) in insights" :key="i" class="rounded-md border-l-4 p-4" :class="insightClass[insight.type]">
            <h2 class="text-md">{{ insight.title }}</h2>
            <p class="mt-1">{{ insight.description }}</p>
            <p class="mt-1 text-sm text-muted">{{ insight.suggestion }}</p>
          </article>
        </div>
      </template>
  </PageShell>
</template>
