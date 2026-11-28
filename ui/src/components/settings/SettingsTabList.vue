<script setup lang="ts">
/**
 * WAI-ARIA tab list of the Settings page: roving tabindex (only the selected
 * tab is in the Tab order), arrow keys / Home / End move and select
 * (automatic activation), aria-selected + aria-controls on the selected tab.
 * Vertical on wide screens, a horizontally scrolling strip below the
 * `tablet:` breakpoint (the parent passes the orientation). Each tab shows
 * an unsaved-changes count and, while searching, its number of matches. The
 * selected tab is filled with the highlight colour (like the rail).
 */
import { nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { rovingIndex, type ResolvedTab } from '@/utils/settingsTabs'
import { t } from '@/i18n'

const props = defineProps<{
  tabs: ResolvedTab[]
  active: string
  orientation: 'vertical' | 'horizontal'
  /** Unsaved changes per tab. */
  changes: Record<string, number>
  /** Search matches per tab; null when not searching. */
  matches: Record<string, number> | null
}>()
const emit = defineEmits<{ select: [id: string] }>()
const buttons = ref<HTMLButtonElement[]>([])

function onKey(event: KeyboardEvent, index: number): void {
  const next = rovingIndex(event.key, index, props.tabs.length)
  if (next === null) return
  event.preventDefault()
  emit('select', props.tabs[next].id)
  void nextTick(() => buttons.value[next]?.focus())
}

// Keep the selected tab visible in the horizontal strip.
watch(
  () => [props.active, props.orientation] as const,
  async () => {
    await nextTick()
    const index = props.tabs.findIndex((tab) => tab.id === props.active)
    buttons.value[index]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  },
  { immediate: true },
)
</script>

<template>
  <div
    role="tablist"
    :aria-label="t('set.tabs')"
    :aria-orientation="orientation"
    class="flex gap-1"
    :class="orientation === 'vertical' ? 'flex-col' : 'overflow-x-auto [scrollbar-width:thin]'"
  >
    <button
      v-for="(tab, index) in tabs"
      :id="`settings-tab-${tab.id}`"
      :key="tab.id"
      ref="buttons"
      type="button"
      role="tab"
      :aria-selected="tab.id === active"
      :aria-controls="tab.id === active ? `settings-panel-${tab.id}` : undefined"
      :tabindex="tab.id === active ? 0 : -1"
      class="lm-row lm-row--nav flex min-h-control flex-none cursor-pointer items-center gap-2 px-3 text-left text-sm"
      :class="[tab.id === active ? 'bg-accent font-medium text-on-accent hover:bg-accent-hover' : 'text-muted hover:text-fg', orientation === 'horizontal' ? 'whitespace-nowrap' : 'w-full']"
      @click="emit('select', tab.id)"
      @keydown="onKey($event, index)"
    >
      <AppIcon :name="tab.icon" :size="16" class="flex-none" />
      <span class="min-w-0 flex-1 truncate">{{ t(tab.title) }}</span>
      <span v-if="matches && matches[tab.id]" class="lm-badge tabular-nums">
        {{ matches[tab.id] }}<span class="sr-only"> {{ t('set.tabMatches', { count: matches[tab.id] }) }}</span>
      </span>
      <span v-if="changes[tab.id]" class="lm-badge lm-badge--accent tabular-nums" :class="{ 'bg-on-accent': tab.id === active }" :title="t('set.tabChanges', { count: changes[tab.id] })">
        <span class="size-[6px] rounded-pill bg-accent" aria-hidden="true"></span>{{ changes[tab.id] }}<span class="sr-only"> {{ t('set.tabChanges', { count: changes[tab.id] }) }}</span>
      </span>
    </button>
  </div>
</template>
