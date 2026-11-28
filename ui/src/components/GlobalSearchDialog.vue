<script setup lang="ts">
/**
 * Command palette, opened from the rail's Search button, `/` outside text
 * fields or Ctrl/Cmd+K. One box for models, recipes and tags (the global
 * search suggester), folders of the model libraries, pages, actions (the
 * current page's and the app's) and settings tabs and cards. Groups are
 * listed in a Reka listbox: Up/Down/Home/End move, Enter or a click runs.
 * "Search everywhere" (always last while typing) opens the search results
 * page; while that page is open its query prefills the box.
 */
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import AppIcon, { type IconName } from './AppIcon.vue'
import SearchThumb from './SearchThumb.vue'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { stashItem, useSuggestions } from '@/composables/useSearch'
import { pageActions } from '@/composables/usePageActions'
import { useRefresh } from '@/composables/useRefresh'
import { useTheme } from '@/composables/useTheme'
import { TEXT_SCALES, useAppearance } from '@/composables/useAppearance'
import { createModelApi } from '@/api/endpoints'
import { GLOBAL_PER_GROUP, GLOBAL_TAG_SCOPE, MAX_TAGS, MODEL_SCOPES } from '@/api/suggestSource'
import { globalSearchTarget, itemTarget, NAV_TABS, queryParam, RAIL_PAGES, RAIL_TOOLS, seeAllTarget, tagTarget } from '@/config/navigation'
import { SETTINGS_TABS } from '@/config/settingsTabs'
import { SHORTCUTS } from '@/config/shortcuts'
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@/themes/registry'
import { rekaLayerOpen } from '@/utils/dismiss'
import { folderEntries, rankPalette, type PaletteEntry } from '@/utils/palette'
import { cardDomId, settingsTabPath } from '@/utils/settingsTabs'
import { buildSuggestOptions, sectionOptions, splitHighlight, type SuggestOption } from '@/utils/suggest'
import { t, type MessageKey } from '@/i18n'

type RailDialog = 'help' | 'notifications' | 'support'
type Entry = PaletteEntry & { run: () => void }

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ dialog: [id: RailDialog] }>()

const route = useRoute()
const router = useRouter()
const command = ref<InstanceType<typeof Command> | null>(null)
const text = ref('')
const suggestions = useSuggestions(() => 'all')

// The results page owns the text while it is open; leaving it empties the box.
watch(
  () => (route.path === '/search' ? queryParam(route.query.q) : null),
  (q, previous) => {
    if (q !== null) text.value = q
    else if (previous !== null && previous !== undefined) text.value = ''
  },
  { immediate: true },
)
watch(text, (value) => suggestions.request(value), { immediate: true })

// --- Models, recipes and tags (search suggester) ----------------------------

const SCOPE_LABEL: Record<string, MessageKey> = { loras: 'nav.loras', checkpoints: 'nav.checkpoints', embeddings: 'nav.embeddings', recipes: 'nav.recipes' }
const scopeLabel = (scope: string) => (SCOPE_LABEL[scope] ? t(SCOPE_LABEL[scope]) : scope)
const scopeIcon = (scope: string): IconName => NAV_TABS.find((tab) => tab.to === `/${scope}`)?.icon ?? 'search'

const resultSections = computed(() =>
  sectionOptions(
    buildSuggestOptions(suggestions.result.value, text.value, { idPrefix: 'palette', maxPerGroup: GLOBAL_PER_GROUP, maxTags: MAX_TAGS, seeAll: true }).filter(
      (option) => option.kind !== 'search',
    ),
  ),
)

