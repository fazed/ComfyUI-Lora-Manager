import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { setFetch } from '@/api/http'
import { LIBRARIES } from '@/config/libraries'
import { useAppSettings } from '@/composables/useAppSettings'
import { useToasts } from '@/composables/useFeedback'
import { useLibraryFilters } from '@/composables/useLibraryFilters'
import { readToggle, usePersistentToggle } from '@/composables/usePersistentToggle'
import { useNodePicker, useSendToWorkflow } from '@/composables/useSendToWorkflow'
import { buildBaseModelChips, sortBaseModels } from '@/utils/baseModelChips'
import { promptHint, toGenerationView } from '@/utils/generation'
import { collapseTags } from '@/utils/tags'
import {
  buildLoraCopyText,
  buildLoraSyntax,
  buildUpdateLoraCodeBody,
  loraStrengths,
  loraTargetNodes,
  nodeLabel,
  resolveNodeReference,
  type RegistryNode,
} from '@/utils/workflow'

const COUNTS = [
  { name: 'SD 1.5', count: 3 },
  { name: 'Illustrious', count: 513 },
  { name: 'Anima', count: 420 },
  { name: 'Pony', count: 3 },
  { name: 'Krea 2', count: 29 },
  { name: '', count: 9 },
]

describe('base-model quick filter chips', () => {
  it('orders by count desc, then name, and drops blank names', () => {
    expect(sortBaseModels(COUNTS).map((entry) => entry.name)).toEqual(['Illustrious', 'Anima', 'Krea 2', 'Pony', 'SD 1.5'])
  })

  it('merges duplicate names', () => {
    expect(sortBaseModels([{ name: 'Flux.1 D', count: 2 }, { name: 'Flux.1 D ', count: 3 }])).toEqual([{ name: 'Flux.1 D', count: 5 }])
  })

  it('splits top N from the overflow', () => {
    const row = buildBaseModelChips(COUNTS, [], 3)
    expect(row.visible.map((chip) => chip.name)).toEqual(['Illustrious', 'Anima', 'Krea 2'])
    expect(row.overflow.map((chip) => chip.name)).toEqual(['Pony', 'SD 1.5'])
    expect(row.visible.every((chip) => !chip.selected)).toBe(true)
  })

  it('keeps selected overflow and unknown base models visible', () => {
    const row = buildBaseModelChips(COUNTS, ['SD 1.5', 'Anima', 'Flux.1 D'], 3)
    expect(row.visible.map((chip) => [chip.name, chip.selected])).toEqual([
      ['Illustrious', false],
      ['Anima', true],
      ['Krea 2', false],
      ['SD 1.5', true],
      ['Flux.1 D', true],
    ])
    expect(row.visible.at(-1)?.count).toBeUndefined()
    expect(row.overflow.map((chip) => chip.name)).toEqual(['Pony'])
  })

  it('shares one selection with the filter panel and active-filter chips', async () => {
    const filters = useLibraryFilters(LIBRARIES.checkpoints)
    filters.toggle('baseModels', 'Anima') // quick chip click
    filters.toggle('baseModels', 'Pony') // second chip (multi-select)
    await nextTick()
    expect(filters.chips.value.map((chip) => chip.label)).toEqual(['Anima', 'Pony'])
    expect(buildBaseModelChips(COUNTS, filters.state.baseModels, 2).visible.filter((chip) => chip.selected)).toHaveLength(2)

    const signature = filters.signature.value
    filters.clearList('baseModels') // "All" chip
    expect(filters.state.baseModels).toEqual([])
    expect(filters.signature.value).not.toBe(signature)

    filters.include('tags', 'style')
    filters.include('tags', 'style')
    expect(filters.state.tags).toEqual(['style'])
  })

  it('is configured per library', () => {
    expect(LIBRARIES.loras.quickBaseModels).toBeGreaterThan(0)
    expect(LIBRARIES.checkpoints.quickBaseModels).toBeGreaterThan(0)
    expect(LIBRARIES.loras.sendToComfy).toBe(true)
    expect(LIBRARIES.checkpoints.sendToComfy).toBe(false)
  })
})

