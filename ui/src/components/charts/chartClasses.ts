/**
 * Literal Tailwind classes per chart series (Tailwind only generates classes
 * it can see spelled out). Colors come from --lm-color-series-N.
 */
export const SERIES_CLASSES: Record<string, { fill: string; stroke: string; bg: string; text: string }> = {
  'series-1': { fill: 'fill-series-1', stroke: 'stroke-series-1', bg: 'bg-series-1', text: 'text-series-1' },
  'series-2': { fill: 'fill-series-2', stroke: 'stroke-series-2', bg: 'bg-series-2', text: 'text-series-2' },
  'series-3': { fill: 'fill-series-3', stroke: 'stroke-series-3', bg: 'bg-series-3', text: 'text-series-3' },
  'series-4': { fill: 'fill-series-4', stroke: 'stroke-series-4', bg: 'bg-series-4', text: 'text-series-4' },
  'series-5': { fill: 'fill-series-5', stroke: 'stroke-series-5', bg: 'bg-series-5', text: 'text-series-5' },
  'series-6': { fill: 'fill-series-6', stroke: 'stroke-series-6', bg: 'bg-series-6', text: 'text-series-6' },
}

export const seriesFill = (series: string) => SERIES_CLASSES[series]?.fill ?? 'fill-series-1'
export const seriesStroke = (series: string) => SERIES_CLASSES[series]?.stroke ?? 'stroke-series-1'
export const seriesBg = (series: string) => SERIES_CLASSES[series]?.bg ?? 'bg-series-1'
