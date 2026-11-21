<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import ThemeOptions from './ThemeOptions.vue'
import { useTheme } from '@/composables/useTheme'
import { t } from '@/i18n'

const { activeTheme } = useTheme()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

const icon = computed(() => (activeTheme.value.scheme === 'dark' ? 'moon' : 'sun'))

function onDocumentPointer(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close()
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    close()
    root.value?.querySelector<HTMLButtonElement>('button')?.focus()
  }
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
  <div ref="root" class="relative">
    <button
      type="button"
      class="lm-btn lm-btn--ghost lm-btn--icon"
      :aria-label="t('theme.label')"
      :title="`${t('theme.label')}: ${activeTheme.label}`"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <AppIcon :name="icon" />
    </button>
    <div
      v-if="open"
      ref="panel"
      class="absolute top-[calc(100%+var(--lm-space-2))] right-0 z-50 w-[260px] rounded-md hairline border-border bg-elevated p-3 shadow-lg"
      role="dialog"
      :aria-label="t('theme.label')"
    >
      <ThemeOptions />
    </div>
  </div>
</template>