describe('generation data view model', () => {
  it('normalises ComfyUI-style Civitai meta', () => {
    const view = toGenerationView({
      seed: 245377371774416,
      Model: 'anima-base-v1.0',
      steps: 31,
      width: 1024,
      height: 1536,
      prompt: '\r\nbest quality, masterpiece\n\n\n\n1girl\n',
      denoise: 1,
      sampler: 'dpmpp_2m_sde_gpu',
      cfgScale: 4,
      scheduler: 'simple',
      negativePrompt: 'worst quality',
      additionalResources: [{ name: 'urn:air:sdxl:lora:civitai:282420@317904', type: 'lora', strength: 0.8, strengthClip: 1 }],
    })
    expect(view?.prompt).toBe('best quality, masterpiece\n\n1girl')
    expect(view?.negativePrompt).toBe('worst quality')
    expect(Object.fromEntries(view!.params.map((param) => [param.key, param.value]))).toEqual({
      model: 'anima-base-v1.0',
      sampler: 'dpmpp_2m_sde_gpu',
      scheduler: 'simple',
      steps: '31',
      cfg: '4',
      seed: '245377371774416',
      size: '1024×1536',
      denoise: '1',
    })
    expect(view?.resources).toEqual([{ name: 'civitai 282420@317904', type: 'lora', weight: '0.8' }])
  })

  it('normalises A1111-style meta and de-duplicates resources', () => {
    const view = toGenerationView({
      prompt: 'a cat',
      'Negative prompt': 'blurry',
      'CFG scale': 0.30000000000000004,
      'Schedule type': 'Karras',
      Size: '896x1216',
      'Clip skip': 2,
      resources: [
        { hash: '85ab', name: 'IL20', type: 'lora', weight: 0.6 },
        { name: 'IL20', type: 'lora', weight: 0.6 },
        { name: 'waiIllustrious', type: 'model' },
      ],
      civitaiResources: [{ type: 'checkpoint', modelVersionId: 1, modelVersionName: 'v14.0' }],
    })
    expect(view?.negativePrompt).toBe('blurry')
    const params = Object.fromEntries(view!.params.map((param) => [param.key, param.value]))
    expect(params).toMatchObject({ cfg: '0.3', scheduler: 'Karras', size: '896×1216', clipSkip: '2' })
    expect(view?.resources).toEqual([
      { name: 'IL20', type: 'lora', weight: '0.6' },
      { name: 'waiIllustrious', type: 'model' },
    ])
  })

  it('falls back to civitaiResources and handles missing data', () => {
    expect(
      toGenerationView({ civitaiResources: [{ type: 'checkpoint', modelVersionId: 7, modelVersionName: 'v1' }] })?.resources,
    ).toEqual([{ name: 'v1 (#7)', type: 'checkpoint' }])
    expect(toGenerationView(null)).toBeNull()
    expect(toGenerationView({})).toBeNull()
    expect(toGenerationView([])).toBeNull()
    expect(toGenerationView({ prompt: '   ', hashes: { model: 'x' } })).toBeNull()
  })

  it('builds a one-line prompt hint', () => {
    expect(promptHint({ prompt: 'a\n\n  cat' })).toBe('a cat')
    expect(promptHint({ prompt: 'x'.repeat(50) }, 10)).toBe(`${'x'.repeat(9)}…`)
    expect(promptHint(undefined)).toBe('')
  })
})

describe('tag collapse', () => {
  const tags = Array.from({ length: 15 }, (_, index) => `tag${index}`)

  it('collapses after the limit', () => {
    expect(collapseTags(tags, false, 12)).toEqual({ visible: tags.slice(0, 12), hiddenCount: 3, collapsible: true })
    expect(collapseTags(tags, true, 12)).toEqual({ visible: tags, hiddenCount: 0, collapsible: true })
  })

  it('does not hide a single tag behind "+1 more"', () => {
    expect(collapseTags(tags.slice(0, 13), false, 12)).toEqual({ visible: tags.slice(0, 13), hiddenCount: 0, collapsible: false })
    expect(collapseTags([], false).visible).toEqual([])
  })
})

