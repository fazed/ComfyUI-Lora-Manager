<script setup lang="ts">
/**
 * App header: brand, library tabs, global search (all libraries) and the
 * top-right actions (Downloads indicator, Settings, More menu).
 *
 * Layout: one row on desktop; at the tablet breakpoint the search moves to a
 * second full-width row; on phones the tabs take the second row as a
 * segmented strip and the search sits next to the brand.
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import AppMenu from './AppMenu.vue'
import BrandMark from './BrandMark.vue'
import SearchCombobox from './SearchCombobox.vue'
import { useDownloadQueue } from '@/composables/useDownloadQueue'
import { useLikelyCountsTriggers, useUpdatesSummary } from '@/composables/useUpdates'
import { likelySplitText } from '@/utils/updates'
import { stashItem } from '@/composables/useSearch'
import { GLOBAL_PER_GROUP, MAX_TAGS, GLOBAL_TAG_SCOPE } from '@/api/suggestSource'
import {
  NAV_TABS,
  globalSearchTarget,
  isNavActive,
  itemTarget,
  queryParam,
  seeAllTarget,
  tagTarget,
} from '@/config/navigation'
import type { SuggestOption } from '@/utils/suggest'
import { t } from '@/i18n'

const route = useRoute()
const router = useRouter()
const { active, waiting, paused, worker } = useDownloadQueue(5000)
const search = ref<InstanceType<typeof SearchCombobox> | null>(null)
const text = ref('')

const busy = computed(() => active.value.length + waiting.value.length > 0)
const queueLabel = computed(() =>
  paused.value
    ? t('topbar.queuePaused')
    : t('topbar.queue', { active: active.value.length, queued: waiting.value.length }),
)
const onDownloads = computed(() => isNavActive('/downloads', route.path))
const onUpdates = computed(() => isNavActive('/updates', route.path))

// Likely-update count for the badge, with the split per type in its name and
// tooltip. Read-only overview endpoint, never a scan or a Civitai request:
// after the shell is up, after each Updates page load and when the tab
// becomes visible again (throttled). No polling.
const updatesSummary = useUpdatesSummary()
const likelyUpdates = updatesSummary.total
const updatesLabel = computed(() =>
  likelyUpdates.value
    ? t('topbar.updatesCount', {
        count: likelyUpdates.value,
        updates: likelyUpdates.value === 1 ? t('updates.update') : t('updates.updatesWord'),
        split: likelySplitText(updatesSummary.byPrefix),
      })
    : t('topbar.updates'),
)
useLikelyCountsTriggers()
const onSettings = computed(() => isNavActive('/settings', route.path))

// The results page owns the text while it is open; leaving it empties the box.
watch(
  () => (route.path === '/search' ? queryParam(route.query.q) : null),
  (q, previous) => {
    if (q !== null) text.value = q
    else if (previous !== null && previous !== undefined) text.value = ''
  },
  { immediate: true },
)

function onCommit(value: string): void {
  if (value.trim()) void router.push(globalSearchTarget(value))
}

function onChoose(option: SuggestOption): void {
  const query = text.value
  if (option.kind === 'item') {
    stashItem(option.item.key, option.item.payload)
    void router.push(itemTarget(option.group, option.item.key, option.item.name))
  } else if (option.kind === 'more') {
    void router.push(seeAllTarget(option.scope, query))
  } else if (option.kind === 'tag') {
    void router.push(tagTarget(option.scope ?? GLOBAL_TAG_SCOPE, option.tag.tag))
  }
  text.value = ''
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** "/" (outside text fields) or Ctrl/Cmd+K focuses the global search. */
function onShortcut(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  const ctrlK = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k'
  const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditable(event.target)
  if (!ctrlK && !slash) return
  if (document.querySelector('dialog[open]')) return
  event.preventDefault()
  search.value?.focus()
}

useEventListener(document, 'keydown', onShortcut)

const iconButton = 'lm-btn lm-btn--ghost relative px-2'
</script>

