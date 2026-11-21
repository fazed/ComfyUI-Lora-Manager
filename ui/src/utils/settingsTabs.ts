/**
 * Settings page presentation model (pure): tabs and cards resolved from
 * config/settingsTabs.ts, the tab <-> URL mapping (including the legacy
 * `#set-<section>` / `#field-<key>` deep links), search across all tabs,
 * per-tab change counts and the "reset to default" rules.
 */

import type { SectionDef } from '@/config/settingsSchema'
import type { SettingsPanelId, SettingsTabIcon, TabDef } from '@/config/settingsTabs'
import { DEFAULT_SETTINGS_TAB } from '@/config/settingsTabs'
import { t, type MessageKey } from '@/i18n'
import { isVisible, resetToDefault, splitList, toSaveValue, type Draft, type DraftValue, type FieldDef } from '@/utils/settingsModel'

export interface ResolvedCard {
  id: string
  tabId: string
  title: MessageKey
  description?: MessageKey
  tone?: 'danger'
  fields: FieldDef[]
  panels: SettingsPanelId[]
  keywords: string
}

export interface ResolvedTab {
  id: string
  title: MessageKey
  description: MessageKey
  icon: SettingsTabIcon
  cards: ResolvedCard[]
}

/** Resolves the keys of the tab config to schema fields; throws on unknown or unplaced keys. */
export function buildTabs(tabs: TabDef[], fields: FieldDef[]): ResolvedTab[] {
  const byKey = new Map(fields.map((field) => [field.key, field]))
  const placed = new Set<string>()
  const resolved = tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    description: tab.description,
    icon: tab.icon,
    cards: tab.cards.map((card) => ({
      id: card.id,
      tabId: tab.id,
      title: card.title,
      description: card.description,
      tone: card.tone,
      panels: card.panels ?? [],
      keywords: card.keywords ?? '',
      fields: card.fields.map((key) => {
        const field = byKey.get(key)
        if (!field) throw new Error(`settings tabs: unknown field "${key}"`)
        placed.add(key)
        return field
      }),
    })),
  }))
  const missing = fields.filter((field) => !placed.has(field.key)).map((field) => field.key)
  if (missing.length) throw new Error(`settings tabs: fields not placed in any card: ${missing.join(', ')}`)
  return resolved
}

export function tabOfField(tabs: ResolvedTab[], key: string): string | null {
  return tabs.find((tab) => tab.cards.some((card) => card.fields.some((field) => field.key === key)))?.id ?? null
}

function cardOfField(tabs: ResolvedTab[], key: string): ResolvedCard | null {
  for (const tab of tabs) for (const card of tab.cards) if (card.fields.some((field) => field.key === key)) return card
  return null
}

// --------------------------------------------------------------------------- URL

export const fieldDomId = (key: string) => `field-${key.replace(/[^\w-]/g, '_')}`
export const cardDomId = (id: string) => `card-${id}`
export const settingsTabPath = (tab: string) => `/settings/${tab}`

export interface SettingsLocation {
  tab: string
  /** Field to scroll to / focus (deep link). */
  fieldKey: string | null
  /** Card to scroll to (deep link to a section or card). */
  cardId: string | null
}

/**
 * Which tab to show for a URL. Order: a resolvable hash (`#field-<key>`,
 * `#card-<id>`, legacy `#set-<section>`), the route param, the remembered
 * tab, the default tab.
 */
