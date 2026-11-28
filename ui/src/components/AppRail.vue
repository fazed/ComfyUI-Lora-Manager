<script setup lang="ts">
/**
 * App navigation: a vertical icon rail on the left (brand, the four
 * libraries, Updates with the likely-update badge, Downloads with the queue
 * state, Statistics; at the bottom Search, Appearance, Settings, Diagnostics,
 * Help, Notifications, Support and the Classic UI link). Every entry is an icon button with an accessible
 * name, a tooltip on hover and focus, and `aria-current="page"` when active.
 * `?` opens Help (outside text fields, menus and dialogs).
 *
 * Phones get a bottom bar with the four libraries and a "More" button that
 * opens the remaining entries (and the appearance options) in a bottom sheet.
 */
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useEventListener, useMediaQuery } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import AppearancePopover from './AppearancePopover.vue'
import BottomSheet from './BottomSheet.vue'
import BrandMark from './BrandMark.vue'
import GlobalSearchDialog from './GlobalSearchDialog.vue'
import HelpDialog from './HelpDialog.vue'
import NotificationsDialog from './NotificationsDialog.vue'
import SupportDialog from './SupportDialog.vue'
import ThemeOptions from './ThemeOptions.vue'
import type { IconName } from './icons'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useDownloadQueue } from '@/composables/useDownloadQueue'
import { useLikelyCountsTriggers, useUpdatesSummary } from '@/composables/useUpdates'
import { NAV_TABS, RAIL_PAGES, RAIL_TOOLS, isNavActive } from '@/config/navigation'
import { SHORTCUTS } from '@/config/shortcuts'
import { withMountPrefix } from '@/utils/basePath'
import { shouldHandleShortcut } from '@/utils/browse'
import { rekaLayerOpen } from '@/utils/dismiss'
import { likelySplitText } from '@/utils/updates'
import { t, type MessageKey } from '@/i18n'

interface RailEntry {
  to: string
  label: string
  icon: IconName
  badge?: string
  /** Paused download queue: the entry stays muted-warning while not active. */
  warn?: boolean
  testid?: string
}

const route = useRoute()
const isPhone = useMediaQuery('(max-width: 720px)')
const classicUrl = withMountPrefix('/loras')
const searchOpen = ref(false)
const moreOpen = ref(false)
/** The rail dialog that is open (Help, Notifications, Support), mounted while open. */
const dialog = ref<'help' | 'notifications' | 'support' | null>(null)
const DIALOGS: { id: 'help' | 'notifications' | 'support'; label: MessageKey; icon: IconName }[] = [
  { id: 'help', label: 'rail.help', icon: 'help' },
  { id: 'notifications', label: 'rail.notifications', icon: 'bell' },
  { id: 'support', label: 'rail.support', icon: 'heart' },
]

const { active, waiting, paused, worker } = useDownloadQueue(5000)
const queueBusy = computed(() => active.value.length + waiting.value.length > 0)
const queueLabel = computed(() =>
  paused.value ? t('topbar.queuePaused') : t('topbar.queue', { active: active.value.length, queued: waiting.value.length }),
)

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

const libraries = computed<RailEntry[]>(() => NAV_TABS.map((tab) => ({ ...tab, label: t(tab.label) })))
const pages = computed<RailEntry[]>(() =>
  RAIL_PAGES.map((page) => {
    if (page.to === '/updates') {
      return { ...page, label: updatesLabel.value, badge: likelyUpdates.value ? String(likelyUpdates.value) : '', testid: 'rail-updates' }
    }
    if (page.to === '/downloads') {
      const badge = worker.value?.rate_limited ? '!' : queueBusy.value ? `${active.value.length}/${active.value.length + waiting.value.length}` : ''
      return { ...page, label: queueLabel.value, icon: paused.value ? 'pause' : page.icon, badge, warn: paused.value }
    }
    return { ...page, label: t(page.label) }
  }),
)
const tools = computed<RailEntry[]>(() => RAIL_TOOLS.map((tool) => ({ ...tool, label: t(tool.label) })))
const morePages = computed(() => [...pages.value, ...tools.value])

const isActive = (to: string) => isNavActive(to, route.path)

const railButton =
  'relative inline-grid size-[2.75rem] flex-none cursor-pointer place-items-center rounded-md text-muted no-underline transition-colors hover:bg-sunken hover:text-fg aria-[current=page]:bg-accent aria-[current=page]:text-on-accent'
const badgeClass =
  'pointer-events-none absolute -top-[0.125rem] -right-[0.125rem] min-w-[1.125rem] rounded-pill bg-accent px-1 text-center text-xs leading-[1.125rem] font-bold text-on-accent tabular-nums'

function openSearch(): void {
  moreOpen.value = false
  searchOpen.value = true
}

function openDialog(id: 'help' | 'notifications' | 'support'): void {
  moreOpen.value = false
  dialog.value = id
}

useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  if (!shouldHandleShortcut(event, '?', rekaLayerOpen())) return
  event.preventDefault()
  openDialog('help')
})
</script>