function choose(option: SuggestOption): void {
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

// --- Folders, pages, actions and settings ------------------------------------

/** Folder entries of the model libraries, read when the palette opens. */
const folders = shallowRef<Entry[]>([])

async function loadFolders(): Promise<void> {
  const trees = await Promise.allSettled(MODEL_SCOPES.map((prefix) => createModelApi(prefix).folderTree()))
  folders.value = MODEL_SCOPES.flatMap((prefix, index) => {
    const tree = trees[index]
    if (tree.status !== 'fulfilled') return []
    return folderEntries(prefix, scopeLabel(prefix), scopeIcon(prefix), tree.value).map((entry) => ({
      ...entry,
      run: () => void router.push({ path: `/${prefix}`, query: { folder: entry.id.slice(`folder:${prefix}:`.length) } }),
    }))
  })
}

const refresh = useRefresh()
const { activeTheme, density, setTheme, setDensity } = useTheme()
const { scale, setScale } = useAppearance()

const pages = computed<Entry[]>(() =>
  [...NAV_TABS, ...RAIL_PAGES, ...RAIL_TOOLS].map((page) => ({
    id: `page:${page.to}`,
    group: 'pages',
    label: t(page.label),
    icon: page.icon,
    run: () => void router.push(page.to),
  })),
)

const appActions = computed<Entry[]>(() => {
  const scheme = activeTheme.value.scheme === 'dark' ? 'light' : 'dark'
  const nextScale = TEXT_SCALES[(TEXT_SCALES.indexOf(scale.value) + 1) % TEXT_SCALES.length]
  const nextDensity = density.value === 'compact' ? 'comfortable' : 'compact'
  const rail = (id: RailDialog, label: MessageKey, icon: IconName, shortcut?: string): Entry => ({
    id: `action:${id}`,
    group: 'actions',
    label: t(label),
    icon,
    shortcut,
    run: () => emit('dialog', id),
  })
  return [
    ...(refresh.available.value
      ? [{ id: 'action:refresh', group: 'actions', label: t('palette.action.refresh'), icon: 'refresh', shortcut: SHORTCUTS.refresh.keys[0], run: () => void refresh.run() } satisfies Entry]
      : []),
    {
      id: 'action:theme',
      group: 'actions',
      label: t('palette.action.theme', { scheme: t(scheme === 'dark' ? 'palette.action.themeDark' : 'palette.action.themeLight') }),
      icon: scheme === 'dark' ? 'moon' : 'sun',
      run: () => setTheme(scheme === 'dark' ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME),
    },
    { id: 'action:scale', group: 'actions', label: t('palette.action.textSize', { size: t(`appearance.scale.${nextScale}Label`) }), icon: 'type', run: () => setScale(nextScale) },
    {
      id: 'action:density',
      group: 'actions',
      label: t('palette.action.density', { density: t(nextDensity === 'compact' ? 'theme.compact' : 'theme.comfortable') }),
      icon: 'sliders',
      run: () => setDensity(nextDensity),
    },
    rail('help', 'rail.help', 'help', SHORTCUTS.help.keys[0]),
    rail('notifications', 'rail.notifications', 'bell'),
    rail('support', 'rail.support', 'heart'),
  ]
})

const settings = computed<Entry[]>(() =>
  SETTINGS_TABS.flatMap((tab) => {
    const tabLabel = t(tab.title)
    const hint = t('palette.hint.settings', { tab: tabLabel })
    const cards = tab.cards
      .filter((card) => t(card.title) !== tabLabel)
      .map((card): Entry => ({
        id: `settings:${tab.id}:${card.id}`,
        group: 'settings',
        label: t(card.title),
        hint,
        keywords: [card.description ? t(card.description) : '', card.keywords ?? ''].join(' '),
        icon: tab.icon,
        run: () => void router.push({ path: settingsTabPath(tab.id), hash: `#${cardDomId(card.id)}` }),
      }))
    return [
      { id: `settings:${tab.id}`, group: 'settings', label: tabLabel, hint: t('nav.settings'), keywords: t(tab.description), icon: tab.icon, run: () => void router.push(settingsTabPath(tab.id)) } satisfies Entry,
      ...cards,
    ]
  }),
)

const entries = computed<Entry[]>(() => [
  ...folders.value,
  ...pages.value,
  ...pageActions.value.map((action): Entry => ({ ...action, id: `page-action:${action.id}`, group: 'actions' })),
  ...appActions.value,
  ...settings.value,
])
const localSections = computed(() => rankPalette(entries.value, text.value))
const GROUP_LABEL: Record<string, MessageKey> = {
  pages: 'palette.group.pages',
  folders: 'palette.group.folders',
  actions: 'palette.group.actions',
  settings: 'palette.group.settings',
}

const query = computed(() => text.value.trim())
const nothingFound = computed(
  () => !!query.value && !suggestions.loading.value && !resultSections.value.length && !localSections.value.length,
)

// --- Running an entry ---------------------------------------------------------

/** Closes the palette, then runs the entry (a dialog it opens takes the focus from there). */
async function run(action: () => void): Promise<void> {
  open.value = false
  await nextTick()
  action()
}

function searchEverywhere(): void {
  if (!query.value) return
  void run(() => void router.push(globalSearchTarget(query.value)))
}

/** Enter with nothing highlighted (the listbox handles the highlighted case). */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing) return
  event.preventDefault()
  searchEverywhere()
}

