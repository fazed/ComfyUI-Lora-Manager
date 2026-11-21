/**
 * Statistics page (phase B2b): normalisation of the `/api/lm/stats/*`
 * responses and the data transforms of the dependency-free SVG charts.
 * Colors come from the `--lm-color-series-N` tokens (see themes), never from here.
 */

export const SERIES_COUNT = 6

/** Series index -> utility suffix (`series-1` ... `series-6`), cycling. */
export function seriesClass(index: number): string {
  return `series-${(((index % SERIES_COUNT) + SERIES_COUNT) % SERIES_COUNT) + 1}`
}

export interface Overview {
  totalModels: number
  loraCount: number
  checkpointCount: number
  embeddingCount: number
  totalSize: number
  loraSize: number
  checkpointSize: number
  embeddingSize: number
  totalGenerations: number
  unusedLoras: number
  unusedCheckpoints: number
  unusedEmbeddings: number
  modelTypes: Record<string, number>
}

const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const rec = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

export function normaliseOverview(raw: unknown): Overview {
  const data = rec(raw)
  return {
    totalModels: num(data.total_models),
    loraCount: num(data.lora_count),
    checkpointCount: num(data.checkpoint_count),
    embeddingCount: num(data.embedding_count),
    totalSize: num(data.total_size),
    loraSize: num(data.lora_size),
    checkpointSize: num(data.checkpoint_size),
    embeddingSize: num(data.embedding_size),
    totalGenerations: num(data.total_generations),
    unusedLoras: num(data.unused_loras),
    unusedCheckpoints: num(data.unused_checkpoints),
    unusedEmbeddings: num(data.unused_embeddings),
    modelTypes: Object.fromEntries(Object.entries(rec(data.model_types_distribution)).map(([key, value]) => [key, num(value)])),
  }
}

/** Share of models used at least once, 0-100 with one decimal (classic formula). */
export function usageRate(overview: Overview): number {
  if (!overview.totalModels) return 0
  const unused = overview.unusedLoras + overview.unusedCheckpoints + overview.unusedEmbeddings
  return Math.round(((overview.totalModels - unused) / overview.totalModels) * 1000) / 10
}

export function averageUses(overview: Overview): number {
  return overview.totalModels ? Math.round((overview.totalGenerations / overview.totalModels) * 10) / 10 : 0
}

// --------------------------------------------------------------------------- donut

export interface Slice {
  label: string
  value: number
  percent: number
  series: string
  /** SVG arc path (empty for a zero slice). */
  path: string
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

const round = (n: number) => Math.round(n * 100) / 100

/** Ring segment between two angles (degrees, 0 = top, clockwise). */
export function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const sweep = Math.min(end - start, 359.99)
  const stop = start + sweep
  const large = sweep > 180 ? 1 : 0
  const [x1, y1] = polar(cx, cy, outer, start)
  const [x2, y2] = polar(cx, cy, outer, stop)
  const [x3, y3] = polar(cx, cy, inner, stop)
  const [x4, y4] = polar(cx, cy, inner, start)
  return [
    `M${round(x1)} ${round(y1)}`,
    `A${outer} ${outer} 0 ${large} 1 ${round(x2)} ${round(y2)}`,
    `L${round(x3)} ${round(y3)}`,
    `A${inner} ${inner} 0 ${large} 0 ${round(x4)} ${round(y4)}`,
    'Z',
  ].join(' ')
}

/** Donut slices; small slices beyond `maxSlices` are merged into "Other". */
export function donutSlices(entries: [string, number][], options: { maxSlices?: number; size?: number; thickness?: number; otherLabel?: string } = {}): Slice[] {
  const { maxSlices = SERIES_COUNT, size = 160, thickness = 28, otherLabel = 'Other' } = options
  const positive = entries.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])
  let list = positive
  if (positive.length > maxSlices) {
    const head = positive.slice(0, maxSlices - 1)
    const rest = positive.slice(maxSlices - 1).reduce((sum, [, value]) => sum + value, 0)
    list = [...head, [otherLabel, rest]]
  }
  const total = list.reduce((sum, [, value]) => sum + value, 0)
  const c = size / 2
  let angle = 0
  return list.map(([label, value], index) => {
    const sweep = total ? (value / total) * 360 : 0
    const path = sweep > 0 ? arcPath(c, c, c, c - thickness, angle, angle + sweep) : ''
    angle += sweep
    return { label, value, percent: total ? Math.round((value / total) * 1000) / 10 : 0, series: seriesClass(index), path }
  })
}

