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
