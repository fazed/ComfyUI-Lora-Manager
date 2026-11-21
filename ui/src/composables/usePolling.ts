/**
 * Visibility-aware polling: runs `task` every `intervalMs` only while the
 * document is visible, never overlaps runs, and stops when the owning
 * component unmounts.
 */

import { getCurrentInstance, onBeforeUnmount, onMounted, ref, unref, type Ref } from 'vue'

export interface PollingOptions {
  /** Start automatically on mount (default true). */
  immediate?: boolean
}

export function createPoller(task: () => Promise<unknown> | unknown, intervalMs: number | Ref<number>) {
  const running = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let active = false
  let inFlight = false

  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

  function schedule(delay = unref(intervalMs)): void {
    if (timer) clearTimeout(timer)
    timer = null
    if (!active || !visible()) return
    timer = setTimeout(tick, delay)
  }

  async function tick(): Promise<void> {
    timer = null
    if (!active || !visible() || inFlight) return
    inFlight = true
    try {
      await task()
    } catch {
      /* the task reports its own errors */
    } finally {
      inFlight = false
      schedule()
    }
  }

  function onVisibility(): void {
    if (visible()) schedule(0)
    else if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function start(): void {
    if (active) return
    active = true
    running.value = true
    document.addEventListener('visibilitychange', onVisibility)
    schedule(0)
  }

  function stop(): void {
    active = false
    running.value = false
    if (timer) clearTimeout(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisibility)
  }

  /** Run now (e.g. right after a user action), then continue the cadence. */
  function trigger(): void {
    if (active) schedule(0)
    else void task()
  }

  return { start, stop, trigger, running }
}

export function usePolling(
  task: () => Promise<unknown> | unknown,
  intervalMs: number | Ref<number>,
  options: PollingOptions = {},
) {
  const poller = createPoller(task, intervalMs)
  if (getCurrentInstance()) {
    onMounted(() => {
      if (options.immediate !== false) poller.start()
    })
    onBeforeUnmount(() => poller.stop())
  }
  return poller
}
