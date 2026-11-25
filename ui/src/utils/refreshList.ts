/**
 * In-place refresh of a browse page's virtualised list (library and recipes):
 * re-reads the loaded range and keeps the first visible item where it was.
 */

import { nextTick, type Ref } from 'vue'
import type { ListRefreshOptions } from '@/composables/useInfiniteList'

/** The scroll anchor of the grid: first item of the top visible row, plus the pixels scrolled into that row. */
export interface ScrollAnchor {
  index: number
  offset: number
}

export interface AnchorGrid {
  anchor(): ScrollAnchor
  scrollToAnchor(index: number, offset: number): void
}

export interface RefreshableList<T> {
  readonly items: Readonly<Ref<T[]>>
  refresh(options?: ListRefreshOptions<T>): Promise<void>
}

/**
 * Refresh `list` (at most `maxPages` pages) and, when items were added or
 * removed above the anchor item, scroll so it stays at the same spot. When the
 * anchor item is gone the scroll position is left as it is.
 */
export async function refreshInPlace<T>(
  list: RefreshableList<T>,
  grid: AnchorGrid | null | undefined,
  key: (item: T) => string,
  maxPages: number,
): Promise<void> {
  const before = grid?.anchor()
  const anchorItem = before ? list.items.value[before.index] : undefined
  const anchorKey = anchorItem === undefined ? null : key(anchorItem)
  await list.refresh({ maxPages, key })
  if (!grid || !before || anchorKey === null) return
  const index = list.items.value.findIndex((item) => key(item) === anchorKey)
  if (index < 0 || index === before.index) return
  await nextTick()
  grid.scrollToAnchor(index, before.offset)
}