// --------------------------------------------------------------------------- stacked bars (base models)

export interface StackRow {
  label: string
  total: number
  segments: { series: string; name: string; value: number; widthPercent: number }[]
}

/**
 * One row per base model with a segment per library, rows sorted by total,
 * widths relative to the largest row (so rows are comparable).
 */
export function stackedRows(distribution: Record<string, Record<string, number>>, seriesNames: Record<string, string>, limit = 12): StackRow[] {
  const keys = Object.keys(seriesNames)
  const labels = new Set<string>()
  for (const key of keys) for (const label of Object.keys(rec(distribution[key]))) labels.add(label)
  const rows = [...labels].map((label) => {
    const values = keys.map((key) => num(rec(distribution[key])[label]))
    return { label, values, total: values.reduce((a, b) => a + b, 0) }
  })
  rows.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  const max = rows[0]?.total || 1
  return rows.slice(0, limit).map((row) => ({
    label: row.label,
    total: row.total,
    segments: keys.map((key, index) => ({
      series: seriesClass(index),
      name: seriesNames[key],
      value: row.values[index],
      widthPercent: Math.round((row.values[index] / max) * 10000) / 100,
    })),
  }))
}

// --------------------------------------------------------------------------- line chart (usage timeline)

export interface TimelinePoint {
  date: string
  lora: number
  checkpoint: number
  embedding: number
  total: number
}

export function normaliseTimeline(raw: unknown): TimelinePoint[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const item = rec(entry)
    return {
      date: String(item.date ?? ''),
      lora: num(item.lora_usage),
      checkpoint: num(item.checkpoint_usage),
      embedding: num(item.embedding_usage),
      total: num(item.total_usage),
    }
  })
}

/** "Nice" axis maximum and ticks (0 .. max). */
export function niceTicks(maxValue: number, count = 4): number[] {
  if (maxValue <= 0) return [0, 1]
  const rough = maxValue / count
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power
  const ticks: number[] = []
  for (let value = 0; value <= maxValue + step * 0.999; value += step) ticks.push(Math.round(value * 1000) / 1000)
  return ticks
}

export interface LineSeries {
  name: string
  series: string
  path: string
  points: { x: number; y: number; value: number }[]
}

