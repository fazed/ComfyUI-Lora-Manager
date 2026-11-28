/**
 * Actions of the current page for the command palette (GlobalSearchDialog):
 * a library page publishes Download, Select, the folder panel and its Tools
 * while it is mounted, the same way pages register their refresh handler.
 * Each entry runs what the page's own button runs.
 */

import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { IconName } from '@/components/icons'

export interface PageAction {
  id: string
  label: string
  icon: IconName
  /** Key hint shown in the palette (from config/shortcuts.ts). */
  shortcut?: string
  run: () => void
}

const current = shallowRef<{ id: number; actions: () => PageAction[] } | null>(null)
let nextId = 1

export const pageActions = computed(() => current.value?.actions() ?? [])

export function usePageActions(actions: () => PageAction[]): void {
  const id = nextId++
  onMounted(() => {
    current.value = { id, actions }
  })
  onBeforeUnmount(() => {
    if (current.value?.id === id) current.value = null
  })
}
