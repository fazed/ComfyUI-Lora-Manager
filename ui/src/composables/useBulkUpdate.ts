/**
 * Bulk update on the Updates page: the selection of rows, and queueing the
 * selected updates one by one (`downloads/queue/add` through the page's
 * `queueUpdate`, so every item gets the same destination as a single Update).
 *
 * Like the batch download dialog it never runs two adds at once and never
 * starts a second run while one is going. A per-item error (bad version,
 * backend 400/500) is recorded and the run continues; an error that would hit
 * every following item too (403 request guard, offline, 429) stops the run
 * when `stopOnHardError` is on (default). Added and duplicate rows leave the
 * selection, failed and unsent ones stay selected so "Update selected" retries
 * them.
 */

import { computed, ref, shallowRef, type Ref } from 'vue'
import type { UpdateCandidate, UpdateGroup } from '@/api/types'
import type { QueueOutcome } from './useUpdates'
import { hardErrorOf, type BulkItem, type BulkResult } from '@/utils/updates'

export interface BulkUpdateDeps {
  /** Rows that may be ticked right now, by row key (enabled Update action). */
  selectable: () => Map<string, BulkItem>
  queueUpdate: (
    group: UpdateGroup,
    candidate: UpdateCandidate,
    options: { refreshQueue?: boolean; replacePaths?: string[] },
  ) => Promise<QueueOutcome>
  /** Called once after the run (re-read the shared queue). */
  afterRun?: () => Promise<unknown> | void
}

export function useBulkUpdate(deps: BulkUpdateDeps) {
  const picked = ref<Set<string>>(new Set())
  const submitting = ref(false)
  const progress = ref({ done: 0, total: 0 })
  const result = shallowRef<BulkResult | null>(null)
  const stopOnHardError = ref(true)

  /** The selection that still applies: rows that left the list or got queued drop out by themselves. */
  const selected: Ref<BulkItem[]> = computed(() => {
    const available = deps.selectable()
    return [...picked.value].map((key) => available.get(key)).filter((item): item is BulkItem => !!item)
  })
  const selectedKeys = computed(() => new Set(selected.value.map((item) => item.key)))

  function isSelected(key: string): boolean {
    return selectedKeys.value.has(key)
  }

  function toggle(key: string, value = !isSelected(key)): void {
    if (submitting.value) return
    const next = new Set(picked.value)
    if (value && deps.selectable().has(key)) next.add(key)
    else next.delete(key)
    picked.value = next
  }

  /** Replace the selection with these keys (only selectable ones are kept). */
  function selectOnly(keys: string[]): void {
    if (submitting.value) return
    const available = deps.selectable()
    picked.value = new Set(keys.filter((key) => available.has(key)))
  }

  function clear(): void {
    if (submitting.value) return
    picked.value = new Set()
  }

  function dismissResult(): void {
    result.value = null
  }

  /** Queue the given items sequentially (the page confirms first). Null when a run is going or nothing is given. */
  async function run(items: BulkItem[]): Promise<BulkResult | null> {
    if (submitting.value || !items.length) return null
    submitting.value = true
    result.value = null
    progress.value = { done: 0, total: items.length }
    const outcome: BulkResult = { added: [], duplicates: [], failed: [], notSent: [], stopped: null }
    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        const answer = await deps.queueUpdate(item.group, item.candidate, { refreshQueue: false, replacePaths: item.replacePaths })
        if (answer.kind === 'queued') outcome.added.push(item)
        else if (answer.kind === 'duplicate') outcome.duplicates.push(item)
        else {
          outcome.failed.push({ item, message: answer.message })
          const hard = hardErrorOf(answer.status)
          if (hard && stopOnHardError.value) {
            outcome.stopped = hard
            outcome.notSent = items.slice(index + 1)
            progress.value = { done: index + 1, total: items.length }
            break
          }
        }
        progress.value = { done: index + 1, total: items.length }
      }
      const done = new Set([...outcome.added, ...outcome.duplicates].map((item) => item.key))
      picked.value = new Set([...picked.value].filter((key) => !done.has(key)))
      result.value = outcome
      try {
        await deps.afterRun?.()
      } catch {
        // The queue poll catches up on its own.
      }
      return outcome
    } finally {
      submitting.value = false
    }
  }

  return {
    selected,
    isSelected,
    toggle,
    selectOnly,
    clear,
    submitting,
    progress,
    result,
    dismissResult,
    stopOnHardError,
    run,
  }
}
