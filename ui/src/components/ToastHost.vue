<script setup lang="ts">
/**
 * App-wide toasts, bottom centre, drawn inverted (text colour on the page
 * colour) so they stand out in both themes without a colour of their own; the
 * kind shows as the icon. Hovering the stack or moving focus into it (Tab to
 * an Undo button) pauses every auto-dismiss timer until the pointer / focus
 * leaves again (useToasts().hold / release). Alt+T moves the focus to the
 * newest message (its Undo button first); acting on it or closing it returns
 * the focus to where it was.
 */
import { nextTick, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import AppIcon, { type IconName } from './AppIcon.vue'
import { useToasts, type ToastKind } from '@/composables/useFeedback'
import { SHORTCUTS } from '@/config/shortcuts'
import { t } from '@/i18n'

const { toasts, dismiss, hold, release } = useToasts()
const host = ref<HTMLElement | null>(null)
/** Focus before Alt+T, restored after the toast it reached is acted on or closed. */
let returnFocus: HTMLElement | null = null

useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  // `code`: Alt+T types a symbol in `key` on macOS.
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.code !== 'KeyT' || !toasts.value.length) return
  const items = host.value?.querySelectorAll('[data-toast]')
  const target = items?.[items.length - 1]?.querySelector('button')
  if (!target) return
  event.preventDefault()
  if (!host.value?.contains(document.activeElement)) returnFocus = document.activeElement as HTMLElement | null
  target.focus()
})

async function close(id: number, action?: () => void): Promise<void> {
  const hadFocus = !!host.value?.contains(document.activeElement)
  action?.()
  dismiss(id)
  if (!hadFocus) return
  await nextTick()
  returnFocus?.focus()
  returnFocus = null
}

const ICON: Record<ToastKind, IconName> = { info: 'sparkle', success: 'check', warning: 'alert', error: 'alert' }

function onFocusOut(event: FocusEvent): void {
  const host = event.currentTarget as HTMLElement
  if (!host.contains(event.relatedTarget as Node | null)) release()
}
</script>

<template>
  <!-- pointer-events-auto: toast actions (Undo) stay clickable while a modal Reka layer disables the page. -->
  <div
    ref="host"
    class="pointer-events-auto fixed bottom-[2.75rem] left-1/2 z-90 flex w-max max-w-[min(30rem,calc(100vw-var(--lm-space-8)))] -translate-x-1/2 flex-col items-center gap-2 phone:bottom-[4.5rem]"
    data-toast-host
    role="status"
    aria-live="polite"
    @pointerenter="hold"
    @pointerleave="release"
    @focusin="hold"
    @focusout="onFocusOut"
  >
    <TransitionGroup
      enter-active-class="transition-[opacity,translate] duration-(--lm-motion-normal)"
      leave-active-class="transition-[opacity,translate] duration-(--lm-motion-normal)"
      enter-from-class="translate-y-[8px] opacity-0"
      leave-to-class="translate-y-[8px] opacity-0"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="flex max-w-full items-center gap-3 rounded-md bg-fg py-2 pr-2 pl-3 text-sm text-page shadow-lg"
        :data-kind="toast.kind"
        data-toast
      >
        <AppIcon :name="ICON[toast.kind]" class="flex-none" />
        <span class="min-w-0 flex-1 whitespace-pre-line">{{ toast.message }}</span>
        <button
          v-if="toast.action"
          type="button"
          class="min-h-control-sm flex-none cursor-pointer rounded-sm px-2 font-bold underline underline-offset-2 focus-visible:outline-page"
          :aria-keyshortcuts="SHORTCUTS.toasts.aria"
          @click="close(toast.id, toast.action.run)"
        >
          {{ toast.action.label }}
        </button>
        <button
          type="button"
          class="inline-grid size-control-sm flex-none cursor-pointer place-items-center rounded-sm focus-visible:outline-page"
          :aria-label="t('common.close')"
          @click="close(toast.id)"
        >
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
