/**
 * Column maths shared by the virtual card grid and its loading skeleton, so
 * both always use the same number of columns (no layout jump when the data
 * arrives).
 */

/** Below this content width the grid always allows two columns, whatever the card-size slider says. */
export const PHONE_GRID_WIDTH = 640

export function effectiveMinWidth(width: number, gap: number, minItemWidth: number): number {
  return width > 0 && width < PHONE_GRID_WIDTH ? Math.min(minItemWidth, (width - gap) / 2) : minItemWidth
}

export function gridColumns(width: number, gap: number, minItemWidth: number): number {
  return Math.max(1, Math.floor((width + gap) / (effectiveMinWidth(width, gap, minItemWidth) + gap)))
}

export type GridLayout = 'grid' | 'list'

/** Token values the layout depends on (read from the CSS custom properties by VirtualGrid). */
export interface LayoutTokens {
  /** --lm-card-aspect as width / height. */
  aspect: number
  /** --lm-card-gap in px. */
  cardGap: number
  /** --lm-row-height in px (list rows). */
  rowHeight: number
  /** --lm-row-gap in px (list rows). */
  rowGap: number
}

export interface GridMetrics {
  columns: number
  gap: number
  itemWidth: number
  itemHeight: number
}

/**
 * Cell geometry of the virtual grid and its skeleton. `grid`: columns from the
 * card-size slider, height from the card aspect. `list`: one full-width column
 * of fixed-height rows (the slider does not apply).
 */
export function gridMetrics(layout: GridLayout, width: number, minItemWidth: number, tokens: LayoutTokens): GridMetrics {
  const safeWidth = Math.max(0, width)
  if (layout === 'list') {
    return { columns: 1, gap: Math.max(0, tokens.rowGap), itemWidth: safeWidth, itemHeight: Math.max(1, tokens.rowHeight) }
  }
  const gap = Math.max(0, tokens.cardGap)
  const columns = gridColumns(safeWidth, gap, minItemWidth)
  const itemWidth = (safeWidth - gap * (columns - 1)) / columns
  return { columns, gap, itemWidth, itemHeight: Math.max(40, itemWidth / tokens.aspect) }
}

/** Top offset of the row that holds item `index`. */
export function rowTop(index: number, metrics: GridMetrics): number {
  return Math.floor(index / metrics.columns) * (metrics.itemHeight + metrics.gap)
}

/** A px token value ("56px", "40") as a number, or `fallback`. */
export function parseLength(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * What `VirtualGrid.vue` exposes to its page (`defineExpose`). Declared here
 * because `InstanceType<typeof VirtualGrid>` does not work for a generic
 * component; pages type their template ref with this interface.
 */
export interface VirtualGridExposed {
  scrollToTop(): void
  scrollToIndex(index: number): void
  scrollTo(top: number): void
  scrollOffset(): number
  /** First item of the top visible row and the pixels scrolled into that row (refresh scroll anchor). */
  anchor(): { index: number; offset: number }
  /** Scroll so the row of `index` starts `offset` pixels above the viewport top. */
  scrollToAnchor(index: number, offset: number): void
}

/** Scroll anchor for a scroll offset: the first item of the row at the top, and how far that row is scrolled. */
export function anchorAt(scrollTop: number, metrics: GridMetrics): { index: number; offset: number } {
  const stride = metrics.itemHeight + metrics.gap
  const row = stride > 0 ? Math.max(0, Math.floor(scrollTop / stride)) : 0
  return { index: row * metrics.columns, offset: Math.max(0, scrollTop - row * stride) }
}
