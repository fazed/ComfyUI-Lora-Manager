import { describe, expect, it } from 'vitest'
import { computeBasePaths, withMountPrefix } from '@/utils/basePath'
import { parseCivitaiInput } from '@/utils/civitai'
import { formatBytes, formatSpeed, isVideoUrl, progressPercent, toDate } from '@/utils/format'
import { buildQuery } from '@/utils/query'
import { sanitizeHtml } from '@/utils/sanitize'

describe('computeBasePaths', () => {
  it('uses the injected <base> (no prefix)', () => {
    expect(computeBasePaths('http://h:8188/lm-ui/', true)).toEqual({
      appBase: 'http://h:8188/lm-ui/',
      appPath: '/lm-ui/',
      mountPrefix: '',
    })
  })

  it('keeps a reverse-proxy prefix', () => {
    expect(computeBasePaths('http://h/comfy/lm-ui/', true).mountPrefix).toBe('/comfy')
    expect(computeBasePaths('http://h/a/b/lm-ui/', true).appPath).toBe('/a/b/lm-ui/')
  })

  it('falls back to the dev base without a <base> element', () => {
    expect(computeBasePaths('http://localhost:5174/lm-ui/loras/x', false, '/lm-ui/')).toEqual({
      appBase: 'http://localhost:5174/lm-ui/',
      appPath: '/lm-ui/',
      mountPrefix: '',
    })
  })
})

describe('withMountPrefix', () => {
  it('prefixes root-absolute URLs once', () => {
    expect(withMountPrefix('/api/lm/previews?path=x', '/comfy')).toBe('/comfy/api/lm/previews?path=x')
    expect(withMountPrefix('/comfy/api/lm/x', '/comfy')).toBe('/comfy/api/lm/x')
    expect(withMountPrefix('/api/lm/x', '')).toBe('/api/lm/x')
  })

  it('leaves absolute and protocol-relative URLs alone', () => {
    expect(withMountPrefix('https://image.civitai.com/a.jpg', '/comfy')).toBe('https://image.civitai.com/a.jpg')
    expect(withMountPrefix('//cdn/x', '/comfy')).toBe('//cdn/x')
    expect(withMountPrefix('', '/comfy')).toBe('')
  })
})

describe('format helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(91875056)).toBe('87.6 MB')
    expect(formatBytes(null)).toBe('-')
    expect(formatBytes(-1)).toBe('-')
  })

  it('formats speed', () => {
    expect(formatSpeed(2048)).toBe('2.0 KB/s')
    expect(formatSpeed(0)).toBe('')
  })

  it('parses seconds, milliseconds and ISO dates', () => {
    expect(toDate(1700000000)?.getTime()).toBe(1700000000000)
    expect(toDate(1700000000000)?.getTime()).toBe(1700000000000)
    expect(toDate('2026-06-02T15:48:04.978Z')?.toISOString()).toBe('2026-06-02T15:48:04.978Z')
    expect(toDate('garbage')).toBeNull()
    expect(toDate(null)).toBeNull()
  })

  it('computes progress from bytes or percent', () => {
    expect(progressPercent(null, 50, 200)).toBe(25)
    expect(progressPercent(42)).toBe(42)
    expect(progressPercent(140)).toBe(100)
    expect(progressPercent(undefined)).toBe(0)
  })

  it('detects video previews, including the preview endpoint path param', () => {
    expect(isVideoUrl('/api/lm/previews?path=G%3A%2Fa%2Fb.mp4&v=1')).toBe(true)
    expect(isVideoUrl('/api/lm/previews?path=G%3A%2Fa%2Fb.jpeg')).toBe(false)
    expect(isVideoUrl('https://x/clip.webm')).toBe(true)
    expect(isVideoUrl(undefined)).toBe(false)
  })
})

describe('parseCivitaiInput', () => {
  it('accepts bare ids', () => {
    expect(parseCivitaiInput(' 2670968 ')).toEqual({ modelId: 2670968, versionId: null })
  })

  it('accepts model URLs on any civitai host', () => {
    expect(parseCivitaiInput('https://civitai.com/models/2670968/some-name?modelVersionId=2999153')).toEqual({
      modelId: 2670968,
      versionId: 2999153,
    })
    expect(parseCivitaiInput('https://civitai.red/models/12')).toEqual({ modelId: 12, versionId: null })
    expect(parseCivitaiInput('civitai.com/models/5')).toEqual({ modelId: 5, versionId: null })
  })

  it('accepts download URLs as version ids', () => {
    expect(parseCivitaiInput('https://civitai.com/api/download/models/777')).toEqual({ modelId: null, versionId: 777 })
  })

  it('rejects other hosts and junk', () => {
    expect(parseCivitaiInput('https://example.com/models/1')).toBeNull()
    expect(parseCivitaiInput('hello world')).toBeNull()
    expect(parseCivitaiInput('')).toBeNull()
  })
})

describe('buildQuery', () => {
  it('skips empty values and repeats arrays', () => {
    expect(buildQuery({ a: 1, b: null, c: undefined, d: '', e: ['x', 'y'], f: false })).toBe('?a=1&e=x&e=y&f=false')
    expect(buildQuery({})).toBe('')
  })
})

describe('sanitizeHtml', () => {
  it('keeps formatting but drops scripts, handlers and styles', () => {
    const html = sanitizeHtml(
      '<p style="color:red" onclick="x()">Hi <strong>there</strong><script>alert(1)</script></p><img src=x onerror=alert(1)>',
    )
    expect(html).toBe('<p>Hi <strong>there</strong></p>')
  })

  it('keeps only http(s) links and hardens them', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="https://civitai.com">c</a>')).toBe(
      '<a href="https://civitai.com" target="_blank" rel="noopener noreferrer">c</a>',
    )
  })

  it('unwraps unknown tags', () => {
    expect(sanitizeHtml('<custom><em>ok</em></custom>')).toBe('<em>ok</em>')
    expect(sanitizeHtml(null)).toBe('')
  })
})
