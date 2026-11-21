/**
 * Settings page presentation model (tabs, URL sync, search across tabs,
 * per-tab change counts, reset rules). Written before the UI.
 */
import { describe, expect, it } from 'vitest'
import { ALL_FIELDS, SETTINGS_SECTIONS } from '@/config/settingsSchema'
import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS } from '@/config/settingsTabs'
import { draftFromSettings, sanitizeSettings, type Draft, type FieldDef } from '@/utils/settingsModel'
import {
  applyReset,
  buildTabs,
  canResetField,
  fieldDomId,
  formatDraftValue,
  resolveSettingsLocation,
  rovingIndex,
  searchSettings,
  settingsTabPath,
  tabChangeCounts,
  tabOfField,
  tabResetPlan,
} from '@/utils/settingsTabs'
import { t } from '@/i18n'

const tabs = buildTabs(SETTINGS_TABS, ALL_FIELDS)
const byKey = (key: string) => ALL_FIELDS.find((f) => f.key === key)!
const tab = (id: string) => tabs.find((x) => x.id === id)!

function freshDraft(settings: Record<string, unknown> = {}): Draft {
  return draftFromSettings(sanitizeSettings(settings), ALL_FIELDS)
}

describe('tab model', () => {
  it('has 6-9 tabs with unique ids, titles, descriptions and icons', () => {
    expect(tabs.length).toBeGreaterThanOrEqual(6)
    expect(tabs.length).toBeLessThanOrEqual(9)
    expect(new Set(tabs.map((x) => x.id)).size).toBe(tabs.length)
    for (const x of tabs) {
      expect(t(x.title)).not.toBe(x.title)
      expect(t(x.description)).not.toBe(x.description)
      expect(x.icon).toBeTruthy()
      expect(x.cards.length).toBeGreaterThan(0)
    }
    expect(tabs[0].id).toBe(DEFAULT_SETTINGS_TAB)
  })

  it('places every schema field in exactly one card, in a known tab', () => {
    const placed = tabs.flatMap((x) => x.cards.flatMap((c) => c.fields.map((f) => f.key)))
    expect(new Set(placed).size).toBe(placed.length)
    expect([...placed].sort()).toEqual(ALL_FIELDS.map((f) => f.key).sort())
  })

  it('places every non-form panel exactly once', () => {
    const panels = tabs.flatMap((x) => x.cards.flatMap((c) => c.panels))
    expect(new Set(panels).size).toBe(panels.length)
    const schemaPanels = SETTINGS_SECTIONS.flatMap((s) => s.panels ?? [])
    for (const p of [...schemaPanels, 'settingsFile', 'diagnostics']) expect(panels).toContain(p)
  })

  it('card ids are unique across tabs and every card has a title', () => {
    const ids = tabs.flatMap((x) => x.cards.map((c) => c.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of tabs.flatMap((x) => x.cards)) {
      expect(t(c.title)).not.toBe(c.title)
      expect(c.fields.length + c.panels.length).toBeGreaterThan(0)
    }
  })

  it('rejects unknown keys and fields that are not placed', () => {
    expect(() => buildTabs([{ id: 'x', title: 'setTab.general', description: 'setTab.general.desc', icon: 'settings', cards: [{ id: 'c', title: 'setCard.language', fields: ['nope'] }] }], ALL_FIELDS)).toThrow(/nope/)
    expect(() => buildTabs([{ id: 'x', title: 'setTab.general', description: 'setTab.general.desc', icon: 'settings', cards: [{ id: 'c', title: 'setCard.language', fields: ['language'] }] }], ALL_FIELDS)).toThrow(/not placed/)
  })

  it('groups the danger settings in danger cards and keeps classic-only display settings together', () => {
    const danger = tabs.flatMap((x) => x.cards).filter((c) => c.tone === 'danger').flatMap((c) => c.fields.map((f) => f.key))
    for (const f of ALL_FIELDS.filter((f) => f.effect === 'moves-files' || f.effect === 'relocates-settings')) expect(danger).toContain(f.key)
    const classic = tab('interface').cards.find((c) => c.id === 'classic-display')!.fields
    expect(classic.length).toBeGreaterThan(10)
    expect(classic.every((f) => f.effect === 'classic-only')).toBe(true)
  })

  it('finds the tab of a field', () => {
    expect(tabOfField(tabs, 'proxy_host')).toBe('integrations')
    expect(tabOfField(tabs, 'civitai_api_key')).toBe('metadata')
    expect(tabOfField(tabs, 'nope')).toBeNull()
  })
})

describe('URL <-> tab', () => {
  it('builds the tab path', () => {
    expect(settingsTabPath('downloads')).toBe('/settings/downloads')
  })

  it('uses a valid route param, then the remembered tab, then the default', () => {
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { param: 'downloads' })).toEqual({ tab: 'downloads', fieldKey: null, cardId: null })
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { param: '', stored: 'library' }).tab).toBe('library')
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { param: 'bogus', stored: 'also-bogus' }).tab).toBe(DEFAULT_SETTINGS_TAB)
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, {}).tab).toBe(DEFAULT_SETTINGS_TAB)
    // A route param wins over the remembered tab.
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { param: 'about', stored: 'library' }).tab).toBe('about')
  })

  it('resolves legacy deep links: #field-<key> and #set-<section>', () => {
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { hash: '#field-lora_syntax_format' })).toEqual({ tab: 'interface', fieldKey: 'lora_syntax_format', cardId: 'prompts' })
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { hash: `#${fieldDomId('download_path_templates.lora')}` })).toMatchObject({ tab: 'downloads', fieldKey: 'download_path_templates.lora' })
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { hash: '#set-example-images' })).toMatchObject({ tab: 'example-images', fieldKey: null })
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { hash: '#set-about' })).toMatchObject({ tab: 'about', cardId: 'about' })
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { hash: '#set-proxy' })).toMatchObject({ tab: 'integrations', cardId: 'proxy' })
    // The hash target wins over a param that disagrees; unknown hashes are ignored.
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { param: 'about', hash: '#field-proxy_host' }).tab).toBe('integrations')
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { param: 'about', hash: '#field-gone' })).toEqual({ tab: 'about', fieldKey: null, cardId: null })
    expect(resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { hash: '#card-proxy' })).toMatchObject({ tab: 'integrations', cardId: 'proxy' })
  })

  it('every legacy section id resolves to a tab', () => {
    for (const section of SETTINGS_SECTIONS) {
      const target = resolveSettingsLocation(tabs, SETTINGS_SECTIONS, { hash: `#set-${section.id}` })
      expect(target.cardId, section.id).not.toBeNull()
    }
  })

  it('field dom ids are stable and safe', () => {
    expect(fieldDomId('send_to_workflow_exclusions.node_classes')).toBe('field-send_to_workflow_exclusions_node_classes')
  })
})

