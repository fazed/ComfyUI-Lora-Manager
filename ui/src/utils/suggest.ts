/**
 * Search autocomplete core, shared by the global top-bar search and the local
 * library search: highlight splitting, ranking, grouped merging, a tiny LRU
 * cache and a framework-free suggester that aborts the previous lookup.
 *
 * There is no dedicated suggest endpoint in the backend, so a lookup is a set
 * of parallel requests planned per scope (see api/suggestSource.ts):
 *   - groups: GET /api/lm/{prefix}/list?search=...  (recipes: GET /api/lm/recipes?search=...)
 *   - tags:   GET /api/lm/{prefix}/search-tags?q=... (recipes: /api/lm/recipes/search-tags)
 */

export const SUGGEST_MIN_CHARS = 2
export const SUGGEST_DEBOUNCE_MS = 150

export interface HighlightPart {
  text: string
  match: boolean
}

/**
 * Splits `text` into plain and matching parts (case-insensitive, every
 * non-overlapping occurrence). Rendered as text nodes, never as HTML.
 */
export function splitHighlight(text: string, query: string): HighlightPart[] {
  const needle = query.trim().toLowerCase()
  if (!text) return []
  const haystack = text.toLowerCase()
  // Some characters change length when lower-cased; indexes would drift, so skip highlighting.
  if (!needle || haystack.length !== text.length) return [{ text, match: false }]
  const parts: HighlightPart[] = []
  let cursor = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false })
    parts.push({ text: text.slice(index, index + needle.length), match: true })
    cursor = index + needle.length
    index = haystack.indexOf(needle, cursor)
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false })
  return parts
}

/** 0 = starts with, 1 = a word starts with, 2 = contains, 3 = no match. */
export function matchRank(value: string, query: string): number {
  const haystack = value.toLowerCase()
  const needle = query.trim().toLowerCase()
  if (!needle) return 3
  if (haystack.startsWith(needle)) return 0
  const index = haystack.indexOf(needle)
  if (index === -1) return 3
  for (let at = index; at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (!/[\p{L}\p{N}]/u.test(haystack[at - 1] ?? '')) return 1
  }
  return 2
}

/** A suggested library entry (model or recipe), already mapped for display. */
export interface SuggestItem {
  key: string
  name: string
  /** Secondary text matched when the name does not (file name). */
  secondary?: string
  badge?: string
  thumb?: string
  nsfwLevel?: number
  payload: unknown
}

export interface SuggestTag {
  tag: string
  count: number
}

/** Items of one library (scope) plus its total hit count. */
export interface SuggestGroup {
  scope: string
  items: SuggestItem[]
  total: number
}

export interface SuggestResult {
  groups: SuggestGroup[]
  tags: SuggestTag[]
  /** Library the tags belong to (tag choices filter that library). */
  tagScope: string | null
  /** True when every request failed; the UI then only offers the plain search. */
  failed: boolean
}

export type SuggestOption =
  | { kind: 'item'; id: string; group: string; item: SuggestItem }
  | { kind: 'more'; id: string; group: string; scope: string; total: number }
  | { kind: 'tag'; id: string; group: 'tags'; tag: SuggestTag; scope: string | null }
  | { kind: 'search'; id: string; group: 'search'; query: string }

export interface BuildOptions {
  idPrefix: string
  /** Items shown per group. */
  maxPerGroup: number
  maxTags: number
  /** Adds a "See all N results" row to a group with more hits than shown. */
  seeAll?: boolean
  /** Tags already used as filters are not suggested again. */
  activeTags?: string[]
}

function stableSort<T>(list: T[], compare: (a: T, b: T) => number): T[] {
  return list
    .map((value, index) => ({ value, index }))
    .sort((a, b) => compare(a.value, b.value) || a.index - b.index)
    .map((entry) => entry.value)
}

/** Dedupes and ranks items: name matches first (prefix, word, substring), then file-name matches, then the rest. */
export function rankItems(items: SuggestItem[], query: string, max: number): SuggestItem[] {
  const seen = new Set<string>()
  const unique = items.filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)))
  const score = (item: SuggestItem) => {
    const byName = matchRank(item.name, query)
    if (byName < 3) return byName
    return item.secondary && matchRank(item.secondary, query) < 3 ? 3 : 4
  }
  return stableSort(unique, (a, b) => score(a) - score(b)).slice(0, max)
}

