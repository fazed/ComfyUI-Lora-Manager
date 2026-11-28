/** Icon-rail navigation (components/AppRail.vue): the library tabs, the other pages and their active-state logic. */

import type { IconName } from '@/components/icons'
import type { MessageKey } from '@/i18n'

export interface NavTab {
  to: string
  label: MessageKey
  icon: IconName
}

export const NAV_TABS: NavTab[] = [
  { to: '/loras', label: 'nav.loras', icon: 'layers' },
  { to: '/checkpoints', label: 'nav.checkpoints', icon: 'box' },
  { to: '/embeddings', label: 'nav.embeddings', icon: 'type' },
  { to: '/recipes', label: 'nav.recipes', icon: 'book' },
]

/** Pages under the libraries in the rail (Updates and Downloads carry live badges). */
export const RAIL_PAGES: NavTab[] = [
  { to: '/updates', label: 'topbar.updates', icon: 'update' },
  { to: '/downloads', label: 'nav.downloads', icon: 'download' },
  { to: '/stats', label: 'nav.stats', icon: 'chart' },
]

/** Pages at the bottom of the rail, next to Search and Appearance. */
export const RAIL_TOOLS: NavTab[] = [
  { to: '/settings', label: 'nav.settings', icon: 'settings' },
  { to: '/doctor', label: 'nav.doctor', icon: 'pulse' },
]

function normalise(path: string): string {
  const clean = path.split(/[?#]/)[0] || '/'
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean
}

/** A link is active on its own path and on any sub-path (`/loras` for `/loras/x`), never on a sibling prefix (`/lorasx`). */
export function isNavActive(target: string, currentPath: string): boolean {
  const base = normalise(target)
  const current = normalise(currentPath)
  return current === base || current.startsWith(`${base}/`)
}

/** The active tab for a path, or null (Downloads, Settings, search results, not found). */
export function activeTab(currentPath: string): NavTab | null {
  return NAV_TABS.find((tab) => isNavActive(tab.to, currentPath)) ?? null
}

/** Route targets used by the search boxes and the search results page. */
export interface SearchTarget {
  path: string
  query: Record<string, string>
}

const MODEL_PATHS = new Set(['loras', 'checkpoints', 'embeddings'])

export function libraryPath(scope: string): string {
  return `/${scope}`
}

/** A hit: models open their drawer (`?open=<file_path>`), recipes search by title. */
export function itemTarget(scope: string, key: string, name: string): SearchTarget {
  if (MODEL_PATHS.has(scope)) return { path: libraryPath(scope), query: { open: key } }
  return { path: libraryPath(scope), query: { q: name } }
}

/** "See all": the library with its local search prefilled. */
export function seeAllTarget(scope: string, query: string): SearchTarget {
  return { path: libraryPath(scope), query: { q: query.trim() } }
}

/** A tag: model libraries add a tag filter; recipes search for the tag text. */
export function tagTarget(scope: string, tag: string): SearchTarget {
  if (MODEL_PATHS.has(scope)) return { path: libraryPath(scope), query: { tag } }
  return { path: libraryPath(scope), query: { q: tag } }
}

export function globalSearchTarget(query: string): SearchTarget {
  return { path: '/search', query: { q: query.trim() } }
}

/** First value of a route query param as a string ('' when absent). */
export function queryParam(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : ''
}