watch(open, (value) => {
  if (value) void loadFolders()
})

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** "/" (outside text fields) or Ctrl/Cmd+K opens the palette. */
function onShortcut(event: KeyboardEvent): void {
  if (event.defaultPrevented || open.value) return
  const ctrlK = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k'
  const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditable(event.target)
  if (!ctrlK && !slash) return
  if (rekaLayerOpen()) return
  event.preventDefault()
  open.value = true
}

useEventListener(document, 'keydown', onShortcut)

function focusInput(event: Event): void {
  event.preventDefault()
  const input = document.getElementById('global-search') as HTMLInputElement | null
  input?.focus()
  input?.select()
  command.value?.highlightFirstItem()
}
</script>

<template>
  <CommandDialog v-model:open="open" :title="t('palette.title')" @open-auto-focus="focusInput">
    <Command ref="command">
      <CommandInput
        id="global-search"
        v-model="text"
        list-id="global-search-list"
        :aria-label="t('palette.title')"
        :placeholder="t('palette.placeholder')"
        @keydown="onKeydown"
      >
        <span
          v-if="suggestions.loading.value"
          class="size-[14px] flex-none animate-spinner rounded-pill border-2 border-border border-t-accent"
          role="status"
          :aria-label="t('suggest.loading')"
        ></span>
      </CommandInput>
      <CommandList id="global-search-list" :aria-label="t('palette.title')">
        <CommandGroup
          v-for="section in resultSections"
          :key="section.group"
          :heading="section.group === 'tags' ? t('suggest.tags') : scopeLabel(section.group)"
          :data-group="section.group"
        >
          <CommandItem v-for="option in section.options" :key="option.id" :value="option.id" @select="run(() => choose(option))">
            <template v-if="option.kind === 'item'">
              <SearchThumb :item="option.item" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-fg">
                  <template v-for="(part, index) in splitHighlight(option.item.name, text)" :key="index">
                    <mark v-if="part.match" class="bg-transparent font-bold text-accent">{{ part.text }}</mark>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </span>
                <span v-if="option.item.secondary && option.item.secondary !== option.item.name" class="truncate text-xs text-muted">{{ option.item.secondary }}</span>
              </span>
              <span v-if="option.item.badge" class="lm-badge max-w-[40%] flex-none truncate">{{ option.item.badge }}</span>
              <AppIcon :name="scopeIcon(option.group)" :size="14" class="flex-none text-muted" />
            </template>
            <template v-else-if="option.kind === 'more'">
              <AppIcon name="chevronRight" :size="16" class="flex-none text-muted" />
              <span class="flex-1 text-accent">{{ t('suggest.seeAll', { count: option.total.toLocaleString(), section: scopeLabel(option.scope) }) }}</span>
            </template>
            <template v-else-if="option.kind === 'tag'">
              <AppIcon name="tag" :size="16" class="flex-none text-muted" />
              <span class="min-w-0 flex-1 truncate">{{ option.tag.tag }}</span>
              <span class="flex-none text-xs text-muted tabular-nums">{{ option.tag.count }}</span>
            </template>
          </CommandItem>
        </CommandGroup>

        <CommandGroup v-for="section in localSections" :key="section.group" :heading="t(GROUP_LABEL[section.group])" :data-group="section.group">
          <CommandItem v-for="entry in section.entries" :key="entry.id" :value="entry.id" @select="run(entry.run)">
            <AppIcon :name="entry.icon" :size="16" class="flex-none text-muted" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{{ entry.label }}</span>
              <span v-if="entry.hint" class="truncate text-xs text-muted">{{ entry.hint }}</span>
            </span>
            <CommandShortcut v-if="entry.shortcut">{{ entry.shortcut }}</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandEmpty v-if="nothingFound">{{ t('palette.empty') }}</CommandEmpty>
        <CommandItem v-if="query" value="search-everywhere" data-group="search" class="mt-1" @select="searchEverywhere">
          <AppIcon name="search" :size="16" class="flex-none text-muted" />
          <span class="min-w-0 flex-1 truncate">{{ t('palette.searchAll', { query }) }}</span>
        </CommandItem>
      </CommandList>
    </Command>
  </CommandDialog>
</template>
