<script setup lang="ts">
/**
 * Refresh button of the current page (see composables/useRefresh.ts). Renders
 * nothing when the page has no refresh handler or shows its own control.
 *
 * - `icon` (default): a 36px icon button with the "Refresh" accessible name.
 * - `row`: a full-width labelled 44px row (the phone filter sheet).
 *
 * While a refresh runs the label and tooltip say what it does ("Scanning
 * library..." during the rescan of the browse pages, then "Refreshing..."),
 * the icon turns (transform only; no rotation for
 * prefers-reduced-motion), the button is `aria-busy` and `aria-disabled`
 * (not `disabled`, so keyboard focus stays on it) and ignores clicks.
 */
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { useRefresh } from '@/composables/useRefresh'
import { SHORTCUTS } from '@/config/shortcuts'
import { t } from '@/i18n'

const props = withDefaults(defineProps<{ variant?: 'icon' | 'row'; hint?: string }>(), { variant: 'icon', hint: '' })

const refresh = useRefresh()
const busy = computed(() => refresh.busy.value)
const busyLabel = computed(() => (refresh.phase.value === 'scanning' ? t('refresh.scanning') : t('refresh.busy')))
const tooltip = computed(() => (busy.value ? busyLabel.value : props.hint || t('refresh.tooltip')))

function onClick(): void {
  if (!busy.value) void refresh.run()
}
</script>

<template>
  <button
    v-if="refresh.showButton.value"
    type="button"
    :class="variant === 'row' ? 'lm-btn min-h-touch justify-start' : 'lm-btn lm-btn--icon flex-none phone:size-touch'"
    :aria-label="variant === 'icon' ? (busy ? busyLabel : t('refresh.label')) : undefined"
    :aria-busy="busy || undefined"
    :aria-disabled="busy || undefined"
    :aria-keyshortcuts="SHORTCUTS.refresh.aria"
    :title="tooltip"
    data-refresh
    @click="onClick"
  >
    <AppIcon name="reload" :size="16" :class="busy ? 'animate-spinner motion-reduce:animate-none' : undefined" />
    <span v-if="variant === 'row'">{{ busy ? busyLabel : t('refresh.label') }}</span>
  </button>
</template>
