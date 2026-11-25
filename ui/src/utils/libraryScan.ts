/**
 * The library rescan that runs before the main Refresh of the browse pages
 * (LoRAs, Checkpoints, Embeddings, Recipes). Pure flow with injected calls,
 * so it is tested without a backend.
 *
 * 1. Ask the scanner state first (`GET /api/lm/init-status?page=`): a scan
 *    that is already running (`initializing`; another tab, the classic UI or
 *    the startup scan) or a library that was never scanned is left alone and
 *    the page only reloads, without waiting for that scan.
 * 2. Run the quick scan and read its counts (models only; recipes answer none).
 *    The backend guards scans per model type: a request that overlaps an
 *    identical scan joins it and answers the same counts (`joined: true`),
 *    which count like a scan of our own. A 409 (not sent by the current
 *    backend) still means "already running".
 */

import { ApiError } from '@/api/http'

export interface ScanDeps {
  initStatus: () => Promise<{ status?: string }>
  scan: () => Promise<{ status?: string; added?: number; removed?: number; joined?: boolean }>
}

export type ScanOutcome =
  /** Scan finished; counts are null when the answer had none. */
  | { kind: 'scanned'; added: number | null; removed: number | null }
  /** Another scan is running on the server. */
  | { kind: 'busy' }
  /** The scanner is not ready (first scan not confirmed yet, or it failed). */
  | { kind: 'not-ready' }
  /** The scan request failed; the page still reloads. */
  | { kind: 'failed'; message: string }

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

export async function runLibraryScan(deps: ScanDeps): Promise<ScanOutcome> {
  // A failing status request (backend not reachable) rejects: the refresh reports it.
  const state = (await deps.initStatus())?.status
  if (state === 'initializing') return { kind: 'busy' }
  if (state !== 'complete') return { kind: 'not-ready' }
  try {
    const result = await deps.scan()
    if (result?.status === 'cancelled') return { kind: 'scanned', added: null, removed: null }
    return { kind: 'scanned', added: count(result?.added), removed: count(result?.removed) }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return { kind: 'busy' }
    return { kind: 'failed', message: (error as Error)?.message || 'Request failed' }
  }
}

export type ScanNotice = { kind: 'info' | 'error'; key: 'refresh.scanChanges' | 'refresh.scanBusy' | 'refresh.scanNotReady' | 'refresh.scanFailed'; params?: Record<string, string> }

/**
 * Toast for a scan outcome, or null: a summary only when the scan reported
 * changes ("2 new, 1 removed"), a note when it was skipped, the error when it
 * failed.
 */
export function scanNotice(outcome: ScanOutcome, parts: { added: (n: number) => string; removed: (n: number) => string }): ScanNotice | null {
  if (outcome.kind === 'busy') return { kind: 'info', key: 'refresh.scanBusy' }
  if (outcome.kind === 'not-ready') return { kind: 'info', key: 'refresh.scanNotReady' }
  if (outcome.kind === 'failed') return { kind: 'error', key: 'refresh.scanFailed', params: { message: outcome.message } }
  const changes = [
    outcome.added ? parts.added(outcome.added) : '',
    outcome.removed ? parts.removed(outcome.removed) : '',
  ].filter(Boolean)
  return changes.length ? { kind: 'info', key: 'refresh.scanChanges', params: { changes: changes.join(', ') } } : null
}