export function resolveSettingsLocation(
  tabs: ResolvedTab[],
  sections: SectionDef[],
  input: { param?: string | null; hash?: string | null; stored?: string | null },
): SettingsLocation {
  const known = (id: string | null | undefined) => !!id && tabs.some((tab) => tab.id === id)
  const hash = (input.hash ?? '').replace(/^#/, '')
  if (hash.startsWith('field-')) {
    for (const tab of tabs) {
      for (const card of tab.cards) {
        const field = card.fields.find((f) => fieldDomId(f.key) === hash)
        if (field) return { tab: tab.id, fieldKey: field.key, cardId: card.id }
      }
    }
  } else if (hash.startsWith('card-')) {
    const card = tabs.flatMap((tab) => tab.cards).find((c) => cardDomId(c.id) === hash)
    if (card) return { tab: card.tabId, fieldKey: null, cardId: card.id }
  } else if (hash.startsWith('set-')) {
    const section = sections.find((s) => `set-${s.id}` === hash)
    const card = section ? (section.fields[0] ? cardOfField(tabs, section.fields[0].key) : tabs.flatMap((tab) => tab.cards).find((c) => c.panels.some((p) => section.panels?.includes(p as never)))) : null
    if (card) return { tab: card.tabId, fieldKey: null, cardId: card.id }
  }
  const tab = known(input.param) ? input.param! : known(input.stored) ? input.stored! : DEFAULT_SETTINGS_TAB
  return { tab, fieldKey: null, cardId: null }
}

// --------------------------------------------------------------------------- search

export interface SearchHit {
  tabId: string
  cardId: string
  cardTitle: MessageKey
  /** The matching field; undefined for a panel (card-level) hit. */
  field?: FieldDef
}

export interface SearchResult {
  groups: { tab: ResolvedTab; hits: SearchHit[] }[]
  counts: Record<string, number>
  total: number
}

const words = (query: string) => query.trim().toLowerCase().split(/\s+/).filter(Boolean)
const matchesAll = (haystack: string, needles: string[]) => {
  const text = haystack.toLowerCase()
  return needles.every((needle) => text.includes(needle))
}

/**
 * Search over every tab: a field matches when every word of the query
 * appears in its label, hint, key or card title; a panel-only card matches
 * through its title, description and keywords. Hidden fields are skipped.
 */
export function searchSettings(tabs: ResolvedTab[], query: string, options: { draft: Draft | null }): SearchResult {
  const needles = words(query)
  const result: SearchResult = { groups: [], counts: {}, total: 0 }
  if (!needles.length) return result
  for (const tab of tabs) {
    const hits: SearchHit[] = []
    for (const card of tab.cards) {
      const cardText = t(card.title)
      let fieldHits = 0
      for (const field of card.fields) {
        if (options.draft && !isVisible(field, options.draft)) continue
        const text = [t(field.label), field.hint ? t(field.hint) : '', field.key, cardText].join(' ')
        if (matchesAll(text, needles)) {
          hits.push({ tabId: tab.id, cardId: card.id, cardTitle: card.title, field })
          fieldHits++
        }
      }
      if (!fieldHits && card.panels.length) {
        const text = [cardText, card.description ? t(card.description) : '', card.keywords].join(' ')
        if (matchesAll(text, needles)) hits.push({ tabId: tab.id, cardId: card.id, cardTitle: card.title })
      }
    }
    if (hits.length) {
      result.groups.push({ tab, hits })
      result.counts[tab.id] = hits.length
      result.total += hits.length
    }
  }
  return result
}

// --------------------------------------------------------------------------- changes and reset

/** Number of changed (unsaved) fields per tab; tabs without changes are left out. */
export function tabChangeCounts(tabs: ResolvedTab[], changed: string[]): Record<string, number> {
  const set = new Set(changed)
  const counts: Record<string, number> = {}
  for (const tab of tabs) {
    const count = tab.cards.reduce((sum, card) => sum + card.fields.filter((field) => set.has(field.key)).length, 0)
    if (count) counts[tab.id] = count
  }
  return counts
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** "Reset" is offered only for fields with a default, never secrets, and only when the value differs. */
export function canResetField(field: FieldDef, value: DraftValue | undefined): boolean {
  if (field.default === undefined || field.type === 'secret' || value === undefined) return false
  return !same(toSaveValue(field, value), toSaveValue(field, resetToDefault(field)))
}

const MAX_VALUE_LENGTH = 60

/** Human-readable value for the reset confirm (never used for secrets). */
export function formatDraftValue(field: FieldDef, value: DraftValue): string {
  let text: string
  if (field.type === 'toggle') text = value === true ? t('set.value.on') : t('set.value.off')
  else if (field.type === 'secret') text = '••••••'
  else if (Array.isArray(value)) text = value.join(', ')
  else if (field.type === 'list') text = splitList(String(value)).join(', ')
  else if (field.type === 'map') text = String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('; ')
  else if (field.type === 'root' && !String(value ?? '').trim()) text = t('set.noRoot')
  else if (field.type === 'select') text = field.options?.find((option) => option.value === value)?.label ?? String(value)
  else text = String(value ?? '').trim()
  if (!text) return t('set.value.empty')
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…` : text
}

export interface ResetItem {
  key: string
  label: string
  from: string
  to: string
}

/** What "Reset tab to defaults" would change: every resettable field whose value differs from its default. */
export function tabResetPlan(tab: ResolvedTab, draft: Draft): ResetItem[] {
  const items: ResetItem[] = []
  for (const card of tab.cards) {
    for (const field of card.fields) {
      const value = draft[field.key]
      if (!canResetField(field, value)) continue
      items.push({ key: field.key, label: t(field.label), from: formatDraftValue(field, value), to: formatDraftValue(field, resetToDefault(field)) })
    }
  }
  return items
}

/** A new draft with the planned fields set to their defaults (the input is not mutated). */
export function applyReset(draft: Draft, plan: ResetItem[], fields: FieldDef[]): Draft {
  const next: Draft = { ...draft }
  for (const item of plan) {
    const field = fields.find((f) => f.key === item.key)
    if (field) next[field.key] = resetToDefault(field)
  }
  return next
}

// --------------------------------------------------------------------------- keyboard

/**
 * Roving focus in the tab list (WAI-ARIA tabs): arrows move to the
 * previous/next tab with wrap-around (both axes, so the vertical desktop list
 * and the horizontal phone strip behave the same), Home/End jump to the ends.
 * Returns null for keys the tab list does not handle.
 */
export function rovingIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (index + 1) % count
    case 'ArrowUp':
    case 'ArrowLeft':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
