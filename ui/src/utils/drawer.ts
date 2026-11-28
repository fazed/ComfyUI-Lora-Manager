/** Pure helpers of the model drawer (ModelDrawer.vue). */

/**
 * Roving-tabindex tab navigation (WAI-ARIA tabs, automatic activation):
 * returns the index to focus and select, or null when the key is not handled.
 */
export function nextTab(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  if (key === 'ArrowRight') return (index + 1) % count
  if (key === 'ArrowLeft') return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** Closing the drawer asks for confirmation only while there are unsaved notes. */
export function shouldConfirmClose(notesDirty: boolean): boolean {
  return notesDirty
}

/** The Civitai version this library file belongs to (item first, then the loaded metadata). */
export function currentVersionId(
  item: { civitai?: { id?: number | null } | null },
  metadata: { id?: number | null } | null | undefined,
): number | null {
  return item.civitai?.id ?? metadata?.id ?? null
}

/** Usage-tip keys the flyout can add (the classic model modal's presets). */
export const USAGE_TIP_KEYS = ['strength_min', 'strength_max', 'strength_range', 'strength', 'clip_strength', 'clip_skip'] as const

/** `usageTipEntries` shows clip strength under one entry key for both spellings. */
const TIP_ALIASES: Record<string, string[]> = { clip: ['clip_strength', 'clipStrength'], clip_strength: ['clip_strength', 'clipStrength'] }

/**
 * The `usage_tips` JSON string with one tip set (numbers stay numbers) or, with
 * `value` null, removed. `key` may be an entry key of `usageTipEntries`.
 */
export function withUsageTip(tips: Record<string, unknown>, key: string, value: string | null): string {
  const next = { ...tips }
  for (const name of TIP_ALIASES[key] ?? [key]) delete next[name]
  const text = value?.trim() ?? ''
  if (value !== null && text) next[key === 'clip' ? 'clip_strength' : key] = Number.isFinite(Number(text)) ? Number(text) : text
  return JSON.stringify(next)
}

/** SHA256 shortened for the info column: first 10 and last 6 characters. */
export function shortHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash
}

export interface VersionFlags {
  /** Released after the version this file belongs to. */
  newer: boolean
  paid: boolean
  /** An early-access window that has ended. */
  freeNow: boolean
}

/** Extra Versions-tab badges, from the version record only. */
export function versionFlags(
  version: { isPaid?: boolean; isEarlyAccess?: boolean; earlyAccessEndsAt?: string | null; releasedAt?: string },
  currentReleasedAt: string | undefined,
  now = Date.now(),
): VersionFlags {
  const released = Date.parse(version.releasedAt ?? '')
  const current = Date.parse(currentReleasedAt ?? '')
  const endsAt = Date.parse(version.earlyAccessEndsAt ?? '')
  return {
    newer: Number.isFinite(released) && Number.isFinite(current) && released > current,
    paid: !!version.isPaid,
    freeNow: !version.isEarlyAccess && !version.isPaid && Number.isFinite(endsAt) && endsAt <= now,
  }
}

export interface LicenceLabel {
  key: 'credit' | 'sellImages' | 'sellModel'
  allowed: boolean
}

/**
 * Licence chips from the Civitai model fields of the metadata; empty when the
 * metadata carries none of them (nothing is assumed).
 */
export function licenceLabels(model: { allowNoCredit?: boolean; allowCommercialUse?: string[] | string } | null | undefined): LicenceLabel[] {
  if (!model || (model.allowNoCredit === undefined && model.allowCommercialUse === undefined)) return []
  const commercial = Array.isArray(model.allowCommercialUse) ? model.allowCommercialUse : model.allowCommercialUse ? [model.allowCommercialUse] : []
  return [
    { key: 'credit', allowed: model.allowNoCredit !== false },
    { key: 'sellImages', allowed: commercial.includes('Image') },
    { key: 'sellModel', allowed: commercial.includes('Sell') },
  ]
}
