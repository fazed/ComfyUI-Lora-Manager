/**
 * Filter state of the library pages (useLibraryFilters) after the shell
 * redesign: every new scope / filter reaches the reload signature and the list
 * query, excluded licence states count as filters, Clear all resets them,
 * search fields and "include subfolders" are remembered, presets are
 * validated on read.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { modelListParams } from '@/api/endpoints'
import { presetsKey, readPresets, useLibraryFilters } from '@/composables/useLibraryFilters'
import { LIBRARIES } from '@/config/libraries'

beforeEach(() => localStorage.clear())

function setup() {
  const filters = useLibraryFilters(LIBRARIES.loras)
  const params = () => modelListParams({ page: 1, pageSize: 60, ...filters.modelQuery(true) })
  return { filters, state: filters.state, params }
}

/** Runs `change` and returns whether the signature and the list parameters both changed. */
function changes(context: ReturnType<typeof setup>, change: () => void): boolean {
  const signature = context.filters.signature.value
  const params = JSON.stringify(context.params())
  change()
  return context.filters.signature.value !== signature && JSON.stringify(context.params()) !== params
}

describe('library filters: signature and list query', () => {
  it('a folder and "Include subfolders" (W1)', () => {
    const context = setup()
    expect(changes(context, () => (context.state.folder = 'styles'))).toBe(true)
    expect(context.params()).toMatchObject({ folder: 'styles', recursive: 'true' })
    expect(changes(context, () => (context.state.recursive = false))).toBe(true)
    expect(context.params().recursive).toBe('false')
  })

  it('the Creator search field while searching (W3)', () => {
    const context = setup()
    context.state.search = 'ink'
    expect(changes(context, () => (context.state.searchIn = { ...context.state.searchIn, creator: true }))).toBe(true)
    expect(context.params().search_creator).toBe('true')
  })

  it('Any / All with several tags', () => {
    const context = setup()
    context.state.tags = ['style', 'anime']
    expect(changes(context, () => (context.state.tagLogic = 'all'))).toBe(true)
    expect(context.params().tag_logic).toBe('all')
  })

  it('a model type', () => {
    const context = setup()
    expect(changes(context, () => context.filters.toggle('modelTypes', 'LoCon'))).toBe(true)
    expect(context.params().model_type).toEqual(['LoCon'])
  })

  it('each licence state, included and excluded (W2)', () => {
    const context = setup()
    expect(changes(context, () => (context.state.creditRequired = true))).toBe(true)
    expect(context.params().credit_required).toBe('true')
    expect(changes(context, () => (context.state.creditRequired = false))).toBe(true)
    expect(context.params().credit_required).toBe('false')
    expect(changes(context, () => (context.state.allowSelling = false))).toBe(true)
    expect(context.params().allow_selling_generated_content).toBe('false')
    expect(changes(context, () => (context.state.allowSelling = null))).toBe(true)
    expect(context.params().allow_selling_generated_content).toBeUndefined()
  })

  it('a letter (LoRAs: first_letter)', () => {
    const context = setup()
    expect(changes(context, () => (context.state.letter = 'B'))).toBe(true)
    expect(context.params().first_letter).toBe('B')
    // Libraries whose endpoint ignores first_letter never send it.
    expect(modelListParams({ page: 1, pageSize: 60, ...context.filters.modelQuery(false) }).first_letter).toBeUndefined()
  })
})

