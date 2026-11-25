/**
 * Minimal typed HTTP client for the LoRA Manager backend (`/api/lm/...`).
 *
 * - Prefixes every request with the reverse-proxy mount prefix.
 * - Normalises errors: non-2xx responses and `{ success: false, error }`
 *   payloads both throw ApiError with a readable message.
 */

import { withMountPrefix } from '@/utils/basePath'
import { buildQuery, type QueryValue } from '@/utils/query'

export class ApiError extends Error {
  readonly status: number
  readonly payload: unknown

  constructor(message: string, status: number, payload?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  query?: Record<string, QueryValue>
  body?: unknown
  signal?: AbortSignal
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Client id sent on every backend request. The backend rejects cross-site
 * requests to state-changing GET routes unless they carry this header (see
 * "Request guard for state-changing GET routes" in ui/README.md); same-origin
 * requests pass on Sec-Fetch-Site anyway, the header covers browsers and
 * proxies without it.
 */
export const CLIENT_HEADER = 'X-LM-Client'
export const CLIENT_ID = 'lm-ui'

let fetchImpl: FetchLike = (input, init) => fetch(input, init)

/** Test hook: swap the fetch implementation. */
export function setFetch(impl: FetchLike | null): void {
  fetchImpl = impl ?? ((input, init) => fetch(input, init))
}

export function apiUrl(path: string, query?: Record<string, QueryValue>): string {
  const clean = path.replace(/^\/+/, '')
  return withMountPrefix(`/api/lm/${clean}`) + (query ? buildQuery(query) : '')
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    for (const key of ['error', 'message', 'detail']) {
      const value = record[key]
      if (typeof value === 'string' && value) return value
    }
  }
  if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 300)
  return fallback
}

/**
 * POST that answers with a file (backup export, doctor bundle). JSON error
 * bodies become ApiError like `request`.
 */
export async function requestBlob(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<{ blob: Blob; disposition: string | null }> {
  const init: RequestInit = {
    method: options.method ?? 'POST',
    headers: { Accept: 'application/zip, application/json', [CLIENT_HEADER]: CLIENT_ID },
  }
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
  }
  let response: Response
  try {
    response = await fetchImpl(apiUrl(path), init)
  } catch (error) {
    throw new ApiError('Network error: the LoRA Manager backend is not reachable', 0, error)
  }
  const type = response.headers.get('Content-Type') ?? ''
  if (!response.ok || type.includes('application/json')) {
    const text = await response.text()
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
    throw new ApiError(errorMessage(payload, `Request failed (${response.status})`), response.status, payload)
  }
  return { blob: await response.blob(), disposition: response.headers.get('Content-Disposition') }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, signal } = options
  const init: RequestInit = { method, signal, headers: { Accept: 'application/json', [CLIENT_HEADER]: CLIENT_ID } }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    // Multipart: the browser sets the Content-Type with its boundary.
    init.body = body
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
  }

  let response: Response
  try {
    response = await fetchImpl(apiUrl(path, query), init)
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new ApiError('Network error: the LoRA Manager backend is not reachable', 0, error)
  }

  const text = await response.text()
  let payload: unknown = text
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    throw new ApiError(errorMessage(payload, `Request failed (${response.status})`), response.status, payload)
  }
  if (payload && typeof payload === 'object' && (payload as { success?: unknown }).success === false) {
    throw new ApiError(errorMessage(payload, 'The request was rejected'), response.status, payload)
  }
  return payload as T
}
