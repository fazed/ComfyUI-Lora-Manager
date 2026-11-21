/** Pure helpers of the model drawer (ModelDrawer.vue). */

/**
 * Roving-tabindex tab navigation (WAI-ARIA tabs, automatic activation):
 * returns the index to focus and select, or null when the key is not handled.
 */
export function nextTab(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  if (key === 'ArrowRight') return (index + 1) % count
  if (key === 'ArrowLeft') return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** Closing the drawer asks for confirmation only while there are unsaved notes. */
export function shouldConfirmClose(notesDirty: boolean): boolean {
  return notesDirty
}

/** The Civitai version this library file belongs to (item first, then the loaded metadata). */
export function currentVersionId(
  item: { civitai?: { id?: number | null } | null },
  metadata: { id?: number | null } | null | undefined,
): number | null {
  return item.civitai?.id ?? metadata?.id ?? null
}