describe('search across tabs', () => {
  const draft = freshDraft({ proxy_enabled: true })

  it('an empty query is no search', () => {
    expect(searchSettings(tabs, '  ', { draft })).toEqual({ groups: [], counts: {}, total: 0 })
  })

  it('finds fields in several tabs, grouped in tab order, with counts', () => {
    const result = searchSettings(tabs, 'proxy', { draft })
    expect(result.counts.integrations).toBe(6)
    expect(result.groups[0].tab.id).toBe('integrations')
    const folder = searchSettings(tabs, 'folder', { draft })
    expect(Object.keys(folder.counts).length).toBeGreaterThan(2)
    const order = folder.groups.map((g) => tabs.findIndex((x) => x.id === g.tab.id))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(folder.total).toBe(Object.values(folder.counts).reduce((a, b) => a + b, 0))
    for (const group of folder.groups) expect(group.hits.length).toBe(folder.counts[group.tab.id])
  })

  it('matches label, hint and key, case-insensitively, all words', () => {
    expect(searchSettings(tabs, 'PARALLEL downloads', { draft }).groups[0].hits[0].field?.key).toBe('download_queue_max_concurrent')
    expect(searchSettings(tabs, 'aria2c_path', { draft: freshDraft({ download_backend: 'aria2' }) }).total).toBe(1)
    expect(searchSettings(tabs, 'zzzz-nothing', { draft }).total).toBe(0)
  })

  it('skips fields hidden for the current draft', () => {
    expect(searchSettings(tabs, 'proxy host', { draft: freshDraft({ proxy_enabled: false }) }).total).toBe(0)
    expect(searchSettings(tabs, 'proxy host', { draft }).total).toBe(1)
  })

  it('finds panels through their card title and keywords', () => {
    const result = searchSettings(tabs, 'restore', { draft })
    const hit = result.groups.find((g) => g.tab.id === 'maintenance')!.hits.find((h) => !h.field)
    expect(hit?.cardId).toBe('backups')
    expect(searchSettings(tabs, 'theme', { draft }).counts.interface).toBeGreaterThan(0)
    expect(searchSettings(tabs, 'changelog', { draft }).counts.about).toBe(1)
  })
})

describe('per-tab change counts', () => {
  it('counts changed keys per tab and leaves clean tabs out', () => {
    const counts = tabChangeCounts(tabs, ['proxy_host', 'llm_model', 'sticky_controls', 'gone'])
    expect(counts).toEqual({ integrations: 2, interface: 1 })
    expect(tabChangeCounts(tabs, [])).toEqual({})
  })
})

