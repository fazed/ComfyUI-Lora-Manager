/**
 * Column layout of the list ("Rows") view (`components/ModelRow.vue`).
 *
 * The date and tags columns are hidden with container queries on the row, so
 * the rule follows the row's own width (an open folder panel narrows the row,
 * not the viewport). The thresholds are derived from the column widths below:
 * a column appears only once the name keeps at least `ROW_NAME_MIN_WIDTH` in
 * the worst case (selection indicator + Send button). `tests/rowColumns.test.ts`
 * pins the numbers and checks that reasoning.
 */
import type { ModelItem } from '@/api/types'

export type RowColumn = 'name' | 'baseModel' | 'size' | 'date' | 'tags'

/** Row content width (px, container query) from which a column is shown. */
export const ROW_COLUMN_MIN_WIDTH = { date: 820, tags: 1060 } as const

/**
 * The matching Tailwind classes ModelRow puts on the cells. Literal strings on
 * purpose: Tailwind generates classes it finds in the source, it cannot see
 * values computed from ROW_COLUMN_MIN_WIDTH. Tested to stay in sync.
 */
export const ROW_COLUMN_HIDE_CLASS = { date: '@max-[820px]:hidden', tags: '@max-[1060px]:hidden' } as const

/**
 * Fixed widths in px at the default density. `thumb` is `--lm-row-thumb` and
 * `baseModel` is `--lm-row-badge-max-width` (both in themes/base.css, checked
 * by the test); `gap` is `gap-3` (`--lm-space-3`) between the cells,
 * `actionGap` is `gap-1` between the 32px icon buttons.
 */
export const ROW_FIXED_WIDTHS = {
  selection: 20,
  thumb: 40,
  baseModel: 140,
  size: 72,
  date: 150,
  tags: 200,
  button: 32,
  actionGap: 4,
  gap: 12,
} as const

/** The name column never gets narrower than this when a column appears (about 28 characters at text-sm). */
export const ROW_NAME_MIN_WIDTH = 200

/** The columns shown at a row content width (desktop and tablet; phones use the two-line layout). */
export function rowColumnsAt(width: number): RowColumn[] {
  const columns: RowColumn[] = ['name', 'baseModel', 'size']
  if (width >= ROW_COLUMN_MIN_WIDTH.date) columns.push('date')
  if (width >= ROW_COLUMN_MIN_WIDTH.tags) columns.push('tags')
  return columns
}

export interface RowNameWidthOptions {
  /** Selection mode: the checkbox-style indicator is shown. */
  selection?: boolean
  /** The Send button is shown (LoRAs). */
  send?: boolean
  /** Override the visible columns (default: `rowColumnsAt(width)`). */
  columns?: RowColumn[]
}

/** Width left for the name at a row content width. */
export function rowNameWidth(width: number, options: RowNameWidthOptions = {}): number {
  const w = ROW_FIXED_WIDTHS
  const columns = options.columns ?? rowColumnsAt(width)
  const buttons = options.send ? 3 : 2
  const fixed: number[] = [w.thumb, buttons * w.button + (buttons - 1) * w.actionGap]
  if (options.selection) fixed.push(w.selection)
  if (columns.includes('baseModel')) fixed.push(w.baseModel)
  if (columns.includes('size')) fixed.push(w.size)
  if (columns.includes('date')) fixed.push(w.date)
  if (columns.includes('tags')) fixed.push(w.tags)
  // Flex items: the fixed ones plus the name; one gap between each pair.
  const gaps = fixed.length * w.gap
  return width - fixed.reduce((sum, value) => sum + value, 0) - gaps
}

export interface RowCellTexts {
  folder: string
  size: string
  date: string
  tags: string
}

/**
 * Tooltip of the full-row button: every cell in full, one per line, also the
 * columns hidden at the current width. The cells themselves do not take the
 * pointer (clicks go to the row button), so their own `title` never shows on
 * hover; this is what a mouse user sees for a truncated name, folder, base
 * model or tag list.
 */
export function rowTooltip(item: Pick<ModelItem, 'model_name' | 'file_name' | 'base_model'>, texts: RowCellTexts): string {
  const sizeDate = [texts.size, texts.date].filter(Boolean).join(' · ')
  return [item.model_name || item.file_name, texts.folder, item.base_model, sizeDate, texts.tags].filter(Boolean).join('\n')
}
