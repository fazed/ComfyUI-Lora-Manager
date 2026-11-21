<script setup lang="ts">
/**
 * Global search results (/search?q=...): one section per library with the
 * first hits as a compact list and a "See all" link to the library with its
 * local search prefilled.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import SearchThumb from '@/components/SearchThumb.vue'
import StateBlock from '@/components/StateBlock.vue'
import { GLOBAL_SCOPES, searchLibrary, type LibraryScope } from '@/api/suggestSource'
import { stashItem } from '@/composables/useSearch'
import { useAppSettings } from '@/composables/useAppSettings'
import { NAV_TABS, itemTarget, queryParam, seeAllTarget } from '@/config/navigation'
import { splitHighlight, SUGGEST_MIN_CHARS, type SuggestItem } from '@/utils/suggest'
import { t } from '@/i18n'

const PER_SECTION = 12

interface Section {
  scope: LibraryScope
  items: SuggestItem[]
  total: number
  error: string
}

const route = useRoute()
const router = useRouter()
const { load: loadSettings } = useAppSettings()
const query = computed(() => queryParam(route.query.q).trim())
const sections = ref<Section[]>([])
const loading = ref(false)
let controller: AbortController | null = null

const visible = computed(() => sections.value.filter((section) => section.items.length || section.error))
const totalHits = computed(() => sections.value.reduce((sum, section) => sum + section.total, 0))

function tabFor(scope: LibraryScope) {
  return NAV_TABS.find((tab) => tab.to === `/${scope}`)!
}

async function run(q: string): Promise<void> {
  controller?.abort()
  sections.value = []
  if (q.length < SUGGEST_MIN_CHARS) return
  const current = new AbortController()
  controller = current
  loading.value = true
  const outcomes = await Promise.allSettled(GLOBAL_SCOPES.map((scope) => searchLibrary(scope, q, PER_SECTION, current.signal)))
  if (current.signal.aborted) return
  sections.value = GLOBAL_SCOPES.map((scope, index) => {
    const outcome = outcomes[index]
    return outcome.status === 'fulfilled'
      ? { scope, items: outcome.value.items, total: outcome.value.total, error: '' }
      : { scope, items: [], total: 0, error: (outcome.reason as Error)?.message || t('common.error') }
  })
  loading.value = false
}

function open(scope: LibraryScope, item: SuggestItem): void {
  stashItem(item.key, item.payload)
  void router.push(itemTarget(scope, item.key, item.name))
}

watch(query, (q) => void run(q), { immediate: true })
void loadSettings()
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="lm-page min-h-0 flex-1 overflow-y-auto">
    <header class="lm-page-header">
      <h1>{{ query.length >= SUGGEST_MIN_CHARS ? t('search.heading', { query }) : t('search.title') }}</h1>
      <span v-if="!loading && sections.length" class="text-sm text-muted tabular-nums" aria-live="polite">
        {{ t('search.count', { count: totalHits.toLocaleString() }) }}
      </span>
    </header>

    <StateBlock v-if="query.length < SUGGEST_MIN_CHARS" kind="empty" icon="search" :message="t('search.prompt')" />
    <StateBlock v-else-if="loading" kind="loading" />
    <StateBlock v-else-if="!visible.length" kind="empty" icon="search" :message="t('search.none')" />

    <section v-for="section in visible" :key="section.scope" class="mb-6" :aria-labelledby="`results-${section.scope}`">
      <div class="mb-2 flex flex-wrap items-center gap-3">
        <h2 :id="`results-${section.scope}`" class="flex items-center gap-2 text-lg">
          <AppIcon :name="tabFor(section.scope).icon" :size="18" class="text-muted" />
          {{ t(tabFor(section.scope).label) }}
          <span class="lm-badge tabular-nums">{{ section.total.toLocaleString() }}</span>
        </h2>
        <RouterLink
          v-if="section.total > section.items.length"
          class="text-sm"
          :to="seeAllTarget(section.scope, query)"
        >
          {{ t('search.seeAll', { count: section.total.toLocaleString(), section: t(tabFor(section.scope).label) }) }}
        </RouterLink>
      </div>
      <p v-if="section.error" class="lm-error-text">
        {{ t('search.error', { section: t(tabFor(section.scope).label), error: section.error }) }}
      </p>
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2">
        <li v-for="item in section.items" :key="item.key">
          <button
            type="button"
            class="lm-panel flex w-full cursor-pointer items-center gap-3 p-2 text-left hover:border-border-strong hover:bg-sunken"
            @click="open(section.scope, item)"
          >
            <SearchThumb :item="item" :size="48" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium">
                <template v-for="(part, index) in splitHighlight(item.name, query)" :key="index">
                  <mark v-if="part.match" class="bg-transparent font-bold text-accent">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-if="item.secondary && item.secondary !== item.name" class="truncate text-xs text-muted">
                <template v-for="(part, index) in splitHighlight(item.secondary, query)" :key="index">
                  <mark v-if="part.match" class="bg-transparent font-medium text-fg">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
            </span>
            <span v-if="item.badge" class="lm-badge max-w-[40%] flex-none truncate">{{ item.badge }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
