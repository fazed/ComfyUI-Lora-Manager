/**
 * Folder tree panel of a library page: hidden by default, remembered per
 * library in localStorage (`lm-ui.library.<prefix>.folders`, failures ignored).
 *
 * At or below the `narrow` breakpoint the panel is an overlay over the grid,
 * so it always starts closed there and toggling it is not remembered.
 */

import { ref, type Ref } from 'vue'
import { readToggle } from './usePersistentToggle'
import { writeStorage } from '@/utils/storage'

/** Same threshold as the `narrow:` variant (max-width: 1100px). */
export const FOLDER_OVERLAY_MAX_WIDTH = 1100

export function folderPanelKey(prefix: string): string {
  return `lm-ui.library.${prefix}.folders`
}

export function isFolderOverlay(viewportWidth: number): boolean {
  return viewportWidth <= FOLDER_OVERLAY_MAX_WIDTH
}

export function initialFolderPanel(prefix: string, viewportWidth: number): boolean {
  return !isFolderOverlay(viewportWidth) && readToggle(folderPanelKey(prefix), false)
}

export interface FolderPanel {
  open: Ref<boolean>
  set: (value: boolean) => void
  toggle: () => void
  /** True while the panel overlays the grid (narrow viewports). */
  isOverlay: () => boolean
}

export function useFolderPanel(prefix: string, viewportWidth: () => number = () => window.innerWidth): FolderPanel {
  const open = ref(initialFolderPanel(prefix, viewportWidth()))
  const isOverlay = () => isFolderOverlay(viewportWidth())

  function set(value: boolean): void {
    open.value = value
    if (!isOverlay()) writeStorage(folderPanelKey(prefix), value ? 'true' : 'false')
  }

  return { open, set, toggle: () => set(!open.value), isOverlay }
}