describe('usePersistentToggle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('defaults, persists and reads back', async () => {
    expect(readToggle('lm-ui.test.toggle', false)).toBe(false)
    const open = usePersistentToggle('lm-ui.test.toggle', false)
    open.value = true
    await nextTick()
    expect(window.localStorage.getItem('lm-ui.test.toggle')).toBe('true')
    expect(usePersistentToggle('lm-ui.test.toggle', false).value).toBe(true)
  })

  it('survives blocked storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const open = usePersistentToggle('lm-ui.test.blocked', false)
    expect(open.value).toBe(false)
    open.value = true
    await nextTick()
    expect(open.value).toBe(true)
  })
})

const LORA = { file_name: 'Anima-2.5D Style-V1', folder: 'Anima/style', usage_tips: '{}' }

describe('LoRA syntax', () => {
  it('uses the bare file name in legacy format and the folder path otherwise', () => {
    expect(buildLoraSyntax(LORA)).toBe('<lora:Anima-2.5D Style-V1:1>')
    expect(buildLoraSyntax(LORA, { format: 'full' })).toBe('<lora:Anima/style/Anima-2.5D Style-V1:1>')
    expect(buildLoraSyntax({ ...LORA, folder: '' }, { format: 'full' })).toBe('<lora:Anima-2.5D Style-V1:1>')
  })

  it('applies usage tips and strength overrides', () => {
    expect(loraStrengths('{"strength": "0.7"}')).toEqual({ strength: 0.7, hasStrength: true, clipStrength: null })
    expect(loraStrengths('not json').strength).toBe(1)
    expect(buildLoraSyntax({ ...LORA, usage_tips: '{"strength": 0.8}' })).toBe('<lora:Anima-2.5D Style-V1:0.8>')
    expect(buildLoraSyntax({ ...LORA, usage_tips: '{"clip_strength": 0.5}' })).toBe('<lora:Anima-2.5D Style-V1:1:0.5>')
    expect(buildLoraSyntax({ ...LORA, usage_tips: '{"strength": 0.8}' }, { strength: 0.65 })).toBe('<lora:Anima-2.5D Style-V1:0.65>')
    expect(buildLoraSyntax(LORA, { strength: Number.NaN })).toBe('<lora:Anima-2.5D Style-V1:1>')
  })

  it('adds trigger words for copying like the classic UI', () => {
    expect(buildLoraCopyText('<lora:x:1>', ['a, b'], true)).toBe('<lora:x:1>, a, b')
    expect(buildLoraCopyText('<lora:x:1>', ['a', ' c ,d'], true)).toBe(`<lora:x:1>, a\n${'-'.repeat(17)}\nc, d`)
    expect(buildLoraCopyText('<lora:x:1>', ['a'], false)).toBe('<lora:x:1>')
    expect(buildLoraCopyText('<lora:x:1>', [], true)).toBe('<lora:x:1>')
  })
})

const NODES: Record<string, RegistryNode> = {
  'g1:5': { id: 5, graph_id: 'g1', graph_name: 'Sub', title: 'Lora Loader', type: 1, mode: 0, capabilities: { supports_lora: true } },
  '7': { id: 7, title: 'Lora Stacker', type: 2 },
  '8': { id: 8, title: 'Bypassed', type: 1, mode: 4 },
  '9': { id: 9, title: 'Checkpoint', type: 0, capabilities: { supports_lora: false } },
  '10': { id: 10, title: 'Excluded', type: 1, exclude_send: true },
  '11': { id: 11, title: 'My preview loader', type: 1, comfy_class: 'PreviewLora' },
}