/** Dedupes (case-insensitive), drops active tags, ranks exact > prefix > word > substring, then by count. */
export function rankTags(tags: SuggestTag[], query: string, max: number, activeTags: string[] = []): SuggestTag[] {
  const needle = query.trim().toLowerCase()
  const skip = new Set(activeTags.map((tag) => tag.toLowerCase()))
  const seen = new Set<string>()
  const unique = tags.filter((entry) => {
    const key = entry.tag?.toLowerCase()
    if (!key || skip.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const score = (entry: SuggestTag) => (entry.tag.toLowerCase() === needle ? -1 : matchRank(entry.tag, needle))
  return stableSort(unique, (a, b) => score(a) - score(b) || (b.count ?? 0) - (a.count ?? 0)).slice(0, max)
}

/**
 * Flat option list in display order: each non-empty group (in the order the
 * result lists them) with its ranked items and optional "See all" row, then
 * tags, then the plain-search row (always last).
 */
export function buildSuggestOptions(result: SuggestResult | null, query: string, options: BuildOptions): SuggestOption[] {
  const out: SuggestOption[] = []
  let n = 0
  const id = () => `${options.idPrefix}-opt-${n++}`
  if (result) {
    for (const group of result.groups) {
      const items = rankItems(group.items, query, options.maxPerGroup)
      if (!items.length) continue
      for (const item of items) out.push({ kind: 'item', id: id(), group: group.scope, item })
      const total = Math.max(group.total, group.items.length)
      if (options.seeAll && total > items.length) {
        out.push({ kind: 'more', id: id(), group: group.scope, scope: group.scope, total })
      }
    }
    for (const tag of rankTags(result.tags, query, options.maxTags, options.activeTags)) {
      out.push({ kind: 'tag', id: id(), group: 'tags', tag, scope: result.tagScope })
    }
  }
  const trimmed = query.trim()
  if (trimmed) out.push({ kind: 'search', id: id(), group: 'search', query: trimmed })
  return out
}

export interface OptionSection {
  group: string
  options: SuggestOption[]
}

/** Consecutive options of the same group, for rendering section headers. */
export function sectionOptions(options: SuggestOption[]): OptionSection[] {
  const sections: OptionSection[] = []
  for (const option of options) {
    const last = sections[sections.length - 1]
    if (last && last.group === option.group) last.options.push(option)
    else sections.push({ group: option.group, options: [option] })
  }
  return sections
}

/** Next active index for Up/Down with wrap-around; -1 means "nothing active". */
export function moveActive(current: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return -1
  if (current < 0) return delta === 1 ? 0 : count - 1
  return (current + delta + count) % count
}

/** Minimal LRU cache (Map keeps insertion order; a hit re-inserts the key). */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>()
  constructor(private readonly limit: number) {}

  get size(): number {
    return this.map.size
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key) as V
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value as K
      this.map.delete(oldest)
    }
  }

  clear(): void {
    this.map.clear()
  }
}

/** Which requests a lookup in a scope makes. */
export interface SuggestPlan {
  /** Item groups, in display order. */
  groups: string[]
  /** Library whose search-tags endpoint is asked (null = no tags). */
  tagScope: string | null
  /** Items fetched per group (a few more than shown, so ranking can pick). */
  limit: number
}

export interface SuggestSource {
  plan(scope: string): SuggestPlan
  items(group: string, query: string, limit: number, signal: AbortSignal): Promise<{ items: SuggestItem[]; total: number }>
  tags(tagScope: string, query: string, limit: number, signal: AbortSignal): Promise<SuggestTag[]>
}

export interface Suggester {
  /** Resolves with the result, or null when superseded by a newer call / cancel(). */
  suggest(scope: string, query: string): Promise<SuggestResult | null>
  cancel(): void
  readonly cache: LruCache<string, SuggestResult>
}

export const TAG_FETCH_LIMIT = 8

/**
 * Runs the planned requests in parallel. Each call aborts the previous
 * in-flight lookup; results are cached per scope + normalised query, and only
 * when every request succeeded (a failed group comes back empty, uncached).
 */
export function suggestCacheKey(scope: string, query: string): string {
  return `${scope}\u0000${query.trim().toLowerCase()}`
}

export function createSuggester(source: SuggestSource, cache = new LruCache<string, SuggestResult>(40)): Suggester {
  let controller: AbortController | null = null

  function cancel(): void {
    controller?.abort()
    controller = null
  }

  async function suggest(scope: string, query: string): Promise<SuggestResult | null> {
    cancel()
    const text = query.trim()
    const key = suggestCacheKey(scope, text)
    const hit = cache.get(key)
    if (hit) return hit
    const current = new AbortController()
    controller = current
    const plan = source.plan(scope)
    const [tagOutcome, ...groupOutcomes] = await Promise.allSettled([
      plan.tagScope ? source.tags(plan.tagScope, text, TAG_FETCH_LIMIT, current.signal) : Promise.resolve([]),
      ...plan.groups.map((group) => source.items(group, text, plan.limit, current.signal)),
    ])
    if (current.signal.aborted) return null
    controller = null
    const groups: SuggestGroup[] = plan.groups.map((group, index) => {
      const outcome = groupOutcomes[index]
      return outcome.status === 'fulfilled'
        ? { scope: group, items: outcome.value.items, total: outcome.value.total }
        : { scope: group, items: [], total: 0 }
    })
    const outcomes = plan.tagScope ? [tagOutcome, ...groupOutcomes] : groupOutcomes
    const result: SuggestResult = {
      groups,
      tags: tagOutcome.status === 'fulfilled' ? (tagOutcome.value as SuggestTag[]) : [],
      tagScope: plan.tagScope,
      failed: outcomes.every((outcome) => outcome.status === 'rejected'),
    }
    if (outcomes.every((outcome) => outcome.status === 'fulfilled')) cache.set(key, result)
    return result
  }

  return { suggest, cancel, cache }
}
