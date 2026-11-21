/** Civitai URL / id parsing for the "add download" form. */

export interface CivitaiTarget {
  modelId: number | null
  versionId: number | null
}

const POSITIVE_INT = /^\d{1,12}$/

/**
 * Accepts a Civitai model URL (any civitai host, e.g. civitai.com or
 * civitai.red), "models/123?modelVersionId=456", an "api/download/models/456"
 * URL, a "model-versions/456" URL (web or api/v1), or a bare numeric model
 * id. Returns null when nothing usable is found.
 */
export function parseCivitaiInput(input: string): CivitaiTarget | null {
  const value = input.trim()
  if (!value) return null
  if (POSITIVE_INT.test(value)) return { modelId: Number(value), versionId: null }

  let url: URL
  try {
    url = new URL(value.includes('://') ? value : `https://civitai.com/${value.replace(/^\/+/, '')}`)
  } catch {
    return null
  }
  if (!/(^|\.)civitai\.[a-z]+$/i.test(url.hostname)) return null

  const downloadMatch = url.pathname.match(/\/api\/download\/models\/(\d+)/)
  if (downloadMatch) return { modelId: null, versionId: Number(downloadMatch[1]) }
  const versionPathMatch = url.pathname.match(/\/model-versions\/(\d+)/)
  if (versionPathMatch) return { modelId: null, versionId: Number(versionPathMatch[1]) }

  const versionParam = url.searchParams.get('modelVersionId')
  const versionId = versionParam && POSITIVE_INT.test(versionParam) ? Number(versionParam) : null
  const modelMatch = url.pathname.match(/\/models\/(\d+)/)
  if (modelMatch) return { modelId: Number(modelMatch[1]), versionId }
  return null
}