describe('reset to default', () => {
  it('is offered only when the value differs from the default (normalised)', () => {
    expect(canResetField(byKey('download_queue_max_concurrent'), '2')).toBe(false)
    expect(canResetField(byKey('download_queue_max_concurrent'), ' 2 ')).toBe(false)
    expect(canResetField(byKey('download_queue_max_concurrent'), '3')).toBe(true)
    expect(canResetField(byKey('download_queue_max_concurrent'), 'abc')).toBe(true)
    expect(canResetField(byKey('blur_mature_content'), true)).toBe(false)
    expect(canResetField(byKey('blur_mature_content'), false)).toBe(true)
    expect(canResetField(byKey('download_skip_base_models'), '\n')).toBe(false)
    expect(canResetField(byKey('enabled_other_sub_types'), ['upscaler', 'vae', 'text_encoder'])).toBe(true)
  })

  it('is never offered for secrets or fields without a default', () => {
    expect(canResetField(byKey('civitai_api_key'), { mode: 'set', value: 'x' })).toBe(false)
    expect(canResetField(byKey('priority_tags.lora'), 'anything')).toBe(false)
  })

  it('formats values for the confirm list', () => {
    expect(formatDraftValue(byKey('blur_mature_content'), true)).toBe(t('set.value.on'))
    expect(formatDraftValue(byKey('blur_mature_content'), false)).toBe(t('set.value.off'))
    expect(formatDraftValue(byKey('download_backend'), 'aria2')).toBe('aria2')
    expect(formatDraftValue(byKey('lora_syntax_format'), 'full')).toBe('Full (folder and file name)')
    expect(formatDraftValue(byKey('aria2c_path'), '')).toBe(t('set.value.empty'))
    expect(formatDraftValue(byKey('download_skip_base_models'), 'SD 1.5\nSDXL')).toBe('SD 1.5, SDXL')
    expect(formatDraftValue(byKey('default_lora_root'), 'x'.repeat(200)).length).toBeLessThanOrEqual(60)
  })

  it('plans a tab reset listing only the fields that change, and applies it', () => {
    const draft = freshDraft({ download_queue_max_concurrent: 4, download_backend: 'python', skip_previously_downloaded_model_versions: true })
    draft['download_path_templates.lora'] = '{author}'
    const plan = tabResetPlan(tab('downloads'), draft)
    expect(plan.map((p) => p.key).sort()).toEqual(['download_path_templates.lora', 'download_queue_max_concurrent', 'skip_previously_downloaded_model_versions'])
    const item = plan.find((p) => p.key === 'download_queue_max_concurrent')!
    expect(item).toMatchObject({ label: t(byKey('download_queue_max_concurrent').label), from: '4', to: '2' })
    const next = applyReset(draft, plan, ALL_FIELDS)
    expect(next.download_queue_max_concurrent).toBe('2')
    expect(next['download_path_templates.lora']).toBe('{base_model}/{first_tag}')
    expect(next.skip_previously_downloaded_model_versions).toBe(false)
    expect(tabResetPlan(tab('downloads'), next)).toEqual([])
    // The original draft is not mutated; other tabs are untouched.
    expect(draft.download_queue_max_concurrent).toBe('4')
    expect(next.language).toBe(draft.language)
  })

  it('never puts secrets in a reset plan', () => {
    const draft = freshDraft({ civitai_api_key_set: true })
    draft.civitai_api_key = { mode: 'set', value: 'secret-value' }
    const plan = tabResetPlan(tab('metadata'), draft)
    expect(plan.map((p) => p.key)).not.toContain('civitai_api_key')
    expect(JSON.stringify(plan)).not.toContain('secret-value')
  })

  it('every field of the schema either has a default or is a secret / free text without one', () => {
    const noDefault = ALL_FIELDS.filter((f: FieldDef) => f.default === undefined).map((f) => f.key)
    for (const key of noDefault) expect(['secret', 'textarea']).toContain(byKey(key).type)
  })
})

describe('tab list keyboard', () => {
  it('moves with arrows (wrapping), Home and End; ignores other keys', () => {
    expect(rovingIndex('ArrowDown', 0, 9)).toBe(1)
    expect(rovingIndex('ArrowRight', 8, 9)).toBe(0)
    expect(rovingIndex('ArrowUp', 0, 9)).toBe(8)
    expect(rovingIndex('ArrowLeft', 4, 9)).toBe(3)
    expect(rovingIndex('Home', 4, 9)).toBe(0)
    expect(rovingIndex('End', 4, 9)).toBe(8)
    expect(rovingIndex('Enter', 4, 9)).toBeNull()
    expect(rovingIndex('ArrowDown', 0, 0)).toBeNull()
  })
})
