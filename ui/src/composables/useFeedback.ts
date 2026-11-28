/** App-wide toasts and a promise-based confirm dialog. */

import { ref } from 'vue'
import { t } from '@/i18n'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
}

const toasts = ref<Toast[]>([])
let toastId = 1

export interface ToastRecord {
  id: number
  kind: ToastKind
  message: string
  at: number
}

/** This session's toasts, newest first (the Notifications dialog lists them; memory only). */
const history = ref<ToastRecord[]>([])
const HISTORY_SIZE = 50

/**
 * Auto-dismiss timers. While the toast host is hovered or holds focus
 * (`hold`), every timer stops and keeps its remaining time; `release` restarts
 * them, so an Undo toast always gets its full time while the user is not on it.
 */
const timers = new Map<number, { remaining: number; started: number; handle?: ReturnType<typeof setTimeout> }>()
let held = false

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  /** Label of the dismiss button (default: Cancel). */
  cancelLabel?: string
  danger: boolean
  resolve: (value: boolean) => void
}

const confirmState = ref<ConfirmRequest | null>(null)

export function useToasts() {
  function dismiss(id: number): void {
    clearTimeout(timers.get(id)?.handle)
    timers.delete(id)
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }
  function arm(id: number): void {
    const timer = timers.get(id)
    if (!timer) return
    timer.started = Date.now()
    timer.handle = setTimeout(() => dismiss(id), timer.remaining)
  }
  function push(
    message: string,
    kind: ToastKind = 'info',
    timeoutMs = kind === 'error' || kind === 'warning' ? 7000 : 3500,
    action?: ToastAction,
  ): void {
    const id = toastId++
    // Five are kept: the oldest one goes (with its timer) when a sixth arrives.
    toasts.value.slice(0, -4).forEach((toast) => dismiss(toast.id))
    toasts.value = [...toasts.value, action ? { id, kind, message, action } : { id, kind, message }]
    history.value = [{ id, kind, message, at: Date.now() }, ...history.value.slice(0, HISTORY_SIZE - 1)]
    timers.set(id, { remaining: timeoutMs, started: 0 })
    if (!held) arm(id)
  }
  function hold(): void {
    if (held) return
    held = true
    const now = Date.now()
    for (const timer of timers.values()) {
      clearTimeout(timer.handle)
      timer.handle = undefined
      timer.remaining = Math.max(0, timer.remaining - (now - timer.started))
    }
  }
  function release(): void {
    if (!held) return
    held = false
    for (const id of timers.keys()) arm(id)
  }
  return {
    toasts,
    history,
    dismiss,
    push,
    hold,
    release,
    success: (message: string) => push(message, 'success'),
    warning: (message: string, action?: ToastAction) => push(message, 'warning', action ? 10000 : 7000, action),
    error: (message: string) => push(message, 'error'),
  }
}

export function useConfirm() {
  function confirm(options: { message: string; title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
    confirmState.value?.resolve(false)
    return new Promise((resolve) => {
      confirmState.value = {
        title: options.title ?? t('confirm.title'),
        message: options.message,
        confirmLabel: options.confirmLabel ?? t('common.confirm'),
        cancelLabel: options.cancelLabel,
        danger: options.danger ?? false,
        resolve: (value) => {
          confirmState.value = null
          resolve(value)
        },
      }
    })
  }
  return { confirm, confirmState }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for non-secure contexts (plain http on a LAN address).
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}