describe('send to workflow request building', () => {
  it('keeps enabled, LoRA-capable, non-excluded nodes', () => {
    expect(Object.keys(loraTargetNodes(NODES)).sort()).toEqual(['11', '7', 'g1:5'])
    expect(Object.keys(loraTargetNodes(NODES, { node_classes: ['PreviewLora'] })).sort()).toEqual(['7', 'g1:5'])
    expect(Object.keys(loraTargetNodes(NODES, { title_patterns: ['PREVIEW'] })).sort()).toEqual(['7', 'g1:5'])
    expect(loraTargetNodes(null)).toEqual({})
  })

  it('resolves node references and builds the update-lora-code body', () => {
    expect(resolveNodeReference('g1:5', NODES)).toEqual({ node_id: 5, graph_id: 'g1' })
    expect(resolveNodeReference('g2:12', {})).toEqual({ node_id: 12, graph_id: 'g2' })
    expect(resolveNodeReference('abc', {})).toEqual({ node_id: 'abc', graph_id: null })
    expect(buildUpdateLoraCodeBody('<lora:x:1>', 'replace', ['g1:5', '7'], NODES)).toEqual({
      lora_code: '<lora:x:1>',
      mode: 'replace',
      node_ids: [
        { node_id: 5, graph_id: 'g1' },
        { node_id: 7, graph_id: null },
      ],
    })
    expect(nodeLabel(NODES['g1:5'])).toBe('#5 (Sub) Lora Loader')
  })
})

describe('useSendToWorkflow', () => {
  type Call = { url: string; init?: RequestInit }
  let calls: Call[] = []

  function mockBackend(registry: unknown, registryStatus = 200): void {
    calls = []
    setFetch(async (url, init) => {
      calls.push({ url, init })
      if (url.includes('/settings')) return new Response(JSON.stringify({ success: true, settings: { lora_syntax_format: 'legacy' } }))
      if (url.includes('/get-registry')) return new Response(JSON.stringify(registry), { status: registryStatus })
      if (url.includes('/update-lora-code')) return new Response(JSON.stringify({ success: true, results: [] }))
      return new Response('{}', { status: 404 })
    })
  }

  afterEach(() => {
    setFetch(null)
    useToasts().toasts.value = []
    useAppSettings().settings.value = null
  })

  it('sends straight to the only LoRA node', async () => {
    mockBackend({ success: true, data: { nodes: { '7': NODES['7'], '9': NODES['9'] }, tab_count: 1 } })
    const ok = await useSendToWorkflow().sendLora({ ...LORA, usage_tips: '{"strength": 0.8}' }, { mode: 'append' })
    expect(ok).toBe(true)
    const post = calls.find((call) => call.url.includes('/update-lora-code'))!
    expect(post.init?.method).toBe('POST')
    expect(JSON.parse(String(post.init?.body))).toEqual({
      lora_code: '<lora:Anima-2.5D Style-V1:0.8>',
      mode: 'append',
      node_ids: [{ node_id: 7, graph_id: null }],
    })
    expect(useToasts().toasts.value.at(-1)?.kind).toBe('success')
  })

  it('asks which node when there are several', async () => {
    mockBackend({ success: true, data: { nodes: NODES, tab_count: 1 } })
    const pending = useSendToWorkflow().sendLora(LORA, { mode: 'replace', strength: 0.5 })
    const { pickerState } = useNodePicker()
    await vi.waitFor(() => expect(pickerState.value).not.toBeNull())
    expect(pickerState.value?.mode).toBe('replace')
    pickerState.value?.resolve(['g1:5'])
    expect(await pending).toBe(true)
    const body = JSON.parse(String(calls.find((call) => call.url.includes('/update-lora-code'))?.init?.body))
    expect(body).toEqual({ lora_code: '<lora:Anima-2.5D Style-V1:0.5>', mode: 'replace', node_ids: [{ node_id: 5, graph_id: 'g1' }] })
  })

  it('warns with a copy-syntax action when no workflow can receive it', async () => {
    mockBackend({ success: false, error: 'Empty Registry' })
    expect(await useSendToWorkflow().sendLora(LORA)).toBe(false)
    const toast = useToasts().toasts.value.at(-1)
    expect(toast?.kind).toBe('warning')
    expect(toast?.action?.label).toBeTruthy()
    expect(calls.some((call) => call.url.includes('/update-lora-code'))).toBe(false)

    mockBackend({ success: false, error: 'Standalone Mode Active' }, 503)
    expect(await useSendToWorkflow().sendLora(LORA)).toBe(false)
    expect(useToasts().toasts.value.at(-1)?.message).toMatch(/Standalone/)

    mockBackend({ success: true, data: { nodes: { '9': NODES['9'] } } })
    expect(await useSendToWorkflow().sendLora(LORA)).toBe(false)
    expect(useToasts().toasts.value.at(-1)?.kind).toBe('warning')
  })
})
