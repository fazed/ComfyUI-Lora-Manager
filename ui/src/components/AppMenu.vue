<script setup lang="ts">
/**
 * Top-right "More options" menu: theme + density pickers and the link to the
 * classic UI (both used to live in the removed sidebar / theme button).
 */
import { nextTick, onBeforeUnmount, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import ThemeOptions from './ThemeOptions.vue'
import { useTheme } from '@/composables/useTheme'
import { withMountPrefix } from '@/utils/basePath'
import { t } from '@/i18n'

const { activeTheme } = useTheme()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
const classicUrl = withMountPrefix('/loras')

function onDocumentPointer(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close()
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    close()
    button.value?.focus()
  }
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null
  if (open.value && next && root.value && !root.value.contains(next)) close()
}

async function toggle(): Promise<void> {
  if (open.value) return close()
  open.value = true
  document.addEventListener('pointerdown', onDocumentPointer)
  document.addEventListener('keydown', onKey)
  await nextTick()
  panel.value?.querySelector<HTMLInputElement>('input:checked')?.focus()
}

function close(): void {
  open.value = false
  document.removeEventListener('pointerdown', onDocumentPointer)
  document.removeEventListener('keydown', onKey)
}

onBeforeUnmount(close)
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
