<script setup lang="ts">
/**
 * Top-right "More options" menu: theme + density pickers and the link to the
 * classic UI (both used to live in the removed sidebar / theme button).
 */
import { nextTick, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import ThemeOptions from './ThemeOptions.vue'
import { useDismissLayer } from '@/composables/useDismiss'
import { useTheme } from '@/composables/useTheme'
import { withMountPrefix } from '@/utils/basePath'
import { t } from '@/i18n'

const { activeTheme } = useTheme()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
const classicUrl = withMountPrefix('/loras')
const pages = [
  { to: '/stats', label: 'nav.stats', icon: 'chart' },
  { to: '/doctor', label: 'nav.doctor', icon: 'pulse' },
] as const

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null
  if (open.value && next && root.value && !root.value.contains(next)) close()
}

async function toggle(): Promise<void> {
  if (open.value) return close()
  open.value = true
  await nextTick()
  panel.value?.querySelector<HTMLInputElement>('input:checked')?.focus()
}

function close(): void {
  open.value = false
}

// Outside pointerdown or Escape closes (Escape returns focus to the button).
useDismissLayer({
  active: () => open.value,
  close: (reason) => {
    close()
    if (reason === 'escape') button.value?.focus()
  },
  outside: () => [root.value],
})
</script>

<template>
  <div ref="root" class="relative" @focusout="onFocusOut">
    <button
      ref="button"
      type="button"
      class="lm-btn lm-btn--ghost lm-btn--icon text-muted hover:text-fg"
      :aria-label="t('nav.more')"
      :title="`${t('nav.more')} (${t('theme.label')}: ${activeTheme.label}, ${t('nav.classic')})`"
      aria-haspopup="dialog"
      :aria-expanded="open"
      aria-controls="app-menu"
      @click="toggle"
    >
      <AppIcon name="more" />
    </button>
    <div
      v-if="open"
      id="app-menu"
      ref="panel"
      class="absolute top-[calc(100%+var(--lm-space-2))] right-0 z-50 flex w-[260px] flex-col gap-3 rounded-md hairline border-border bg-elevated p-3 shadow-lg"
      role="dialog"
      :aria-label="t('nav.more')"
    >
      <ThemeOptions />
      <div class="flex flex-col hairline-t border-border pt-3">
        <RouterLink
          v-for="link in pages"
          :key="link.to"
          class="lm-row lm-row--nav flex min-h-control items-center gap-2 px-2 text-sm font-medium no-underline"
          :to="link.to"
          @click="close"
        >
          <AppIcon :name="link.icon" :size="16" />
          <span>{{ t(link.label) }}</span>
        </RouterLink>
      </div>
      <div class="hairline-t border-border pt-3">
        <a
          class="lm-row lm-row--nav flex min-h-control items-center gap-2 px-2 text-sm font-medium no-underline"
          :href="classicUrl"
          :title="t('nav.classicHint')"
        >
          <AppIcon name="external" :size="16" />
          <span>{{ t('nav.classic') }}</span>
        </a>
      </div>
    </div>
  </div>
</template>
