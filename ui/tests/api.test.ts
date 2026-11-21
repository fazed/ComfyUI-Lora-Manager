import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiUrl, request, setFetch } from '@/api/http'
import { createModelApi, downloadsApi, modelListParams } from '@/api/endpoints'
import { setBasePathsForTesting } from '@/utils/basePath'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('http client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    setBasePathsForTesting({ appBase: 'http://host/comfy/lm-ui/', appPath: '/comfy/lm-ui/', mountPrefix: '/comfy' })
    fetchMock.mockReset()
    setFetch(fetchMock)
  })

  afterEach(() => {
    setFetch(null)
    setBasePathsForTesting(null)
  })

  it('builds prefixed API URLs with repeated query keys', () => {
    expect(apiUrl('loras/list', { page: 1, base_model: ['A', 'B'], empty: '' })).toBe(
      '/comfy/api/lm/loras/list?page=1&base_model=A&base_model=B',
    )
  })

  it('returns parsed JSON on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, value: 3 }))
    await expect(request('settings')).resolves.toEqual({ success: true, value: 3 })
    expect(fetchMock).toHaveBeenCalledWith('/comfy/api/lm/settings', expect.objectContaining({ method: 'GET' }))
  })

  it('sends JSON bodies for POST', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }))
    await request('settings', { method: 'POST', body: { a: 1 } })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('throws ApiError with the backend message on success:false', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'nope' }))
    await expect(request('x')).rejects.toMatchObject({ name: 'ApiError', message: 'nope', status: 200 })
  })

  it('throws ApiError for HTTP errors, including plain-text bodies', async () => {
    fetchMock.mockResolvedValue(new Response('File path is required', { status: 400 }))
    const error = await request('x').catch((err: unknown) => err)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).message).toBe('File path is required')
  })

  it('maps network failures to a readable ApiError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(request('x')).rejects.toMatchObject({ status: 0 })
  })

  it('re-throws aborts untouched', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    fetchMock.mockRejectedValue(abort)
    await expect(request('x')).rejects.toBe(abort)
  })

  it('model api hits the prefixed endpoints', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, tree: { A: {} } }))
    const api = createModelApi('checkpoints')
    await expect(api.folderTree()).resolves.toEqual({ A: {} })
    expect(fetchMock.mock.calls[0][0]).toBe('/comfy/api/lm/checkpoints/unified-folder-tree?include_empty=true')

    fetchMock.mockResolvedValue(jsonResponse({ success: true }))
    await api.saveMetadata('C:/m.safetensors', { notes: 'hi' })
    const init = fetchMock.mock.calls[1][1] as RequestInit
    expect(fetchMock.mock.calls[1][0]).toBe('/comfy/api/lm/checkpoints/save-metadata')
    expect(JSON.parse(String(init.body))).toEqual({ file_path: 'C:/m.safetensors', notes: 'hi' })
  })

  it('download queue actions are GET requests with download_id', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ success: true }))
    await downloadsApi.moveToTop('abc')
    expect(fetchMock.mock.calls[0][0]).toBe('/comfy/api/lm/downloads/queue/move-to-top?download_id=abc')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET')

    await downloadsApi.add({ modelId: 12, versionId: null })
    expect(fetchMock.mock.calls[1][0]).toBe('/comfy/api/lm/downloads/queue/add?model_id=12&source=civitai')
  })
})

describe('modelListParams', () => {
  it('maps the query to backend parameter names', () => {
    expect(
      modelListParams({
        page: 2,
        pageSize: 60,
        sortBy: 'name:asc',
        search: '  anime ',
        folder: 'Anima/style',
        baseModels: ['Illustrious'],
        tags: ['style'],
        favoritesOnly: true,
        updateAvailableOnly: false,
      }),
    ).toEqual({
      page: 2,
      page_size: 60,
      sort_by: 'name:asc',
      search: 'anime',
      folder: 'Anima/style',
      recursive: 'true',
      base_model: ['Illustrious'],
      tag_include: ['style'],
      favorites_only: 'true',
      update_available_only: undefined,
    })
  })

  it('omits empty filters', () => {
    const params = modelListParams({ page: 1, pageSize: 20, search: '   ' })
    expect(params.search).toBeUndefined()
    expect(params.folder).toBeUndefined()
    expect(params.recursive).toBeUndefined()
  })
})
