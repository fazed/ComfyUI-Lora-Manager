/**
 * Command palette ranking (components/GlobalSearchDialog.vue): the local
 * groups (pages, folders, actions, settings) are matched here; models,
 * recipes and tags come from the search suggester (utils/suggest.ts).
 */

import type { IconName } from '@/components/icons'
import type { FolderTree } from '@/api/types'
import { flattenFolderTree } from './modelActions'
import { matchRank } from './suggest'

export type PaletteGroup = 'pages' | 'folders' | 'actions' | 'settings'

/** Display order of the local groups (after the model and tag results). */
export const PALETTE_GROUPS: PaletteGroup[] = ['folders', 'pages', 'actions', 'settings']
/** Entries per group while typing. */
export const PALETTE_PER_GROUP = 5
/** Groups listed before anything is typed. */
const IDLE_GROUPS: PaletteGroup[] = ['pages', 'actions']

export interface PaletteEntry {
  id: string
  group: PaletteGroup
  label: string
  /** Second line (folder library, settings tab). */
  hint?: string
  /** Extra words matched besides the label (settings keywords, descriptions). */
  keywords?: string
  icon: IconName
  /** Key hint (config/shortcuts.ts). */
  shortcut?: string
}

export interface PaletteSection<T extends PaletteEntry = PaletteEntry> {
  group: PaletteGroup
  entries: T[]
}

/** 0-2: the label matches (prefix, word, substring); 3: only the hint or keywords; null: no match. */
export function paletteScore(entry: PaletteEntry, query: string): number | null {
  const byLabel = matchRank(entry.label, query)
  if (byLabel < 3) return byLabel
  const extra = `${entry.hint ?? ''} ${entry.keywords ?? ''}`
  return matchRank(extra, query) < 3 ? 3 : null
}

/**
 * Sections in PALETTE_GROUPS order. Without a query: the pages and actions as
 * listed. With one: every group's matches, best first (stable), at most
 * `perGroup` each; empty groups are left out.
 */
export function rankPalette<T extends PaletteEntry>(entries: T[], query: string, perGroup = PALETTE_PER_GROUP): PaletteSection<T>[] {
  const needle = query.trim()
  const sections: PaletteSection<T>[] = []
  for (const group of PALETTE_GROUPS) {
    const inGroup = entries.filter((entry) => entry.group === group)
    let ranked: T[]
    if (!needle) ranked = IDLE_GROUPS.includes(group) ? inGroup : []
    else {
      ranked = inGroup
        .map((entry, index) => ({ entry, index, score: paletteScore(entry, needle) }))
        .filter((hit): hit is { entry: T; index: number; score: number } => hit.score !== null)
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .slice(0, perGroup)
        .map((hit) => hit.entry)
    }
    if (ranked.length) sections.push({ group, entries: ranked })
  }
  return sections
}

/** Folder entries of one library's tree; the id carries the library and path (`folder:<prefix>:<path>`). */
export function folderEntries(prefix: string, library: string, icon: IconName, tree: FolderTree): PaletteEntry[] {
  return flattenFolderTree(tree).map((path) => ({
    id: `folder:${prefix}:${path}`,
    group: 'folders',
    label: path.split('/').pop() ?? path,
    hint: `${library} › ${path}`,
    icon,
  }))
}
