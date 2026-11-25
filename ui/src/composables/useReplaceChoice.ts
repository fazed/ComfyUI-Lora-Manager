/**
 * "Replace or keep" prompt shown before an update is queued (Updates page
 * single Update, drawer Queue download). App-wide, promise based, like the
 * confirm dialog: `ask()` resolves with the user's decision, or `null` for
 * Cancel. `ReplaceChoiceDialog` (mounted once in App.vue) renders it.
 *
 * Only "Keep both" can be remembered ("Don't ask again"); "Replace" is never
 * remembered, so a delete always needs an explicit choice. The remembered
 * choice is a plain boolean in localStorage and can be reset from the dialog's
 * Updates page notice (`resetAlwaysKeep`).
 */

import { computed, shallowRef } from 'vue'
import { useStorage } from '@vueuse/core'
import { defaultReplaceSelection, type OwnedFile, type ReplaceDecision } from '@/utils/versionManagement'

export const ALWAYS_KEEP_KEY = 'lm-ui.updates.alwaysKeepBoth'

export interface ReplaceRequest {
  modelName: string
  /** The version being downloaded. */
  versionName: string
  /** Owned files of the same model line (newest first). */
  files: OwnedFile[]
}

interface PendingChoice extends ReplaceRequest {
  /** Preselected paths (the newest owned file only). */
  initial: string[]
  resolve: (decision: ReplaceDecision | null) => void
}

const pending = shallowRef<PendingChoice | null>(null)
// One shared ref for the whole app (useStorage keeps instances with the same key in sync anyway).
let alwaysKeepRef: ReturnType<typeof useStorage<boolean>> | null = null

function alwaysKeepStore() {
  if (!alwaysKeepRef) alwaysKeepRef = useStorage<boolean>(ALWAYS_KEEP_KEY, false, undefined, { writeDefaults: false })
  return alwaysKeepRef
}

export function useReplaceChoice() {
  const alwaysKeep = alwaysKeepStore()

  /**
   * Ask how to treat the owned files of the line. Without owned files, or
   * with "always keep both" remembered, it resolves at once with Keep.
   */
  function ask(request: ReplaceRequest): Promise<ReplaceDecision | null> {
    if (!request.files.length || alwaysKeep.value) return Promise.resolve({ mode: 'keep' })
    pending.value?.resolve(null)
    return new Promise((resolve) => {
      pending.value = {
        ...request,
        initial: defaultReplaceSelection(request.files),
        resolve: (decision) => {
          pending.value = null
          resolve(decision)
        },
      }
    })
  }

  /** Called by the dialog. `remember` only applies to Keep both. */
  function answer(decision: ReplaceDecision | null, remember = false): void {
    if (decision?.mode === 'keep' && remember) alwaysKeep.value = true
    pending.value?.resolve(decision)
  }

  function resetAlwaysKeep(): void {
    alwaysKeep.value = false
  }

  return {
    pending,
    ask,
    answer,
    alwaysKeep: computed(() => alwaysKeep.value === true),
    resetAlwaysKeep,
  }
}

/** Test hook. */
export function resetReplaceChoiceForTesting(): void {
  pending.value?.resolve(null)
  pending.value = null
  alwaysKeepRef = null
}
