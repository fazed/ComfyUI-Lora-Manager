/**
 * Ignore / restore on the Updates page. A change is shown at once
 * (`applyIgnoreChanges` over the loaded overview), then stored with
 * `POST updates/ignore-version` or `updates/ignore`; afterwards the overview
 * is re-read and the badge counts are refreshed. A failed request rolls the
 * optimistic change back. Restoring is the same request with
 * `shouldIgnore: false` (the page offers it as Undo and in the Ignored view).
 * Only LoRA Manager's local update database changes; no Civitai request.
 */

import { computed, shallowRef, type Ref } from 'vue'
import { updatesApi } from '@/api/endpoints'
import type { ModelPrefix, UpdatesOverview } from '@/api/types'
import { applyIgnoreChanges, type IgnoreChange } from '@/utils/updates'
import { useUpdatesSummary } from './useUpdates'

export type IgnoreOutcome = { ok: true } | { ok: false; message: string }

export function changeKey(change: Pick<IgnoreChange, 'modelId' | 'versionId'>): string {
  return change.versionId === null ? `m:${change.modelId}` : `v:${change.modelId}:${change.versionId}`
}

export function useUpdateIgnore(options: {
  prefix: Ref<ModelPrefix>
  overview: Ref<UpdatesOverview | null>
  reload: () => Promise<void>
}) {
  const summary = useUpdatesSummary()
  // Shallow: entries are compared by identity when they are dropped.
  const pending = shallowRef<IgnoreChange[]>([])

  /** The overview with the changes that are still being stored. */
  const view = computed(() => applyIgnoreChanges(options.overview.value, pending.value))
  const busy = computed(() => new Set(pending.value.map(changeKey)))

  function isBusy(change: Pick<IgnoreChange, 'modelId' | 'versionId'>): boolean {
    return busy.value.has(changeKey(change))
  }

  function drop(change: IgnoreChange): void {
    pending.value = pending.value.filter((entry) => entry !== change)
  }

  async function apply(change: IgnoreChange): Promise<IgnoreOutcome> {
    if (isBusy(change)) return { ok: false, message: '' }
    const prefix = options.prefix.value
    pending.value = [...pending.value, change]
    try {
      if (change.versionId === null) await updatesApi.ignoreModel(prefix, change.modelId, change.ignore)
      else await updatesApi.ignoreVersion(prefix, change.modelId, change.versionId, change.ignore)
    } catch (err) {
      drop(change)
      return { ok: false, message: (err as Error)?.message || 'Error' }
    }
    try {
      // The stored state replaces the optimistic one; the badge follows.
      if (options.prefix.value === prefix) await options.reload()
    } finally {
      drop(change)
      void summary.refreshLikelyCounts({ force: true })
    }
    return { ok: true }
  }

  return { view, isBusy, apply }
}
