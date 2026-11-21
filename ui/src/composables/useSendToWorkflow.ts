/**
 * "Send to ComfyUI" / "Copy LoRA syntax" for LoRA cards and the detail drawer.
 * Node selection for workflows with several LoRA nodes goes through the shared
 * NodePickerDialog (mounted once in App.vue).
 */

import { ref } from 'vue'
import { ApiError } from '@/api/http'
import { workflowApi } from '@/api/endpoints'
import type { ModelItem } from '@/api/types'
import { useAppSettings } from './useAppSettings'
import { copyText, useToasts } from './useFeedback'
import {
  buildLoraCopyText,
  buildLoraSyntax,
  buildUpdateLoraCodeBody,
  loraTargetNodes,
  type RegistryNode,
  type SendExclusions,
  type SendMode,
} from '@/utils/workflow'
import { t } from '@/i18n'

export interface NodePickerRequest {
  nodes: Record<string, RegistryNode>
  mode: SendMode
  resolve: (keys: string[] | null) => void
}

const pickerState = ref<NodePickerRequest | null>(null)

export function useNodePicker() {
  function pick(nodes: Record<string, RegistryNode>, mode: SendMode): Promise<string[] | null> {
    pickerState.value?.resolve(null)
    return new Promise((resolve) => {
      pickerState.value = {
        nodes,
        mode,
        resolve: (keys) => {
          pickerState.value = null
          resolve(keys)
        },
      }
    })
  }
  return { pickerState, pick }
}

export interface LoraActionOptions {
  mode?: SendMode
  /** Model strength override (drawer input); defaults to the usage tips. */
  strength?: number | null
  trainedWords?: string[]
}

type LoraLike = Pick<ModelItem, 'file_name' | 'folder' | 'usage_tips' | 'civitai'>

export function useSendToWorkflow() {
  const toasts = useToasts()
  const { settings, load } = useAppSettings()
  const { pick } = useNodePicker()

  function syntaxFor(item: LoraLike, strength?: number | null): string {
    return buildLoraSyntax(item, { format: String(settings.value?.lora_syntax_format ?? 'legacy'), strength })
  }

  async function copyLora(item: LoraLike, options: LoraActionOptions = {}): Promise<boolean> {
    await load()
    const words = options.trainedWords ?? item.civitai?.trainedWords ?? []
    const text = buildLoraCopyText(syntaxFor(item, options.strength), words, !!settings.value?.include_trigger_words)
    const ok = await copyText(text)
    if (ok) toasts.success(t('workflow.syntaxCopied'))
    else toasts.error(t('common.copyFailed'))
    return ok
  }

  /** Sends a ready LoRA code to the chosen node(s); `copyFallback` is offered when that is impossible. */
  async function sendCode(code: string, mode: SendMode, copyFallback: () => void): Promise<boolean> {
    const warnWithCopy = (message: string) => toasts.warning(message, { label: t('workflow.copySyntax'), run: copyFallback })
    let nodes: Record<string, RegistryNode>
    try {
      nodes = (await workflowApi.registry()).nodes ?? {}
    } catch (error) {
      const reason = error instanceof ApiError ? (error.payload as { error?: string } | null)?.error : undefined
      if (reason === 'Standalone Mode Active') warnWithCopy(t('workflow.standalone'))
      else if (reason === 'Empty Registry') warnWithCopy(t('workflow.noNodes'))
      else warnWithCopy(t('workflow.registryFailed', { error: (error as Error).message }))
      return false
    }

    const targets = loraTargetNodes(nodes, settings.value?.send_to_workflow_exclusions as SendExclusions | undefined)
    const keys = Object.keys(targets)
    if (!keys.length) {
      warnWithCopy(t('workflow.noNodes'))
      return false
    }
    const chosen = keys.length === 1 ? keys : await pick(targets, mode)
    if (!chosen?.length) return false

    try {
      await workflowApi.updateLoraCode(buildUpdateLoraCodeBody(code, mode, chosen, targets))
      toasts.success(t(mode === 'replace' ? 'workflow.replaced' : 'workflow.appended'))
      return true
    } catch (error) {
      toasts.error(t('workflow.sendFailed', { error: (error as Error).message }))
      return false
    }
  }

  async function sendLora(item: LoraLike, options: LoraActionOptions = {}): Promise<boolean> {
    await load()
    return sendCode(syntaxFor(item, options.strength), options.mode ?? 'append', () => void copyLora(item, options))
  }

  /** Selection mode: all LoRAs in one update, joined with ", " like the classic bulk send. */
  async function sendLoras(items: LoraLike[], mode: SendMode = 'append'): Promise<boolean> {
    if (!items.length) return false
    await load()
    const code = items.map((item) => syntaxFor(item)).join(', ')
    return sendCode(code, mode, () =>
      void copyText(code).then((ok) => (ok ? toasts.success(t('workflow.syntaxCopied')) : toasts.error(t('common.copyFailed')))),
    )
  }

  return { sendLora, sendLoras, copyLora, syntaxFor }
}
