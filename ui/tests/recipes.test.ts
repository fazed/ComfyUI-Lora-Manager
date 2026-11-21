/**
 * Recipes (phase B2a): request builders, response normalisation, the import
 * flow state machine, reconnect and the delete / edit / move flows against a
 * mocked backend. Written before the implementation; nothing here touches a
 * real backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { setFetch } from '@/api/http'
import { buildSaveForm, pickRecipeUpdate, recipeListParams, recipesApi } from '@/api/recipes'
import type { RecipeAnalysis, RecipeItem } from '@/api/types'
import { useConfirm, useToasts } from '@/composables/useFeedback'
import { UNDO_TOAST_MS } from '@/composables/useModelActions'
import { useRecipeActions } from '@/composables/useRecipeActions'
import { useRecipeImport } from '@/composables/useRecipeImport'
import { parseBatchInput } from '@/utils/batchDownload'
import {
  availability,
  buildSaveMetadata,
  defaultRecipeName,
  loraState,
  missingLoraTargets,
  missingLorasInput,
  normalizeAnalysis,
  parseBatchImportInput,
  parseReconnectInput,
  parseTagInput,
  recipeLoraViews,
} from '@/utils/recipes'
import { setBasePathsForTesting } from '@/utils/basePath'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface Call {
  url: string
  method: string | undefined
  body: unknown
  form: FormData | null
}

function calls(fetchMock: ReturnType<typeof vi.fn>): Call[] {
  return (fetchMock.mock.calls as [string, RequestInit][]).map(([url, init]) => ({
    url,
    method: init?.method,
    form: init?.body instanceof FormData ? init.body : null,
    body: init?.body && !(init.body instanceof FormData) ? JSON.parse(String(init.body)) : undefined,
  }))
}

const last = (fetchMock: ReturnType<typeof vi.fn>) => calls(fetchMock).at(-1)!

function autoConfirm(answer: boolean) {
  const { confirmState } = useConfirm()
  const seen: { title: string; message: string; danger: boolean }[] = []
  const stop = watch(confirmState, (state) => {
    if (!state) return
    seen.push({ title: state.title, message: state.message, danger: state.danger })
    state.resolve(answer)
  })
  return { seen, stop }
}

function recipe(id: string, extra: Partial<RecipeItem> = {}): RecipeItem {
  return {
    id,
    title: `Recipe ${id}`,
    file_path: `D:/loras/recipes/${id}.webp`,
    file_url: `/api/lm/previews?path=${id}`,
    folder: '',
    base_model: 'SDXL 1.0',
    tags: ['portrait'],
    favorite: false,
    loras: [
      { file_name: 'film_grain', hash: 'aa', strength: 0.8, modelVersionId: 111, modelName: 'Film Grain', inLibrary: true, localPath: 'D:/loras/film_grain.safetensors' },
      { file_name: 'ghost', hash: 'cc', strength: 0.5, modelVersionId: 999, modelName: 'Ghost', inLibrary: false },
      { file_name: 'gone', hash: 'dd', strength: 1, modelVersionId: 555, modelName: 'Gone', inLibrary: false, isDeleted: true },
    ],
    ...extra,
  }
}

const ANALYSIS: RecipeAnalysis = {
  base_model: 'SDXL 1.0',
  gen_params: { prompt: 'a cozy cabin in the snowy woods at night, warm light from the windows, cinematic', negative_prompt: 'blurry', steps: 30 },
  loras: [
    { name: 'Film Grain', version: 'v2', file_name: 'film_grain', hash: 'aa', weight: 0.8, id: 111, modelId: 11, existsLocally: true, localPath: 'D:/loras/film_grain.safetensors', thumbnailUrl: '/api/lm/previews?path=x' },
    { name: 'Ghost', version: 'v3', hash: 'cc', weight: 0.5, id: 999, modelId: 99, existsLocally: false, thumbnailUrl: 'https://image.civitai.com/x.jpeg' },
    { name: 'Gone', hash: 'dd', weight: 1, existsLocally: false, isDeleted: true },
  ],
  model: { name: 'Base XL', modelVersionId: 5, existsLocally: false },
  raw_metadata: { prompt: 'raw' },
  diagnostics: { channel: 'upload', exif_present: true },
  matching_recipes: [{ id: 'old', title: 'Old copy', lora_count: 3 }],
}

describe('recipe request builders', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    setBasePathsForTesting({ appBase: 'http://host/lm-ui/', appPath: '/lm-ui/', mountPrefix: '' })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => json({ success: true }))
    setFetch(fetchMock)
  })
  afterEach(() => {
    setFetch(null)
    setBasePathsForTesting(null)
  })

  it('maps the list query to the backend parameter names', () => {
    expect(
      recipeListParams({
        page: 2,
        pageSize: 60,
        sortBy: 'name:asc',
        search: '  cabin ',
        folder: 'portraits',
        baseModels: ['SDXL 1.0', 'Pony'],
        tags: ['a', 'b'],
        favoritesOnly: true,
        loraAvailability: ['missing'],
      }),
    ).toEqual({
      page: 2,
      page_size: 60,
      sort_by: 'name:asc',
      search: 'cabin',
      folder: 'portraits',
      recursive: 'true',
      base_models: 'SDXL 1.0,Pony',
      tag_include: ['a', 'b'],
      favorite: 'true',
      lora_availability: 'missing',
    })
    const minimal = recipeListParams({ page: 1, pageSize: 20 })
    expect(minimal.search).toBeUndefined()
    expect(minimal.folder).toBeUndefined()
    expect(minimal.recursive).toBeUndefined()
    expect(minimal.base_models).toBeUndefined()
    expect(minimal.favorite).toBeUndefined()
  })

  it('lists recipes with repeated tag_include and comma-joined base models', async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [], total: 0, page: 1, total_pages: 0 }))
    await recipesApi.list({ page: 1, pageSize: 10, tags: ['x', 'y'], baseModels: ['A', 'B'] })
    const url = last(fetchMock).url
    expect(url.startsWith('/api/lm/recipes?')).toBe(true)
    expect(url).toContain('tag_include=x&tag_include=y')
    expect(url).toContain('base_models=A%2CB')
  })

  it('update sends only the editable keys with PUT', async () => {
    expect(pickRecipeUpdate({ title: 'T', notes: 'n', file_path: 'x', favorite: true })).toEqual({ title: 'T', favorite: true })
    expect(() => pickRecipeUpdate({ notes: 'n' })).toThrow()
    await recipesApi.update('r 1', { title: 'New', tags: ['a'], favorite: true, file_path: 'evil' } as never)
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/r%201/update', method: 'PUT', body: { title: 'New', tags: ['a'], favorite: true } })
    expect(last(fetchMock).body).not.toHaveProperty('file_path')
  })

  it('delete, bulk delete, move and bulk move', async () => {
    await recipesApi.remove('abc')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/abc', method: 'DELETE' })
    await recipesApi.bulkDelete(['a', 'b'])
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipes/bulk-delete', method: 'POST', body: { recipe_ids: ['a', 'b'] } })
    await recipesApi.move('a', 'portraits/new')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/move', method: 'POST', body: { recipe_id: 'a', target_path: 'portraits/new' } })
    await recipesApi.moveBulk(['a', 'b'], 'x')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipes/move-bulk', body: { recipe_ids: ['a', 'b'], target_path: 'x' } })
  })

  it('reconnect, restore, suggestions and the checkpoint variants', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, suggestions: [{ target_name: 'x' }] }))
    await expect(recipesApi.reconnectSuggestions('a', 2, 'det')).resolves.toEqual([{ target_name: 'x' }])
    expect(last(fetchMock).url).toBe('/api/lm/recipe/a/lora/2/reconnect-suggestions?query=det')
    await recipesApi.reconnectSuggestions('a', 0)
    expect(last(fetchMock).url).toBe('/api/lm/recipe/a/lora/0/reconnect-suggestions')
    await recipesApi.reconnect('a', 1, 'style/detail')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/lora/reconnect', method: 'POST', body: { recipe_id: 'a', lora_index: 1, target_name: 'style/detail' } })
    await recipesApi.restore('a', 1)
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/lora/restore', body: { recipe_id: 'a', lora_index: 1 } })
    await recipesApi.checkpointSuggestions('a', 'xl')
    expect(last(fetchMock).url).toBe('/api/lm/recipe/a/checkpoint/reconnect-suggestions?query=xl')
    await recipesApi.reconnectCheckpoint('a', 'base_xl')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/checkpoint/reconnect', body: { recipe_id: 'a', target_name: 'base_xl' } })
    await recipesApi.restoreCheckpoint('a')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/checkpoint/restore', body: { recipe_id: 'a' } })
  })

  it('syntax, send workflow, rematch, opened and duplicates', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, syntax: '<lora:a:1>' }))
    await expect(recipesApi.syntax('a')).resolves.toBe('<lora:a:1>')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/a/syntax', method: 'GET' })
    await recipesApi.sendWorkflow('a')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/a/send-workflow', method: 'POST' })
    await recipesApi.rematch('a', true)
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/a/rematch', method: 'POST', body: { relaxed: true } })
    await recipesApi.markOpened('a')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/a/opened', method: 'POST' })
    fetchMock.mockResolvedValueOnce(json({ success: true, duplicate_groups: [{ key: 'g-1', recipes: [] }] }))
    await expect(recipesApi.findDuplicates(true)).resolves.toHaveLength(1)
    expect(last(fetchMock).url).toBe('/api/lm/recipes/find-duplicates?include_prompt=1')
  })

  it('analyze: a file is multipart with `image` first; a URL and a local path are JSON', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'cabin.png', { type: 'image/png' })
    await recipesApi.analyzeFile(file)
    const upload = last(fetchMock)
    expect(upload).toMatchObject({ url: '/api/lm/recipes/analyze-image', method: 'POST' })
    expect([...upload.form!.keys()]).toEqual(['image'])
    await recipesApi.analyzeUrl('https://civitai.com/images/123')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipes/analyze-image', body: { url: 'https://civitai.com/images/123' } })
    await recipesApi.analyzeLocal('D:/pics/a.png')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipes/analyze-local-image', body: { path: 'D:/pics/a.png' } })
  })

  it('save builds the multipart form the backend parses', () => {
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    const form = buildSaveForm({ image: file, name: 'Cabin', tags: ['a', 'b'], metadata: { base_model: 'X', loras: [] } })
    expect([...form.keys()]).toEqual(['image', 'name', 'tags', 'metadata'])
    expect(form.get('name')).toBe('Cabin')
    expect(JSON.parse(String(form.get('tags')))).toEqual(['a', 'b'])
    expect(JSON.parse(String(form.get('metadata')))).toEqual({ base_model: 'X', loras: [] })

    const remote = buildSaveForm({ imageBase64: 'QUJD', extension: '.jpg', name: 'R', tags: [], metadata: {} })
    expect([...remote.keys()]).toEqual(['image_base64', 'name', 'tags', 'metadata', 'extension'])
    expect(() => buildSaveForm({ name: 'x', tags: [], metadata: {} })).toThrow()
  })

  it('batch import start / progress / cancel', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, operation_id: 'op1' }))
    await expect(recipesApi.batchImportStart([{ source: 'https://x/a.png', type: 'url' }], ['t'], true)).resolves.toBe('op1')
    expect(last(fetchMock)).toMatchObject({
      url: '/api/lm/recipes/batch-import/start',
      body: { items: [{ source: 'https://x/a.png', type: 'url' }], tags: ['t'], skip_no_metadata: true },
    })
    fetchMock.mockResolvedValueOnce(json({ success: true, progress: { status: 'running', completed: 1, total: 2 } }))
    await expect(recipesApi.batchImportProgress('op1')).resolves.toMatchObject({ completed: 1 })
    expect(last(fetchMock).url).toBe('/api/lm/recipes/batch-import/progress?operation_id=op1')
    await recipesApi.batchImportCancel('op1')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipes/batch-import/cancel', body: { operation_id: 'op1' } })
  })
})

describe('recipe helpers', () => {
  it('classifies LoRA entries', () => {
    expect(loraState({ inLibrary: true })).toBe('library')
    expect(loraState({ inLibrary: false })).toBe('missing')
    expect(loraState({ inLibrary: false, isDeleted: true })).toBe('deleted')
    expect(loraState({ inLibrary: false, hashInvalid: true })).toBe('deleted')
    expect(loraState({ inLibrary: true, exclude: true })).toBe('excluded')
  })

  it('builds LoRA views and the availability summary', () => {
    const views = recipeLoraViews(recipe('a', { loras: [...recipe('a').loras!, { file_name: 'x', inLibrary: true, reconnectSnapshot: { file_name: 'old' } }] }))
    expect(views.map((view) => [view.index, view.name, view.state, view.strength])).toEqual([
      [0, 'Film Grain', 'library', 0.8],
      [1, 'Ghost', 'missing', 0.5],
      [2, 'Gone', 'deleted', 1],
      [3, 'x', 'library', 1],
    ])
    expect(views[3].previousName).toBe('old')
    expect(views[1].canReconnect).toBe(true)
    expect(views[0].canReconnect).toBe(true)
    expect(availability(recipe('a').loras!)).toEqual({ total: 3, library: 1, missing: 1, deleted: 1 })
  })

  it('collects missing LoRAs once and turns them into download links', () => {
    const a = recipe('a')
    const b = recipe('b', { loras: [{ file_name: 'ghost', hash: 'cc', modelVersionId: 999, inLibrary: false }, { file_name: 'nohash', inLibrary: false }] })
    const result = missingLoraTargets([a, b])
    expect(result.targets).toEqual([{ versionId: 999, name: 'Ghost', key: 'cc' }])
    expect(result.withoutVersion).toBe(1)
    const input = missingLorasInput(result.targets)
    expect(input).toBe('https://civitai.com/api/download/models/999')
    // The B1 download dialog understands the generated input.
    expect(parseBatchInput(input).entries.map((entry) => entry.target.versionId)).toEqual([999])
  })

  it('parses reconnect input like the classic modal', () => {
    expect(parseReconnectInput('<lora:style/detail_tweaker:0.7>')).toBe('style/detail_tweaker')
    expect(parseReconnectInput('  film_grain.safetensors ')).toBe('film_grain')
    expect(parseReconnectInput('plain')).toBe('plain')
    expect(parseReconnectInput('   ')).toBe('')
  })

  it('parses tag input and batch import input', () => {
    expect(parseTagInput(' a, b ,a,, C ')).toEqual(['a', 'b', 'C'])
    expect(parseBatchImportInput('https://civitai.com/images/1\nD:\\pics\\a.png\n\nnot a thing\nhttps://civitai.com/images/1')).toEqual({
      items: [
        { source: 'https://civitai.com/images/1', type: 'url' },
        { source: 'D:\\pics\\a.png', type: 'local_path' },
      ],
      invalid: ['not a thing'],
      duplicates: 1,
    })
  })

  it('normalises an analysis payload', () => {
    const view = normalizeAnalysis(ANALYSIS)
    expect(view.error).toBeNull()
    expect(view.loras.map((lora) => [lora.name, lora.state, lora.strength])).toEqual([
      ['Film Grain', 'library', 0.8],
      ['Ghost', 'missing', 0.5],
      ['Gone', 'deleted', 1],
    ])
    expect(view.missing).toBe(1)
    expect(view.checkpoint).toMatchObject({ name: 'Base XL', state: 'missing' })
    expect(view.matching).toHaveLength(1)
    expect(view.downloadInput).toBe('https://civitai.com/models/99?modelVersionId=999')
    expect(normalizeAnalysis({ error: 'No metadata found in this image', loras: [] }).error).toBe('No metadata found in this image')
  })

  it('suggests a recipe name from the prompt, then the file name', () => {
    expect(defaultRecipeName(ANALYSIS, 'x.png')).toBe('a cozy cabin in the snowy woods at night, warm')
    expect(defaultRecipeName({ loras: [] }, 'my image.final.png')).toBe('my image.final')
    expect(defaultRecipeName({ loras: [] })).toBe('')
  })

  it('builds the save metadata like the classic import', () => {
    expect(buildSaveMetadata(ANALYSIS, 'https://civitai.com/images/1')).toEqual({
      base_model: 'SDXL 1.0',
      loras: ANALYSIS.loras,
      gen_params: ANALYSIS.gen_params,
      raw_metadata: { prompt: 'raw' },
      diagnostics: { channel: 'upload', exif_present: true },
      checkpoint: ANALYSIS.model,
      source_path: 'https://civitai.com/images/1',
    })
    const meta = buildSaveMetadata({ loras: [], preview_nsfw_level: 4, workflow: '{}' })
    expect(meta).toMatchObject({ base_model: '', loras: [], gen_params: {}, raw_metadata: {}, preview_nsfw_level: 4, workflow: '{}' })
    expect(meta).not.toHaveProperty('source_path')
  })
})

describe('import flow', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    setBasePathsForTesting({ appBase: 'http://host/lm-ui/', appPath: '/lm-ui/', mountPrefix: '' })
    fetchMock.mockReset()
    setFetch(fetchMock)
  })
  afterEach(() => {
    setFetch(null)
    setBasePathsForTesting(null)
  })

  const file = () => new File([new Uint8Array([1, 2])], 'cabin.png', { type: 'image/png' })

  it('file -> analyzing -> review -> saving -> done', async () => {
    fetchMock.mockResolvedValueOnce(json(ANALYSIS))
    const flow = useRecipeImport()
    expect(flow.step.value).toBe('input')
    const pending = flow.analyzeFile(file())
    expect(flow.step.value).toBe('analyzing')
    await pending
    expect(flow.step.value).toBe('review')
    expect(flow.name.value).toBe('a cozy cabin in the snowy woods at night, warm')
    expect(flow.view.value?.missing).toBe(1)
    expect(flow.canSave.value).toBe(true)

    flow.tags.value = ['winter']
    fetchMock.mockResolvedValueOnce(json({ success: true, recipe_id: 'new-id', matching_recipes: [] }))
    await expect(flow.save()).resolves.toBe('new-id')
    expect(flow.step.value).toBe('done')
    const saved = last(fetchMock)
    expect(saved.url).toBe('/api/lm/recipes/save')
    expect(saved.form!.get('image')).toBeInstanceOf(File)
    expect(JSON.parse(String(saved.form!.get('tags')))).toEqual(['winter'])
    expect(JSON.parse(String(saved.form!.get('metadata')))).not.toHaveProperty('source_path')
  })

  it('an analysis without metadata (HTTP 200 + error) stops with the message', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'No metadata found in this image', loras: [] }))
    const flow = useRecipeImport()
    await flow.analyzeFile(file())
    expect(flow.step.value).toBe('input')
    expect(flow.error.value).toBe('No metadata found in this image')
    expect(flow.canSave.value).toBe(false)
    await expect(flow.save()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a backend error (400) also returns to the input with the message', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Failed to download image', loras: [] }, 400))
    const flow = useRecipeImport()
    await flow.analyzeInput('https://example.com/a.png')
    expect(flow.step.value).toBe('input')
    expect(flow.error.value).toBe('Failed to download image')
  })

  it('routes a URL to analyze-image, a local image path to analyze-local-image, rejects anything else', async () => {
    fetchMock.mockImplementation(async () => json({ ...ANALYSIS, image_base64: 'QUJD', extension: '.jpg' }))
    const flow = useRecipeImport()
    await flow.analyzeInput('https://civitai.com/images/42')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipes/analyze-image', body: { url: 'https://civitai.com/images/42' } })
    flow.reset()
    await flow.analyzeInput('D:\\pics\\cabin.webp')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipes/analyze-local-image', body: { path: 'D:\\pics\\cabin.webp' } })
    flow.reset()
    const before = fetchMock.mock.calls.length
    await flow.analyzeInput('hello world')
    expect(fetchMock.mock.calls.length).toBe(before)
    expect(flow.error.value).toBeTruthy()
  })

  it('a URL import saves image_base64 and records the source URL', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...ANALYSIS, image_base64: 'QUJD', extension: '.jpg' }))
    const flow = useRecipeImport()
    await flow.analyzeInput('https://civitai.com/images/42')
    fetchMock.mockResolvedValueOnce(json({ success: true, recipe_id: 'r42' }))
    await flow.save()
    const form = last(fetchMock).form!
    expect(form.get('image')).toBeNull()
    expect(form.get('image_base64')).toBe('QUJD')
    expect(form.get('extension')).toBe('.jpg')
    expect(JSON.parse(String(form.get('metadata'))).source_path).toBe('https://civitai.com/images/42')
  })

  it('needs a name; a failed save stays in review with the error', async () => {
    fetchMock.mockResolvedValueOnce(json(ANALYSIS))
    const flow = useRecipeImport()
    await flow.analyzeFile(file())
    flow.name.value = '   '
    expect(flow.canSave.value).toBe(false)
    await expect(flow.save()).resolves.toBeNull()
    flow.name.value = 'Cabin'
    fetchMock.mockResolvedValueOnce(json({ error: 'disk full' }, 500))
    await expect(flow.save()).resolves.toBeNull()
    expect(flow.step.value).toBe('review')
    expect(flow.error.value).toBe('disk full')
  })

  it('a newer analysis wins over a slower older one', async () => {
    let releaseFirst: (value: Response) => void = () => undefined
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce(json({ ...ANALYSIS, base_model: 'Second' }))
    const flow = useRecipeImport()
    const first = flow.analyzeFile(file())
    await flow.analyzeFile(new File([new Uint8Array([3])], 'second.png', { type: 'image/png' }))
    releaseFirst(json({ ...ANALYSIS, base_model: 'First' }))
    await first
    expect(flow.analysis.value?.base_model).toBe('Second')
    expect(flow.step.value).toBe('review')
  })
})

describe('recipe actions', () => {
  const fetchMock = vi.fn()
  const toasts = useToasts()
  beforeEach(() => {
    vi.useFakeTimers()
    setBasePathsForTesting({ appBase: 'http://host/lm-ui/', appPath: '/lm-ui/', mountPrefix: '' })
    fetchMock.mockReset()
    toasts.toasts.value = []
    setFetch(fetchMock)
  })
  afterEach(() => {
    setFetch(null)
    setBasePathsForTesting(null)
    vi.useRealTimers()
  })

  function hooks() {
    return { removed: vi.fn(), changed: vi.fn(), updated: vi.fn() }
  }

  it('delete asks a danger confirm, removes the card and offers undo for the staged batch', async () => {
    const h = hooks()
    const actions = useRecipeActions(h)
    const confirm = autoConfirm(true)
    fetchMock.mockResolvedValueOnce(json({ success: true, batch_id: '0123456789abcdef0123456789abcdef' }))
    await expect(actions.deleteRecipes([recipe('a')])).resolves.toBe(true)
    confirm.stop()
    expect(confirm.seen[0].danger).toBe(true)
    expect(confirm.seen[0].message).toContain('20')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/a', method: 'DELETE' })
    expect(h.removed).toHaveBeenCalledWith(['a'])
    const toast = toasts.toasts.value.at(-1)!
    expect(toast.action?.label).toBe('Undo')
    fetchMock.mockResolvedValueOnce(json({ success: true, kind: 'recipe' }))
    toast.action!.run()
    await vi.runOnlyPendingTimersAsync()
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/undo-delete', body: { batch_id: '0123456789abcdef0123456789abcdef' } })
    expect(h.changed).toHaveBeenCalled()
    expect(UNDO_TOAST_MS).toBeLessThan(20000)
  })

  it('a cancelled confirm sends nothing; a hard delete (no batch) offers no undo', async () => {
    const h = hooks()
    const actions = useRecipeActions(h)
    let confirm = autoConfirm(false)
    await expect(actions.deleteRecipes([recipe('a')])).resolves.toBe(false)
    confirm.stop()
    expect(fetchMock).not.toHaveBeenCalled()

    confirm = autoConfirm(true)
    fetchMock.mockResolvedValueOnce(json({ success: true, batch_id: null }))
    await actions.deleteRecipes([recipe('a')])
    confirm.stop()
    expect(toasts.toasts.value.at(-1)!.action).toBeUndefined()
  })

  it('bulk delete uses one request and reports failures', async () => {
    const h = hooks()
    const actions = useRecipeActions(h)
    const confirm = autoConfirm(true)
    fetchMock.mockResolvedValueOnce(
      json({ success: true, deleted: ['a'], failed: [{ id: 'b', reason: 'Recipe not found' }], batch_id: 'f'.repeat(32) }),
    )
    await actions.deleteRecipes([recipe('a'), recipe('b')])
    confirm.stop()
    expect(confirm.seen[0].title).toContain('2')
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipes/bulk-delete', body: { recipe_ids: ['a', 'b'] } })
    expect(h.removed).toHaveBeenCalledWith(['a'])
    expect(toasts.toasts.value.at(-1)!.kind).toBe('warning')
  })

  it('favorite, rename and tags update the recipe in place', async () => {
    const h = hooks()
    const actions = useRecipeActions(h)
    fetchMock.mockImplementation(async () => json({ success: true }))
    await actions.toggleFavorite(recipe('a'))
    expect(last(fetchMock)).toMatchObject({ url: '/api/lm/recipe/a/update', method: 'PUT', body: { favorite: true } })
    expect(h.updated).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', favorite: true }))

    await expect(actions.rename(recipe('a'), '  ')).resolves.toBeTruthy()
    await expect(actions.rename(recipe('a'), ' Night cabin ')).resolves.toBeNull()
    expect(last(fetchMock).body).toEqual({ title: 'Night cabin' })

    await actions.addTags([recipe('a'), recipe('b', { tags: ['winter'] })], ['winter', 'cozy'])
    const bodies = calls(fetchMock).slice(-2).map((call) => call.body)
    expect(bodies).toEqual([{ tags: ['portrait', 'winter', 'cozy'] }, { tags: ['winter', 'cozy'] }])
  })

  it('reconnect returns the updated LoRA and warns on a same-family base model', async () => {
    const h = hooks()
    const actions = useRecipeActions(h)
    fetchMock.mockResolvedValueOnce(
      json({
        success: true,
        updated_lora: { file_name: 'detail', inLibrary: true, hash: 'bb' },
        base_model_mismatch: { recipe_base_model: 'Pony', lora_base_model: 'Illustrious' },
      }),
    )
    const result = await actions.reconnect(recipe('a'), 1, '<lora:detail:1>')
    expect(result).toEqual({ ok: true })
    expect(last(fetchMock).body).toEqual({ recipe_id: 'a', lora_index: 1, target_name: 'detail' })
    const updated = h.updated.mock.calls.at(-1)![0] as RecipeItem
    expect(updated.loras![1]).toMatchObject({ file_name: 'detail', inLibrary: true })
    expect(updated.loras![0]).toMatchObject({ file_name: 'film_grain' })
    expect(toasts.toasts.value.some((toast) => toast.kind === 'warning' && toast.message.includes('Illustrious'))).toBe(true)

    fetchMock.mockResolvedValueOnce(json({ error: "Local LoRA not found with name: nope" }, 404))
    await expect(actions.reconnect(recipe('a'), 1, 'nope')).resolves.toEqual({ ok: false, error: 'Local LoRA not found with name: nope' })
    await expect(actions.reconnect(recipe('a'), 1, ' ')).resolves.toMatchObject({ ok: false })
  })

  it('move reports success per recipe and reloads', async () => {
    const h = hooks()
    const actions = useRecipeActions(h)
    fetchMock.mockResolvedValueOnce(
      json({
        success: true,
        results: [
          { recipe_id: 'a', success: true, folder: 'x' },
          { recipe_id: 'b', success: false, message: 'boom' },
        ],
        success_count: 1,
        failure_count: 1,
      }),
    )
    const summary = await actions.moveRecipes([recipe('a'), recipe('b')], 'x')
    expect(summary).toEqual({ moved: ['a'], failed: [{ id: 'b', message: 'boom' }] })
    expect(h.changed).toHaveBeenCalled()
  })
})
