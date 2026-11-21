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

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  danger: boolean
  resolve: (value: boolean) => void
}

const confirmState = ref<ConfirmRequest | null>(null)

export function useToasts() {
  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }
  function push(
    message: string,
    kind: ToastKind = 'info',
    timeoutMs = kind === 'error' || kind === 'warning' ? 7000 : 3500,
    action?: ToastAction,
  ): void {
    const id = toastId++
    toasts.value = [...toasts.value.slice(-4), action ? { id, kind, message, action } : { id, kind, message }]
    setTimeout(() => dismiss(id), timeoutMs)
  }
  return {
    toasts,
    dismiss,
    push,
    success: (message: string) => push(message, 'success'),
    warning: (message: string, action?: ToastAction) => push(message, 'warning', action ? 10000 : 7000, action),
    error: (message: string) => push(message, 'error'),
  }
}

export function useConfirm() {
  function confirm(options: { message: string; title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
    confirmState.value?.resolve(false)
    return new Promise((resolve) => {
      confirmState.value = {
        title: options.title ?? t('confirm.title'),
        message: options.message,
        confirmLabel: options.confirmLabel ?? t('common.confirm'),
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
