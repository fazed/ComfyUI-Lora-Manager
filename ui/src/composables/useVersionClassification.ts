/**
 * The Updates classification for the drawer's Versions tab: the read-only
 * overview of the drawer's model type is read once per drawer (GET, no
 * Civitai, no scan) and looked up per model / version. Failures are silent: an
 * older backend without the endpoint simply shows no chip.
 */

import { computed, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'
import { updatesApi } from '@/api/endpoints'
import type { ModelPrefix, UpdatesOverview } from '@/api/types'
import { isUpdatePrefix, versionClassification } from '@/utils/updates'

export function useVersionClassification(prefix: MaybeRefOrGetter<ModelPrefix>, modelId: MaybeRefOrGetter<number | null | undefined>) {
  const overview = shallowRef<UpdatesOverview | null>(null)
  let requested: ModelPrefix | null = null

  /** Read the overview of the type (once per drawer, and again only for another type). */
  function ensure(): void {
    const type = toValue(prefix)
    if (requested === type || !isUpdatePrefix(type)) return
    requested = type
    overview.value = null
    updatesApi
      .overview(type)
      .then((data) => {
        if (requested === type) overview.value = data
      })
      .catch(() => {
        // No chip.
      })
  }

  const byVersion = computed(() => versionClassification(overview.value, toValue(modelId)))
  return { ensure, byVersion }
}
