/**
 * Phase B2b: settings model (validation, dirty tracking, secrets, patch
 * order), example images (local/remote matching, request bodies, flows),
 * statistics chart transforms, doctor / backups / archive flows. Written
 * before the UI components; every backend call is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, watch } from 'vue'
import { setFetch } from '@/api/http'
import { exampleImagesApi, statsApi, backupApi, systemApi } from '@/api/maintenance'
import { ALL_FIELDS, SETTINGS_SECTIONS } from '@/config/settingsSchema'
import { useConfirm } from '@/composables/useFeedback'
import { useExampleDownload, useExampleImages } from '@/composables/useExampleImages'
import { useBackups, useDoctor, useMetadataArchive } from '@/composables/useMaintenance'
import { useSettingsForm } from '@/composables/useSettingsForm'
import { setBasePathsForTesting } from '@/utils/basePath'
import {
  buildExampleMedia,
  buildImportForm,
  findLocalFile,
  normaliseDownloadStatus,
  nsfwBody,
  nsfwLabel,
  unmatchedFiles,
  type ExampleFile,
} from '@/utils/exampleImages'
import {
  describeDetail,
  environmentMarkdown,
  filenameFromDisposition,
  normaliseBackupStatus,
  normaliseDoctor,
  normaliseEnvironment,
  normaliseUpdate,
  restoreConfirmed,
  validateBackupFile,
} from '@/utils/maintenance'
import {
  DELETE_MARKER,
  buildPatch,
  changedFields,
  draftFromSettings,
  isDirty,
  orderPatch,
  parseMap,
  patchEffects,
  redactPatch,
  resetToDefault,
  sanitizeSettings,
  splitList,
  validateDraft,
  validateFilenameTemplate,
  validatePathTemplate,
  type FieldDef,
} from '@/utils/settingsModel'
import {
  arcPath,
  donutSlices,
  linePaths,
  niceTicks,
  normaliseInsights,
  normaliseOverview,
  normaliseStorage,
  normaliseTimeline,
  scatterPoints,
  seriesClass,
  stackedRows,
  tagCloud,
  topUsedAcross,
  usageRate,
  largest,
  barPercent,
} from '@/utils/stats'

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
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

// =========================================================================== settings model

const field = (key: string) => ALL_FIELDS.find((f) => f.key === key)!

const SERVER = {
  language: 'en',
  civitai_api_key_set: true,
  huggingface_api_key_set: false,
  llm_api_key_set: false,
  proxy_enabled: true,
  proxy_host: 'proxy.lan',
  proxy_port: '8080',
  proxy_username: 'me',
  proxy_password: 'pw-in-clear',
  download_queue_max_concurrent: 4,
  card_preview_cycle_interval: 2,
  download_path_templates: { lora: '{base_model}', checkpoint: '{base_model}' },
  download_filename_templates: { lora: '{model_name}' },
  send_to_workflow_exclusions: { node_classes: ['A'], title_patterns: [] },
  extra_folder_paths: { loras: [], checkpoints: [], unet: [], embeddings: [] },
  example_images_path: '',
  base_model_path_mappings: { 'SDXL 1.0': 'sdxl' },
  priority_tags: { lora: 'character, style', checkpoint: 'x', embedding: 'y' },
  enable_other_models: true,
  enabled_other_sub_types: ['vae'],
  default_other_roots: { vae: 'G:/vae', upscaler: 'G:/up' },
  sticky_controls: false,
}

describe('settings model', () => {
  it('the schema covers every classic section and has unique keys with labels', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual(['general', 'downloads', 'ai', 'proxy', 'interface', 'library', 'organization', 'example-images', 'metadata', 'backups', 'about'])
    const keys = ALL_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const f of ALL_FIELDS) expect(f.label).toMatch(/^set\./)
  })

  it('sanitizes secrets that GET returns in clear and keeps a configured flag', () => {
    const clean = sanitizeSettings(SERVER)
    expect(clean.proxy_password).toBeUndefined()
    expect(clean.proxy_password_set).toBe(true)
    expect(JSON.stringify(clean)).not.toContain('pw-in-clear')
    expect(sanitizeSettings({ proxy_password: '' }).proxy_password_set).toBe(false)
  })

  it('an untouched draft is clean and secrets start in keep mode', () => {
    const settings = sanitizeSettings(SERVER)
    const draft = draftFromSettings(settings, ALL_FIELDS)
    expect(buildPatch(settings, draft, ALL_FIELDS)).toEqual({})
    expect(isDirty(settings, draft, ALL_FIELDS)).toBe(false)
    expect(draft.civitai_api_key).toEqual({ mode: 'keep', value: '' })
    expect(draft.proxy_password).toEqual({ mode: 'keep', value: '' })
    // Values shown with their backend defaults when missing.
    expect(draft['download_path_templates.embedding']).toBe('{base_model}/{first_tag}')
    expect(draft.download_queue_max_concurrent).toBe('4')
  })

  it('builds a patch with only the changed keys, merging dotted keys into the whole object', () => {
    const settings = sanitizeSettings(SERVER)
    const draft = draftFromSettings(settings, ALL_FIELDS)
    draft['download_path_templates.lora'] = ''
    draft['send_to_workflow_exclusions.title_patterns'] = 'Preview*\nDebug;Debug'
    draft.sticky_controls = true
    draft['default_other_roots.vae'] = 'G:/vae2'
    const patch = buildPatch(settings, draft, ALL_FIELDS)
    expect(patch).toEqual({
      sticky_controls: true,
      download_path_templates: { lora: '', checkpoint: '{base_model}' },
      send_to_workflow_exclusions: { node_classes: ['A'], title_patterns: ['Preview*', 'Debug'] },
      default_other_roots: { vae: 'G:/vae2', upscaler: 'G:/up' },
    })
    expect(changedFields(settings, draft, ALL_FIELDS).sort()).toEqual(
      ['default_other_roots.vae', 'download_path_templates.lora', 'send_to_workflow_exclusions.title_patterns', 'sticky_controls'].sort(),
    )
  })

  it('numbers and lists are normalised before comparing', () => {
    const settings = { download_queue_max_concurrent: 3, metadata_refresh_skip_paths: [] }
    const fields = [field('download_queue_max_concurrent'), field('metadata_refresh_skip_paths')]
    const draft = draftFromSettings(settings, fields)
    draft.download_queue_max_concurrent = ' 3 '
    draft.metadata_refresh_skip_paths = '  \n , '
    expect(buildPatch(settings, draft, fields)).toEqual({})
    draft.download_queue_max_concurrent = '5'
    expect(buildPatch(settings, draft, fields)).toEqual({ download_queue_max_concurrent: 5 })
  })

  it('validates numbers, ranges, steps, templates, ports, urls and folder overlap', () => {
    const settings = sanitizeSettings(SERVER)
    const draft = draftFromSettings(settings, ALL_FIELDS)
    draft.download_queue_max_concurrent = '6'
    draft.card_preview_cycle_interval = '1.25'
    draft['download_path_templates.lora'] = '/abs/{bad}'
    draft['download_filename_templates.lora'] = 'a/b'
    draft.proxy_port = '70000'
    draft.llm_api_base = 'ftp://x'
    draft['extra_folder_paths.checkpoints'] = 'D:\\Models\\Shared'
    draft['extra_folder_paths.unet'] = 'd:/models/shared'
    draft['priority_tags.lora'] = 'character(alias'
    const errors = validateDraft(ALL_FIELDS, draft)
    expect(errors.download_queue_max_concurrent?.key).toBe('set.err.range')
    expect(errors.card_preview_cycle_interval?.key).toBe('set.err.step')
    expect(errors['download_path_templates.lora']?.key).toBe('set.err.templateSlashes')
    expect(errors['download_filename_templates.lora']?.key).toBe('set.err.filenameChars')
    expect(errors.proxy_port?.key).toBe('set.err.port')
    expect(errors.llm_api_base?.key).toBe('set.err.url')
    expect(errors['extra_folder_paths.unet']?.key).toBe('set.err.overlap')
    expect(errors['priority_tags.lora']?.key).toBe('set.err.parens')
    // Hidden fields are not validated (proxy off hides the port).
    draft.proxy_enabled = false
    expect(validateDraft(ALL_FIELDS, draft).proxy_port).toBeUndefined()
  })

  it('template validators', () => {
    expect(validatePathTemplate('{base_model}/{first_tag}')).toBeNull()
    expect(validatePathTemplate('')).toBeNull()
    expect(validatePathTemplate('a//b')?.key).toBe('set.err.templateSlashes')
    expect(validatePathTemplate('{nope}')).toEqual({ key: 'set.err.placeholder', params: { placeholder: '{nope}' } })
    expect(validatePathTemplate('a:b')?.key).toBe('set.err.templateChars')
    expect(validateFilenameTemplate('{model_name}-{hash_short}')).toBeNull()
    expect(validateFilenameTemplate('{original_name}')).toBeNull()
  })

  it('secrets: set sends the value, clear sends "" or the delete marker, keep sends nothing', () => {
    const settings = sanitizeSettings(SERVER)
    const draft = draftFromSettings(settings, ALL_FIELDS)
    draft.civitai_api_key = { mode: 'set', value: '  new-key  ' }
    draft.proxy_password = { mode: 'clear', value: '' }
    draft.llm_api_key = { mode: 'clear', value: '' }
    expect(buildPatch(settings, draft, ALL_FIELDS)).toEqual({ civitai_api_key: 'new-key', proxy_password: DELETE_MARKER, llm_api_key: '' })
    draft.huggingface_api_key = { mode: 'set', value: '   ' }
    expect(validateDraft(ALL_FIELDS, draft).huggingface_api_key?.key).toBe('set.err.secretEmpty')
  })

  it('redacts secrets for display and orders validated keys first', () => {
    expect(redactPatch({ civitai_api_key: 'abc', proxy_password: DELETE_MARKER, x: 1 })).toEqual({ civitai_api_key: '••••••', proxy_password: DELETE_MARKER, x: 1 })
    const ordered = orderPatch({ sticky_controls: true, download_queue_max_concurrent: 3, recipes_path: 'R', example_images_path: 'E' })
    expect(Object.keys(ordered)).toEqual(['example_images_path', 'download_queue_max_concurrent', 'recipes_path', 'sticky_controls'])
  })

  it('reports side effects that need a confirm and resets to defaults', () => {
    const effects = patchEffects(['recipes_path', 'sticky_controls', 'extra_folder_paths.loras', 'use_portable_settings'], ALL_FIELDS)
    expect(effects.map((f) => f.key)).toEqual(['use_portable_settings', 'recipes_path', 'extra_folder_paths.loras'])
    expect(resetToDefault(field('card_preview_cycle_interval'))).toBe('2')
    expect(resetToDefault(field('blur_mature_content'))).toBe(true)
    expect(resetToDefault(field('metadata_refresh_skip_paths'))).toBe('')
  })

  it('list and map helpers', () => {
    expect(splitList('a, b;\nb\r\nc ')).toEqual(['a', 'b', 'c'])
    expect(parseMap('SDXL 1.0 = sdxl\nbroken line\nPony= pony ')).toEqual({ 'SDXL 1.0': 'sdxl', Pony: 'pony' })
  })
})

describe('settings form flow', () => {
  const fields: FieldDef[] = [field('sticky_controls'), field('download_queue_max_concurrent'), field('civitai_api_key'), field('recipes_path'), field('proxy_password'), field('proxy_enabled')]

  it('loads, saves only the changes (validated keys first) and re-reads', async () => {
    let stored: Record<string, unknown> = { ...SERVER }
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        stored = { ...stored, ...JSON.parse(String(init.body)) }
        return json({ success: true })
      }
      return json({ success: true, settings: stored })
    })
    const form = useSettingsForm(fields)
    await form.load()
    expect(form.draft.value?.proxy_password).toEqual({ mode: 'keep', value: '' })
    form.draft.value!.sticky_controls = true
    form.draft.value!.download_queue_max_concurrent = '3'
    form.draft.value!.civitai_api_key = { mode: 'set', value: 'k' }
    await nextTick()
    expect(form.dirty.value).toBe(true)
    expect(await form.save()).toBe(true)
    const post = calls(fetchMock).find((c) => c.method === 'POST')!
    expect(post.url).toBe('/api/lm/settings')
    expect(Object.keys(post.body as object)).toEqual(['download_queue_max_concurrent', 'sticky_controls', 'civitai_api_key'])
    // The secret never goes into a URL.
    expect(calls(fetchMock).every((c) => !c.url.includes('k=') && !c.url.includes('api_key'))).toBe(true)
    expect(form.dirty.value).toBe(false)
  })

  it('a rejected save shows the error, re-reads the server and keeps the unsaved edits', async () => {
    let stored: Record<string, unknown> = { ...SERVER }
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ success: false, error: 'download_queue_max_concurrent must be an integer from 1 to 5' })
      return json({ success: true, settings: stored })
    })
    const form = useSettingsForm(fields)
    await form.load()
    form.draft.value!.sticky_controls = true
    expect(await form.save()).toBe(false)
    expect(form.saveError.value).toContain('must be an integer')
    expect(form.draft.value!.sticky_controls).toBe(true)
    expect(calls(fetchMock).filter((c) => c.method !== 'POST').length).toBe(2)
    stored = stored
  })

  it('invalid drafts never reach the server', async () => {
    fetchMock.mockImplementation(async () => json({ success: true, settings: { ...SERVER } }))
    const form = useSettingsForm(fields)
    await form.load()
    form.draft.value!.download_queue_max_concurrent = '9'
    expect(await form.save()).toBe(false)
    expect(calls(fetchMock).some((c) => c.method === 'POST')).toBe(false)
  })

  it('side effects ask first; cancel sends nothing', async () => {
    fetchMock.mockImplementation(async () => json({ success: true, settings: { ...SERVER } }))
    const form = useSettingsForm(fields)
    await form.load()
    form.draft.value!.recipes_path = 'D:/new-recipes'
    const confirm = autoConfirm(false)
    expect(await form.save()).toBe(false)
    confirm.stop()
    expect(confirm.seen[0].message).toContain('moved')
    expect(confirm.seen[0].danger).toBe(true)
    expect(calls(fetchMock).some((c) => c.method === 'POST')).toBe(false)
  })

  it('discard restores the server values', async () => {
    fetchMock.mockImplementation(async () => json({ success: true, settings: { ...SERVER } }))
    const form = useSettingsForm(fields)
    await form.load()
    form.draft.value!.sticky_controls = true
    form.discard()
    expect(form.dirty.value).toBe(false)
  })
})

// =========================================================================== example images

const FILES: ExampleFile[] = [
  { name: 'image_0.jpeg', path: '/example_images_static/h/image_0.jpeg', is_video: false },
  { name: 'image_2.mp4', path: '/example_images_static/h/image_2.mp4', is_video: true },
  { name: 'custom_abc12345.png', path: '/example_images_static/h/custom_abc12345.png', is_video: false },
  { name: 'image_10.jpeg', path: '/example_images_static/h/image_10.jpeg' },
]

describe('example images: local matching', () => {
  const images = [
    { url: 'https://image.civitai.com/a.jpeg', nsfwLevel: 1 },
    { url: 'https://image.civitai.com/b.jpeg', nsfwLevel: 4 },
    { url: 'https://image.civitai.com/c.mp4', type: 'video' },
  ]
  const custom = [{ id: 'abc12345', url: '', nsfwLevel: 0 }, { id: 'gone', url: '' }]

  it('matches regular images by source index and custom images by id', () => {
    expect(findLocalFile(images[0], 0, 'civitai', FILES)?.name).toBe('image_0.jpeg')
    expect(findLocalFile(images[1], 1, 'civitai', FILES)).toBeNull()
    expect(findLocalFile(images[0], 1, 'civitai', [{ name: 'image_10.jpeg', path: 'x' }])).toBeNull()
    expect(findLocalFile(custom[0], 0, 'custom', FILES)?.name).toBe('custom_abc12345.png')
  })

  it('local files win, remote is the fallback, custom without a file is dropped', () => {
    const media = buildExampleMedia(images, custom, FILES)
    expect(media.map((m) => [m.key, m.local, m.url])).toEqual([
      ['civitai:0', true, '/example_images_static/h/image_0.jpeg'],
      ['civitai:1', false, 'https://image.civitai.com/b.jpeg'],
      ['civitai:2', true, '/example_images_static/h/image_2.mp4'],
      ['custom:abc12345', true, '/example_images_static/h/custom_abc12345.png'],
    ])
    expect(media[2].isVideo).toBe(true)
    expect(media[1].nsfwLevel).toBe(4)
    expect(unmatchedFiles(media, FILES).map((f) => f.name)).toEqual(['image_10.jpeg'])
  })

  it('request bodies', () => {
    const media = buildExampleMedia(images, custom, FILES)
    expect(nsfwBody('h', media[1], 8)).toEqual({ model_hash: 'h', nsfw_level: 8, source: 'civitai', index: 1 })
    expect(nsfwBody('h', media[3], 2)).toEqual({ model_hash: 'h', nsfw_level: 2, source: 'custom', id: 'abc12345' })
    const form = buildImportForm('h', 'D:/m.safetensors', [new File(['x'], 'a.png'), new File(['y'], 'b.mp4')])
    expect([...form.keys()]).toEqual(['model_hash', 'model_path', 'files', 'files'])
    expect(nsfwLabel(0)).toBe('Unrated')
    expect(nsfwLabel(8)).toBe('X')
    expect(nsfwLabel(12)).toBe('X')
  })

  it('normalises the download status (compact and full)', () => {
    const status = normaliseDownloadStatus({
      is_downloading: true,
      status: { status: 'paused', total: 10, completed: 4, current_model: 'Style (abcd1234)', errors: ['a', 'b', 'c', 'd'], elapsed_seconds: 65.4, failed_count: 2, retryable_models: ['x'] },
    })
    expect(status).toMatchObject({ downloading: true, state: 'paused', percent: 40, errors: ['b', 'c', 'd'], elapsedSeconds: 65, failed: 2, retryable: 1 })
    expect(normaliseDownloadStatus({ status: { status: 'weird' } }).state).toBe('idle')
  })
})

describe('example images: flows', () => {
  const model = { sha256: 'ABCD', file_path: 'D:/loras/style.safetensors', model_name: 'Style' }
  const regular = [{ url: 'https://image.civitai.com/a.jpeg' }]

  it('loads files with the lower-case hash and reports a missing path as "not configured"', async () => {
    fetchMock.mockImplementationOnce(async () => json({ success: false, error: 'No example images path configured' }, 400))
    const ex = useExampleImages(() => model, { modelType: () => 'lora' })
    await ex.loadFiles()
    expect(calls(fetchMock)[0].url).toBe('/api/lm/example-image-files?model_hash=abcd')
    expect(ex.configured.value).toBe(false)
    expect(ex.error.value).toBeNull()
  })

  it('imports as multipart and adopts the returned metadata', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('import-example-images')
        ? json({ success: true, files: [{ name: 'custom_x.png', path: '/p' }], regular_images: regular, custom_images: [{ id: 'x', url: '' }] })
        : json({ success: true, files: [{ name: 'custom_x.png', path: '/example_images_static/abcd/custom_x.png' }] }),
    )
    const ex = useExampleImages(() => model, { modelType: () => 'lora' })
    ex.setMetadata(regular, [])
    expect(await ex.importFiles([new File(['x'], 'a.png'), new File(['y'], 'notes.txt')])).toBe(true)
    const post = calls(fetchMock).find((c) => c.method === 'POST')!
    expect(post.url).toBe('/api/lm/import-example-images')
    expect(post.form!.getAll('files')).toHaveLength(1)
    expect(post.form!.get('model_hash')).toBe('abcd')
    expect(ex.media.value.map((m) => m.key)).toEqual(['civitai:0', 'custom:x'])
  })

  it('delete asks first (danger) and only then posts', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('delete-example-image') ? json({ success: true, regular_images: regular, custom_images: [] }) : json({ success: true, files: [] }),
    )
    const ex = useExampleImages(() => model, { modelType: () => 'lora' })
    ex.setMetadata(regular, [{ id: 'x', url: '' }])
    const files: ExampleFile[] = [{ name: 'custom_x.png', path: '/p' }]
    ex.files.value = files
    const item = ex.media.value.find((m) => m.source === 'custom')!

    let confirm = autoConfirm(false)
    expect(await ex.remove(item)).toBe(false)
    confirm.stop()
    expect(confirm.seen[0].danger).toBe(true)
    expect(confirm.seen[0].message).toContain('permanently')
    expect(calls(fetchMock)).toHaveLength(0)

    confirm = autoConfirm(true)
    expect(await ex.remove(item)).toBe(true)
    confirm.stop()
    expect(calls(fetchMock)[0]).toMatchObject({ url: '/api/lm/delete-example-image', method: 'POST', body: { model_hash: 'abcd', short_id: 'x' } })
  })

  it('regular (downloaded) images cannot be deleted', async () => {
    const ex = useExampleImages(() => model, { modelType: () => 'lora' })
    ex.setMetadata(regular, [])
    expect(await ex.remove(ex.media.value[0])).toBe(false)
    expect(calls(fetchMock)).toHaveLength(0)
  })

  it('sets the NSFW level and downloads one model synchronously', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('set-nsfw-level')) return json({ success: true, regular_images: [{ url: 'https://image.civitai.com/a.jpeg', nsfwLevel: 8 }], custom_images: [] })
      if (url.includes('force-download')) return json({ success: true, result: { total: 1, processed: 1, successful: 1, errors: [] } })
      return json({ success: true, files: [] })
    })
    const ex = useExampleImages(() => model, { modelType: () => 'checkpoint', optimize: () => false })
    ex.setMetadata(regular, [])
    expect(await ex.setNsfw(ex.media.value[0], 8)).toBe(true)
    expect(ex.media.value[0].nsfwLevel).toBe(8)
    expect(await ex.downloadThis()).toBe(true)
    const download = calls(fetchMock).find((c) => c.url.includes('force-download'))!
    expect(download.body).toEqual({ model_hashes: ['abcd'], optimize: false, model_types: ['checkpoint'] })
  })

  it('library-wide download asks first, then starts and polls the status', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('download-example-images')
        ? json({ success: true, status: { status: 'running', total: 5, completed: 0 } })
        : json({ success: true, is_downloading: false, status: { status: 'completed', total: 5, completed: 5 } }),
    )
    const dl = useExampleDownload()
    let confirm = autoConfirm(false)
    expect(await dl.start(true)).toBe(false)
    confirm.stop()
    expect(calls(fetchMock)).toHaveLength(0)
    confirm = autoConfirm(true)
    expect(await dl.start(true)).toBe(true)
    confirm.stop()
    expect(calls(fetchMock)[0]).toMatchObject({ url: '/api/lm/download-example-images', body: { optimize: true, model_types: ['lora', 'checkpoint', 'embedding'] } })
    expect(dl.status.value.state).toBe('running')
    await dl.refresh()
    expect(dl.status.value.state).toBe('completed')
    dl.dispose()
  })

  it('api helpers build the documented URLs', async () => {
    fetchMock.mockImplementation(async () => json({ success: true, data: { items: [], total: 0 } }))
    await exampleImagesApi.status()
    await statsApi.usageList('checkpoint', 50)
    await systemApi.checkUpdates(false)
    expect(calls(fetchMock).map((c) => c.url)).toEqual([
      '/api/lm/example-images-status?compact=1',
      '/api/lm/stats/model-usage-list?type=checkpoint&sort=desc&limit=50&offset=50',
      '/api/lm/check-updates?nightly=false',
    ])
  })
})

// =========================================================================== statistics

describe('statistics transforms', () => {
  it('overview and usage rate (classic formula)', () => {
    const overview = normaliseOverview({ total_models: 10, lora_count: 6, unused_loras: 3, unused_checkpoints: 1, unused_embeddings: 0, total_generations: 25, model_types_distribution: { lora: 5, locon: 1 } })
    expect(usageRate(overview)).toBe(60)
    expect(overview.modelTypes).toEqual({ lora: 5, locon: 1 })
    expect(usageRate(normaliseOverview({}))).toBe(0)
  })

  it('donut slices: percentages, series cycle, "Other" merge, empty data', () => {
    const slices = donutSlices([['a', 3], ['b', 1], ['zero', 0]])
    expect(slices.map((s) => [s.label, s.percent, s.series])).toEqual([['a', 75], ['b', 25]].map(([l, p], i) => [l, p, seriesClass(i)]))
    expect(slices[0].path.startsWith('M')).toBe(true)
    const many = donutSlices(Array.from({ length: 9 }, (_, i) => [`m${i}`, 9 - i] as [string, number]), { maxSlices: 4 })
    expect(many).toHaveLength(4)
    expect(many[3]).toMatchObject({ label: 'Other', value: 6 + 5 + 4 + 3 + 2 + 1 })
    expect(donutSlices([])).toEqual([])
    expect(seriesClass(6)).toBe('series-1')
    expect(arcPath(80, 80, 80, 50, 0, 360)).toContain('A80 80 0 1 1')
  })

  it('stacked base-model rows are sorted by total and scaled to the largest row', () => {
    const rows = stackedRows({ loras: { SDXL: 6, Pony: 2 }, checkpoints: { SDXL: 2, Flux: 5 }, embeddings: {} }, { loras: 'LoRAs', checkpoints: 'Checkpoints', embeddings: 'Embeddings' })
    expect(rows.map((r) => [r.label, r.total])).toEqual([['SDXL', 8], ['Flux', 5], ['Pony', 2]])
    expect(rows[0].segments.map((s) => s.widthPercent)).toEqual([75, 25, 0])
  })

  it('timeline line paths and nice ticks', () => {
    const points = normaliseTimeline([
      { date: '2026-11-01', lora_usage: 0, checkpoint_usage: 2, embedding_usage: 0, total_usage: 2 },
      { date: '2026-11-02', lora_usage: 7, checkpoint_usage: 1, embedding_usage: 0, total_usage: 8 },
    ])
    const { series, ticks } = linePaths(points, [{ key: 'lora', name: 'LoRAs' }], 100, 50)
    expect(ticks).toEqual([0, 2, 4, 6, 8])
    expect(series[0].path).toBe('M0 50 L100 6.25')
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(95)).toEqual([0, 25, 50, 75, 100])
  })

  it('top used, tags, storage, scatter and insights', () => {
    const top = topUsedAcross({ loras: [{ name: 'a', usageCount: 3, baseModel: '', previewUrl: '', folder: '' }], checkpoints: [{ name: 'b', usageCount: 9, baseModel: '', previewUrl: '', folder: '' }, { name: 'c', usageCount: 0, baseModel: '', previewUrl: '', folder: '' }] })
    expect(top.map((t) => [t.name, t.type])).toEqual([['b', 'checkpoints'], ['a', 'loras']])
    expect(barPercent(5, 10)).toBe(50)
    expect(barPercent(5, 0)).toBe(0)
    expect(tagCloud([{ tag: 'style', count: 10 }, { tag: 'anime', count: 1 }]).map((t) => t.weight)).toEqual([5, 1])
    const storage = normaliseStorage({ loras: [{ name: 'l', size: 1e8, usage_count: 4 }], checkpoints: [{ name: 'c', size: 7e9, usage_count: 0 }] })
    expect(largest(storage, 1)[0].name).toBe('c')
    const scatter = scatterPoints(storage, 100, 50)
    expect(scatter.xMin).toBe(8)
    // log10(1e8) = 8 -> 0; log10(7e9) = 9.845 on an 8..10 axis -> 92.25
    expect(scatter.points.map((p) => p.x)).toEqual([0, 92.25])
    const insights = normaliseInsights({ insights: [{ type: 'warning', key: 'insights.unusedLoras.high', params: { percent: '60.0', count: 6, total: 10 } }, { type: 'odd', key: 'x.y' }] })
    expect(insights[0].description).toBe('60.0% of your LoRAs (6 of 10) have never been used.')
    expect(insights[1].type).toBe('info')
  })
})

// =========================================================================== doctor / backups / archive

const DIAGNOSTICS = {
  success: true,
  app_version: '1.3.0-abc',
  summary: { status: 'warning', issue_count: 2, checked_at: '2026-11-21T10:00:00Z' },
  diagnostics: [
    { id: 'civitai_api_key', title: 'Civitai API Key', status: 'warning', summary: 'No key', details: [], actions: [{ id: 'open-settings', label: 'Open Settings' }] },
    { id: 'cache_health', title: 'Cache', status: 'ok', summary: 'ok', details: [{ model_type: 'lora', label: 'LoRAs', status: 'ok', message: 'Healthy', corruption_rate: '0.0%' }], actions: [{ id: 'repair-cache', label: 'Rebuild Cache' }] },
    { id: 'filename_conflicts', title: 'Duplicates', status: 'warning', summary: '1 filename shared by 2 files', details: [{ conflict_groups: 1, total_conflict_files: 2 }, "'style' found in 2 locations"], actions: [{ id: 'resolve-filename-conflicts', label: 'Resolve' }] },
    { id: 'ui_version', title: 'UI', status: 'ok', summary: 'ok', details: [{ client_version: 'lm-ui', server_version: '1.3.0' }], actions: [] },
  ],
}

describe('doctor', () => {
  it('normalises the report and describes object details', () => {
    const report = normaliseDoctor(DIAGNOSTICS)
    expect(report).toMatchObject({ status: 'warning', issueCount: 2, conflicts: { groups: 1, files: 2 }, appVersion: '1.3.0-abc' })
    expect(report.checks[2].details.map((d) => d.kind)).toEqual(['conflicts', 'text'])
    expect(describeDetail({ model_type: 'lora', label: 'LoRAs', status: 'warning', message: 'Degraded', corruption_rate: '12%' })).toEqual({ kind: 'cache', text: 'LoRAs - Degraded - 12% invalid', status: 'warning' })
    expect(describeDetail({ client_version: 'a', server_version: 'b' }).text).toBe('Page: a / Server: b')
  })

  it('runs read-only, and the rename fix needs a danger confirm with the counts', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('resolve-filename-conflicts')
        ? json({ success: true, count: 1, renamed: [] })
        : url.includes('version-info')
          ? json({ success: true, version: '1.3.0-abc' })
          : json(DIAGNOSTICS),
    )
    const doctor = useDoctor()
    await doctor.run()
    // The page reports the version of the server it was loaded from (ui_version check).
    expect(calls(fetchMock).find((c) => c.url.includes('diagnostics'))).toMatchObject({ url: '/api/lm/doctor/diagnostics?clientVersion=1.3.0-abc', method: 'GET' })

    let confirm = autoConfirm(false)
    expect(await doctor.resolveConflicts()).toBe(false)
    confirm.stop()
    expect(confirm.seen[0]).toMatchObject({ danger: true })
    expect(confirm.seen[0].message).toContain('Renames 2 files in 1 duplicate groups')
    expect(calls(fetchMock).some((c) => c.method === 'POST')).toBe(false)

    confirm = autoConfirm(true)
    expect(await doctor.resolveConflicts()).toBe(true)
    confirm.stop()
    expect(calls(fetchMock).filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['/api/lm/doctor/resolve-filename-conflicts'])
  })

  it('repair cache asks first', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('repair-cache') ? json({ success: true, repaired: [{ label: 'LoRAs' }], failures: [] }) : json(DIAGNOSTICS)))
    const doctor = useDoctor()
    const confirm = autoConfirm(true)
    expect(await doctor.repairCache()).toBe(true)
    confirm.stop()
    expect(confirm.seen[0].message).toContain('not changed')
    expect(calls(fetchMock)[0]).toMatchObject({ url: '/api/lm/doctor/repair-cache', method: 'POST' })
  })

  it('no conflicts: the rename fix does nothing', async () => {
    fetchMock.mockImplementation(async () => json({ ...DIAGNOSTICS, diagnostics: [] }))
    const doctor = useDoctor()
    await doctor.run()
    expect(await doctor.resolveConflicts()).toBe(false)
    expect(calls(fetchMock).some((c) => c.method === 'POST')).toBe(false)
  })

  it('environment and update info', () => {
    const env = normaliseEnvironment({ environment: { app_version: '1.3.0', comfyui_version: null, python_version: '3.13', platform: 'Windows', standalone: false } })
    expect(env.comfyui).toBe('Unavailable')
    expect(environmentMarkdown(env, 'Firefox')).toContain('- Browser: Firefox')
    expect(normaliseUpdate({ success: false, error: 'Network unavailable' }).error).toBe('Network unavailable')
    expect(normaliseUpdate({ success: true, current_version: 'v1', latest_version: 'v2', update_available: true }).available).toBe(true)
  })
})

describe('backups and metadata archive', () => {
  it('normalises the status (newest first) and parses the download name', () => {
    const status = normaliseBackupStatus({
      status: { backupDir: 'C:/s/backups', enabled: true, retentionCount: 5, snapshotCount: 2, latestAutoSnapshot: { name: 'a-auto.zip', size: 3, mtime: 1, is_auto: true } },
      snapshots: [{ name: 'a-auto.zip', size: 3, mtime: 1, is_auto: true }, { name: 'b-manual.zip', size: 4, mtime: 2, is_auto: false }],
    })
    expect(status.snapshots.map((s) => s.name)).toEqual(['b-manual.zip', 'a-auto.zip'])
    expect(status.latestAuto?.auto).toBe(true)
    expect(filenameFromDisposition('attachment; filename="lora-manager-backup-1-manual.zip"', 'x.zip')).toBe('lora-manager-backup-1-manual.zip')
    expect(filenameFromDisposition('attachment; filename="../../evil.zip"', 'x.zip')).toBe('evil.zip')
    expect(filenameFromDisposition(null, 'x.zip')).toBe('x.zip')
  })

  it('restore needs a .zip file and the typed confirm word before anything is sent', async () => {
    expect(validateBackupFile(null)).not.toBeNull()
    expect(validateBackupFile({ name: 'a.json', size: 3 })).not.toBeNull()
    expect(validateBackupFile({ name: 'a.zip', size: 0 })).not.toBeNull()
    expect(validateBackupFile({ name: 'a.ZIP', size: 3 })).toBeNull()
    expect(restoreConfirmed('restore')).toBe(false)
    expect(restoreConfirmed(' RESTORE ')).toBe(true)

    fetchMock.mockImplementation(async (url: string) => (url.includes('import') ? json({ success: true, restored_files: 4 }) : json({ success: true, status: {}, snapshots: [] })))
    const backups = useBackups()
    const file = new File(['zip'], 'b.zip')
    expect(await backups.restore(file, 'yes')).toBe(false)
    expect(calls(fetchMock)).toHaveLength(0)
    expect(await backups.restore(file, 'RESTORE')).toBe(true)
    const post = calls(fetchMock)[0]
    expect(post.url).toBe('/api/lm/backup/import')
    expect([...post.form!.keys()]).toEqual(['archive'])
  })

  it('export downloads the zip; a JSON error becomes a message', async () => {
    const created: string[] = []
    const origCreate = URL.createObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this.download)
    })
    fetchMock.mockImplementationOnce(async () => new Response(new Blob(['PK']), { status: 200, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="lora-manager-backup-2-manual.zip"' } }))
    const backups = useBackups()
    expect(await backups.exportNow()).toBe(true)
    expect(created).toEqual(['lora-manager-backup-2-manual.zip'])
    fetchMock.mockImplementationOnce(async () => json({ success: false, error: 'No backupable files were found' }, 500))
    await expect(backupApi.export()).rejects.toThrow('No backupable files were found')
    click.mockRestore()
    URL.createObjectURL = origCreate
  })

  it('archive download and removal ask first', async () => {
    fetchMock.mockImplementation(async () => json({ success: true, isAvailable: true, isEnabled: true, databaseSize: 10 }))
    const archive = useMetadataArchive()
    let confirm = autoConfirm(false)
    expect(await archive.download()).toBe(false)
    expect(await archive.remove()).toBe(false)
    confirm.stop()
    expect(confirm.seen.map((s) => s.danger)).toEqual([false, true])
    expect(calls(fetchMock)).toHaveLength(0)
    confirm = autoConfirm(true)
    expect(await archive.remove()).toBe(true)
    confirm.stop()
    expect(calls(fetchMock)[0]).toMatchObject({ url: '/api/lm/remove-metadata-archive', method: 'POST' })
    expect(archive.status.value?.available).toBe(true)
  })
})