<template>
  <!-- Phone: bottom bar with the libraries and "More". -->
  <nav
    v-if="isPhone"
    class="flex flex-none items-stretch justify-around hairline-t border-border bg-surface px-1 pb-[env(safe-area-inset-bottom)]"
    :aria-label="t('nav.main')"
  >
    <RouterLink
      v-for="entry in libraries"
      :key="entry.to"
      :to="entry.to"
      class="flex min-h-touch min-w-0 flex-1 flex-col items-center justify-center gap-px rounded-sm py-1 text-xs text-muted no-underline aria-[current=page]:text-fg aria-[current=page]:font-bold"
      :aria-current="isActive(entry.to) ? 'page' : undefined"
    >
      <AppIcon :name="entry.icon" :size="18" />
      <span class="max-w-full truncate">{{ entry.label }}</span>
    </RouterLink>
    <button
      type="button"
      class="flex min-h-touch min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-px rounded-sm py-1 text-xs text-muted"
      aria-haspopup="dialog"
      @click="moreOpen = true"
    >
      <AppIcon name="more" :size="18" />
      <span>{{ t('rail.more') }}</span>
    </button>
  </nav>

  <!-- Desktop and tablet: the icon rail. -->
  <TooltipProvider v-else>
    <nav
      class="flex w-rail flex-none flex-col items-center gap-1 overflow-y-auto hairline-r border-border bg-surface py-3"
      :aria-label="t('nav.main')"
    >
      <Tooltip>
        <TooltipTrigger as-child>
          <RouterLink to="/loras" class="mb-3 inline-grid size-[2.75rem] place-items-center rounded-md text-fg no-underline" :aria-label="t('nav.home')">
            <BrandMark :size="26" />
          </RouterLink>
        </TooltipTrigger>
        <TooltipContent side="right">{{ t('app.title') }}</TooltipContent>
      </Tooltip>

      <Tooltip v-for="entry in [...libraries, ...pages]" :key="entry.to">
        <TooltipTrigger as-child>
          <RouterLink
            :to="entry.to"
            :class="[railButton, entry.warn && 'text-warning']"
            :aria-label="entry.label"
            :aria-current="isActive(entry.to) ? 'page' : undefined"
            :data-testid="entry.testid"
          >
            <AppIcon :name="entry.icon" :size="20" />
            <span v-if="entry.badge" :class="badgeClass" aria-hidden="true">{{ entry.badge }}</span>
          </RouterLink>
        </TooltipTrigger>
        <TooltipContent side="right">{{ entry.label }}</TooltipContent>
      </Tooltip>

      <span class="flex-1" aria-hidden="true"></span>

      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" :class="railButton" :aria-label="t('topbar.searchGlobalLabel')" :aria-keyshortcuts="SHORTCUTS.search.aria" aria-haspopup="dialog" @click="openSearch">
            <AppIcon name="search" :size="20" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{{ t('rail.searchHint') }}</TooltipContent>
      </Tooltip>
      <AppearancePopover :button-class="railButton" />
      <Tooltip v-for="entry in tools" :key="entry.to">
        <TooltipTrigger as-child>
          <RouterLink :to="entry.to" :class="railButton" :aria-label="entry.label" :aria-current="isActive(entry.to) ? 'page' : undefined">
            <AppIcon :name="entry.icon" :size="20" />
          </RouterLink>
        </TooltipTrigger>
        <TooltipContent side="right">{{ entry.label }}</TooltipContent>
      </Tooltip>
      <Tooltip v-for="entry in DIALOGS" :key="entry.id">
        <TooltipTrigger as-child>
          <button
            type="button"
            :class="railButton"
            :aria-label="t(entry.label)"
            :aria-keyshortcuts="entry.id === 'help' ? SHORTCUTS.help.aria : undefined"
            aria-haspopup="dialog"
            @click="openDialog(entry.id)"
          >
            <AppIcon :name="entry.icon" :size="20" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{{ t(entry.label) }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <a :href="classicUrl" :class="railButton" :aria-label="t('nav.classic')">
            <AppIcon name="external" :size="20" />
          </a>
        </TooltipTrigger>
        <TooltipContent side="right">{{ t('nav.classicHint') }}</TooltipContent>
      </Tooltip>
    </nav>
  </TooltipProvider>

  <GlobalSearchDialog v-model:open="searchOpen" @dialog="openDialog" />
  <HelpDialog v-if="dialog === 'help'" @close="dialog = null" />
  <NotificationsDialog v-if="dialog === 'notifications'" @close="dialog = null" />
  <SupportDialog v-if="dialog === 'support'" @close="dialog = null" />

  <BottomSheet v-if="moreOpen" :title="t('rail.more')" title-id="rail-more-title" @close="moreOpen = false">
    <div class="grid gap-1 pb-2">
      <button type="button" class="lm-row flex min-h-touch cursor-pointer items-center gap-3 px-2 text-left" @click="openSearch">
        <AppIcon name="search" :size="18" />{{ t('topbar.searchGlobalLabel') }}
      </button>
      <RouterLink
        v-for="entry in morePages"
        :key="entry.to"
        :to="entry.to"
        class="lm-row lm-row--nav flex min-h-touch items-center gap-3 px-2 no-underline"
        :aria-current="isActive(entry.to) ? 'page' : undefined"
        @click="moreOpen = false"
      >
        <AppIcon :name="entry.icon" :size="18" />
        <span class="min-w-0 flex-1">{{ entry.label }}</span>
        <span v-if="entry.badge" class="lm-badge lm-badge--accent tabular-nums" aria-hidden="true">{{ entry.badge }}</span>
      </RouterLink>
      <button
        v-for="entry in DIALOGS"
        :key="entry.id"
        type="button"
        class="lm-row flex min-h-touch cursor-pointer items-center gap-3 px-2 text-left"
        @click="openDialog(entry.id)"
      >
        <AppIcon :name="entry.icon" :size="18" />{{ t(entry.label) }}
      </button>
      <a :href="classicUrl" class="lm-row lm-row--nav flex min-h-touch items-center gap-3 px-2 no-underline" :title="t('nav.classicHint')">
        <AppIcon name="external" :size="18" />{{ t('nav.classic') }}
      </a>
    </div>
    <div class="hairline-t border-border pt-4 pb-2">
      <h3 class="lm-label mb-3">{{ t('rail.appearance') }}</h3>
      <ThemeOptions />
    </div>
  </BottomSheet>
</template>