export function linePaths(
  points: TimelinePoint[],
  keys: { key: 'lora' | 'checkpoint' | 'embedding' | 'total'; name: string }[],
  width: number,
  height: number,
): { series: LineSeries[]; ticks: number[]; max: number } {
  const max = Math.max(0, ...points.flatMap((point) => keys.map(({ key }) => point[key])))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const stepX = points.length > 1 ? width / (points.length - 1) : 0
  const series = keys.map(({ key, name }, index) => {
    const coords = points.map((point, i) => ({ x: round(i * stepX), y: round(height - (point[key] / top) * height), value: point[key] }))
    const path = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x} ${c.y}`).join(' ')
    return { name, series: seriesClass(index), path, points: coords }
  })
  return { series, ticks, max: top }
}

// --------------------------------------------------------------------------- usage lists, tags, storage

export interface UsageItem {
  name: string
  usageCount: number
  baseModel: string
  previewUrl: string
  folder: string
  type?: string
}

export function normaliseUsageItems(raw: unknown, type?: string): UsageItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const item = rec(entry)
    return {
      name: String(item.name ?? ''),
      usageCount: num(item.usage_count),
      baseModel: String(item.base_model ?? 'Unknown'),
      previewUrl: String(item.preview_url ?? ''),
      folder: String(item.folder ?? ''),
      ...(type ? { type } : {}),
    }
  })
}

/** Top N used across all three libraries (classic "usage distribution" chart). */
export function topUsedAcross(lists: Record<string, UsageItem[]>, limit = 10): UsageItem[] {
  return Object.entries(lists)
    .flatMap(([type, items]) => items.map((item) => ({ ...item, type })))
    .filter((item) => item.usageCount > 0)
    .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Bar width in percent of the largest value. */
export function barPercent(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 1000) / 10)) : 0
}

export interface TagWeight {
  tag: string
  count: number
  /** 1-5 (classic size classes). */
  weight: number
}

export function tagCloud(raw: unknown, limit = 30): TagWeight[] {
  const list = Array.isArray(raw) ? raw.map(rec).map((t) => ({ tag: String(t.tag ?? ''), count: num(t.count) })).filter((t) => t.tag) : []
  const top = list.slice(0, limit)
  const max = Math.max(1, ...top.map((t) => t.count))
  return top.map((t) => ({ ...t, weight: Math.max(1, Math.ceil((t.count / max) * 5)) }))
}

export interface StorageItem {
  name: string
  size: number
  usageCount: number
  folder: string
  baseModel: string
  type: string
}

export function normaliseStorage(raw: unknown): StorageItem[] {
  const data = rec(raw)
  return (['loras', 'checkpoints', 'embeddings'] as const).flatMap((type) =>
    (Array.isArray(data[type]) ? (data[type] as unknown[]) : []).map((entry) => {
      const item = rec(entry)
      return {
        name: String(item.name ?? ''),
        size: num(item.size),
        usageCount: num(item.usage_count),
        folder: String(item.folder ?? ''),
        baseModel: String(item.base_model ?? ''),
        type,
      }
    }),
  )
}

export function largest(items: StorageItem[], limit = 10): StorageItem[] {
  return [...items].sort((a, b) => b.size - a.size).slice(0, limit)
}

/** Scatter: x = log10(size) scaled into [0, width], y = usage scaled into [height, 0]. */
export function scatterPoints(items: StorageItem[], width: number, height: number) {
  const sized = items.filter((item) => item.size > 0)
  if (!sized.length) return { points: [], xMin: 0, xMax: 0, yMax: 0 }
  const logs = sized.map((item) => Math.log10(item.size))
  const xMin = Math.floor(Math.min(...logs))
  const xMax = Math.max(xMin + 1, Math.ceil(Math.max(...logs)))
  const yTicks = niceTicks(Math.max(...sized.map((item) => item.usageCount)))
  const yMax = yTicks[yTicks.length - 1] || 1
  return {
    points: sized.map((item, i) => ({
      item,
      x: round(((logs[i] - xMin) / (xMax - xMin)) * width),
      y: round(height - (item.usageCount / yMax) * height),
      series: seriesClass(['loras', 'checkpoints', 'embeddings'].indexOf(item.type)),
    })),
    xMin,
    xMax,
    yMax,
  }
}

// --------------------------------------------------------------------------- insights

export interface Insight {
  type: 'warning' | 'info' | 'success'
  title: string
  description: string
  suggestion: string
}

const INSIGHT_TEXT: Record<string, (p: Record<string, string>) => Omit<Insight, 'type'>> = {
  'insights.unusedLoras.high': (p) => ({
    title: 'Many unused LoRAs',
    description: `${p.percent}% of your LoRAs (${p.count} of ${p.total}) have never been used.`,
    suggestion: 'Consider archiving or removing LoRAs you no longer need.',
  }),
  'insights.unusedCheckpoints.detected': (p) => ({
    title: 'Unused checkpoints',
    description: `${p.percent}% of your checkpoints (${p.count} of ${p.total}) have never been used.`,
    suggestion: 'Checkpoints are large: removing unused ones frees the most space.',
  }),
  'insights.unusedEmbeddings.high': (p) => ({
    title: 'Many unused embeddings',
    description: `${p.percent}% of your embeddings (${p.count} of ${p.total}) have never been used.`,
    suggestion: 'Consider cleaning up embeddings you no longer use.',
  }),
  'insights.collection.large': (p) => ({
    title: 'Large collection',
    description: `Your model collection uses ${p.size}.`,
    suggestion: 'Check the Storage tab for the largest and least used models.',
  }),
  'insights.activity.active': (p) => ({
    title: 'Active user',
    description: `You have run ${p.count} generations with LoRA Manager.`,
    suggestion: 'The Usage tab shows which models you rely on most.',
  }),
}

export function normaliseInsights(raw: unknown): Insight[] {
  const list = Array.isArray(rec(raw).insights) ? (rec(raw).insights as unknown[]) : Array.isArray(raw) ? raw : []
  return list.map(rec).map((entry) => {
    const type = entry.type === 'warning' || entry.type === 'success' ? entry.type : 'info'
    const key = String(entry.key ?? '')
    const params = Object.fromEntries(Object.entries(rec(entry.params)).map(([k, v]) => [k, String(v)]))
    const text = INSIGHT_TEXT[key]?.(params) ?? { title: String(entry.title ?? key), description: String(entry.description ?? ''), suggestion: String(entry.suggestion ?? '') }
    return { type, ...text }
  })
}

export function shortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return match ? `${Number(match[3])}/${Number(match[2])}` : iso
}