describe('library filters: chips, count and clearing', () => {
  it('shows an excluded licence as a removable chip and counts it in the flyout badge', () => {
    const { filters, state } = setup()
    state.creditRequired = false
    state.allowSelling = false
    expect(filters.chips.value.map((chip) => chip.label)).toEqual(['No credit required', 'Selling not allowed'])
    expect(filters.panelCount.value).toBe(2)
    filters.chips.value[0].remove()
    expect(state.creditRequired).toBeNull()
    expect(filters.panelCount.value).toBe(1)
  })

  it('has one chip per new scope or filter and Clear all resets them', () => {
    const { filters, state } = setup()
    Object.assign(state, {
      search: 'ink',
      folder: 'styles',
      recursive: false,
      letter: 'A',
      tags: ['a', 'b'],
      tagLogic: 'all',
      modelTypes: ['DoRA'],
      creditRequired: true,
      allowSelling: true,
    })
    expect(filters.chips.value.map((chip) => chip.key)).toEqual([
      'search',
      'folder',
      'recursive',
      'letter',
      'tag:a',
      'tag:b',
      'taglogic',
      'type:DoRA',
      'creditRequired',
      'allowSelling',
    ])
    filters.clear()
    expect(filters.chips.value).toEqual([])
    expect(state).toMatchObject({ search: '', folder: '', recursive: true, letter: '', tagLogic: 'any', modelTypes: [], creditRequired: null, allowSelling: null })
  })

  it("the flyout's Clear all keeps the scope (search, folder, letter)", () => {
    const { filters, state } = setup()
    Object.assign(state, { search: 'ink', folder: 'styles', letter: 'A', modelTypes: ['DoRA'], favoritesOnly: true })
    filters.clearPanel()
    expect(state).toMatchObject({ search: 'ink', folder: 'styles', letter: 'A', modelTypes: [], favoritesOnly: false })
  })
})

describe('library filters: persistence', () => {
  it('remembers the search fields and "Include subfolders" per library, validated on read', async () => {
    const { state } = setup()
    state.searchIn = { ...state.searchIn, tags: true }
    state.recursive = false
    await Promise.resolve()
    const stored = JSON.parse(localStorage.getItem('lm-ui.library.loras') ?? '{}')
    expect(stored).toMatchObject({ searchIn: { tags: true, filename: true }, recursive: false })
    expect(useLibraryFilters(LIBRARIES.loras).state).toMatchObject({ recursive: false, searchIn: { tags: true } })
    expect(useLibraryFilters(LIBRARIES.checkpoints).state.recursive).toBe(true)

    localStorage.setItem('lm-ui.library.loras', JSON.stringify({ searchIn: { tags: 'yes', creator: true }, recursive: 'no' }))
    const reread = useLibraryFilters(LIBRARIES.loras).state
    expect(reread.searchIn).toEqual({ filename: true, modelname: true, tags: false, creator: true, triggerWords: false })
    expect(reread.recursive).toBe(true)
  })

  it('saves, applies and deletes presets; malformed stored presets are dropped', () => {
    const { filters, state } = setup()
    Object.assign(state, { baseModels: ['SDXL'], tags: ['a', 'b'], tagLogic: 'all', creditRequired: false })
    filters.savePreset('  Strict SDXL ')
    expect(readPresets('loras').map((preset) => preset.name)).toEqual(['Strict SDXL'])
    filters.clear()
    filters.applyPreset(filters.presets.value[0])
    expect(state).toMatchObject({ baseModels: ['SDXL'], tags: ['a', 'b'], tagLogic: 'all', creditRequired: false })
    const removed = filters.deletePreset('Strict SDXL')
    expect(readPresets('loras')).toEqual([])
    // Undo of the delete toast puts it back.
    filters.restorePreset(removed!)
    expect(readPresets('loras').map((preset) => preset.name)).toEqual(['Strict SDXL'])
    expect(filters.deletePreset('missing')).toBeUndefined()
    filters.deletePreset('Strict SDXL')

    localStorage.setItem(
      presetsKey('loras'),
      JSON.stringify([
        { name: 'ok', filters: { baseModels: [], tags: [], tagLogic: 'any', modelTypes: [], creditRequired: null, allowSelling: true, favoritesOnly: false, updatesOnly: false } },
        { name: 'bad logic', filters: { baseModels: [], tags: [], tagLogic: 'some', modelTypes: [], creditRequired: null, allowSelling: null, favoritesOnly: false, updatesOnly: false } },
        { name: '', filters: {} },
        'junk',
      ]),
    )
    expect(readPresets('loras').map((preset) => preset.name)).toEqual(['ok'])
    localStorage.setItem(presetsKey('loras'), '{not json')
    expect(readPresets('loras')).toEqual([])
  })
})