<template>
  <header
    class="relative z-30 flex min-h-topbar flex-none flex-wrap items-center gap-x-4 gap-y-2 hairline-b border-border bg-surface px-6 py-2 tablet:gap-x-2 tablet:px-3"
  >
    <RouterLink
      to="/loras"
      class="order-1 flex flex-none items-center gap-2 rounded-sm text-lg font-bold text-fg no-underline"
      :aria-label="t('nav.home')"
      :title="t('app.title')"
    >
      <span class="inline-grid size-[32px] place-items-center rounded-sm bg-accent text-on-accent" aria-hidden="true">
        <BrandMark :size="28" />
      </span>
      <span class="whitespace-nowrap narrow:hidden">{{ t('app.title') }}</span>
    </RouterLink>

    <nav
      class="order-2 min-w-0 flex-none tablet:flex-1 phone:order-5 phone:basis-full"
      :aria-label="t('nav.libraries')"
    >
      <ul
        class="flex items-center gap-1 overflow-x-auto [scrollbar-width:thin] phone:gap-0 phone:rounded-sm phone:bg-sunken phone:p-[2px]"
      >
        <li v-for="tab in NAV_TABS" :key="tab.to" class="flex-none phone:flex-1">
          <RouterLink
            :to="tab.to"
            class="flex min-h-control items-center justify-center gap-2 rounded-sm px-3 text-sm font-medium whitespace-nowrap no-underline transition-[background,color] phone:min-h-control-sm phone:px-2"
            :class="
              isNavActive(tab.to, route.path)
                ? 'bg-accent-soft text-accent phone:bg-surface phone:text-fg phone:shadow-sm'
                : 'text-muted hover:bg-sunken hover:text-fg phone:hover:bg-transparent'
            "
            :aria-current="isNavActive(tab.to, route.path) ? 'page' : undefined"
          >
            <AppIcon :name="tab.icon" :size="16" class="phone:hidden" />
            <span>{{ t(tab.label) }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <div role="search" class="order-3 min-w-[200px] max-w-[560px] flex-1 tablet:order-5 tablet:max-w-none tablet:basis-full phone:static phone:order-2 phone:min-w-0 phone:basis-0">
      <SearchCombobox
        id="global-search"
        ref="search"
        v-model="text"
        scope="all"
        mode="global"
        class="phone:static"
        :label="t('topbar.searchGlobalLabel')"
        :placeholder="t('topbar.searchGlobal')"
        :max-per-group="GLOBAL_PER_GROUP"
        :max-tags="MAX_TAGS"
        shortcut-hint="/"
        input-class="border-transparent bg-sunken"
        panel-class="inset-x-0 top-[calc(100%+var(--lm-space-1))] min-w-[min(440px,calc(100vw-24px))] phone:inset-x-3 phone:top-full phone:min-w-0"
        @commit="onCommit"
        @choose="onChoose"
      />
    </div>

    <div class="order-4 ml-auto flex flex-none items-center gap-1 phone:order-3 phone:ml-0">
      <RouterLink
        to="/updates"
        :class="[iconButton, onUpdates ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg']"
        :aria-label="updatesLabel"
        :title="updatesLabel"
        :aria-current="onUpdates ? 'page' : undefined"
        data-testid="topbar-updates"
      >
        <AppIcon name="update" />
        <span v-if="likelyUpdates" class="lm-badge lm-badge--accent tabular-nums" aria-hidden="true">{{ likelyUpdates }}</span>
      </RouterLink>
      <RouterLink
        to="/downloads"
        :class="[iconButton, onDownloads ? 'bg-accent-soft text-accent' : paused ? 'text-warning' : busy ? 'text-accent' : 'text-muted hover:text-fg']"
        :aria-label="queueLabel"
        :title="queueLabel"
        :aria-current="onDownloads ? 'page' : undefined"
      >
        <AppIcon :name="paused ? 'pause' : 'download'" />
        <span v-if="busy" class="text-xs tabular-nums">{{ active.length }}/{{ active.length + waiting.length }}</span>
        <span v-if="worker?.rate_limited" class="lm-badge lm-badge--warning">!</span>
      </RouterLink>
      <RouterLink
        to="/settings"
        :class="[iconButton, 'w-control px-0', onSettings ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg']"
        :aria-label="t('nav.settings')"
        :title="t('nav.settings')"
        :aria-current="onSettings ? 'page' : undefined"
      >
        <AppIcon name="settings" />
      </RouterLink>
      <AppMenu />
    </div>
  </header>
</template>
