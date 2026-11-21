/** Pure formatting helpers. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '-'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(digits)} ${UNITS[unit]}`
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return ''
  return `${formatBytes(bytesPerSecond)}/s`
}

/** Accepts unix seconds, unix milliseconds or an ISO string. */
export function toDate(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value: number | string | null | undefined): string {
  const date = toDate(value)
  return date ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '-'
}

export function formatDateTime(value: number | string | null | undefined): string {
  const date = toDate(value)
  return date ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-'
}

/**
 * Progress in percent (0-100). Prefers byte counters when both are known,
 * otherwise uses the explicit progress value (0-100).
 */
export function progressPercent(
  progress: number | null | undefined,
  done?: number | null,
  total?: number | null,
): number {
  let pct: number
  if (done && total && total > 0) pct = (done / total) * 100
  else if (typeof progress === 'number' && Number.isFinite(progress)) pct = progress
  else return 0
  return Math.max(0, Math.min(100, pct))
}

const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i

export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url, 'http://local.invalid')
    if (VIDEO_RE.test(parsed.pathname)) return true
    const inner = parsed.searchParams.get('path')
    return inner ? VIDEO_RE.test(inner) : false
  } catch {
    return VIDEO_RE.test(url)
  }
}
