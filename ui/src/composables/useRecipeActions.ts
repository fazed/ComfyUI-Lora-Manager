/**
 * Recipe management flows shared by the recipes page, cards, the detail drawer
 * and the selection toolbar: delete (confirm + Undo toast, same 20 s staging
 * as models), edits (title, tags, favorite), move, reconnect / restore,
 * re-match and "use" (copy syntax, send LoRAs or the embedded workflow to
 * ComfyUI).
 *
 * Hooks: `removed(ids)` drops cards at once, `updated(recipe)` patches one in
 * place, `changed()` reloads the grid (move, undo).
 */

import { undoDelete } from '@/api/endpoints'
import { ApiError } from '@/api/http'
import { recipesApi, type RecipeUpdate } from '@/api/recipes'
import type { RecipeItem, RecipeLora } from '@/api/types'
import { copyText, useConfirm, useToasts } from './useFeedback'
import { UNDO_TOAST_MS, UNDO_WINDOW_SECONDS } from './useModelActions'
import { useSendToWorkflow } from './useSendToWorkflow'
import { undoBatchIds } from '@/utils/modelActions'
import { parseReconnectInput } from '@/utils/recipes'
import type { SendMode } from '@/utils/workflow'
import { t } from '@/i18n'

export interface RecipeActionHooks {
  removed: (ids: string[]) => void
  updated: (recipe: RecipeItem) => void
  changed: () => void
}

export type ReconnectResult = { ok: true } | { ok: false; error: string }

export interface RecipeMoveSummary {
  moved: string[]
  failed: { id: string; message: string }[]
}

export const recipeTitle = (recipe: RecipeItem) => recipe.title || recipe.id
const message = (error: unknown) => (error as Error)?.message || t('common.error')

export function useRecipeActions(hooks: RecipeActionHooks) {
  const toasts = useToasts()
  const { confirm } = useConfirm()
  const workflow = useSendToWorkflow()

  async function undo(batchIds: string[]): Promise<void> {
    let restored = 0
    try {
      for (const id of batchIds) {
        await undoDelete(id)
        restored += 1
      }
      toasts.success(t('actions.undoRestored'))
    } catch (error) {
      const text = message(error)
      if (error instanceof ApiError && error.status === 404 && /expired/i.test(text)) toasts.error(t('actions.undoExpired'))
      else toasts.error(t('actions.undoFailed', { error: text }))
    } finally {
      if (restored) hooks.changed()
    }
  }

  const undoAction = (ids: string[]) => (ids.length ? { label: t('actions.undo'), run: () => void undo(ids) } : undefined)

  async function deleteRecipes(recipes: RecipeItem[]): Promise<boolean> {
    if (!recipes.length) return false
    const single = recipes.length === 1
    const ok = await confirm({
      title: single
        ? t('recipes.delete.title', { name: recipeTitle(recipes[0]) })
        : t('recipes.delete.bulkTitle', { count: recipes.length }),
      message: t(single ? 'recipes.delete.message' : 'recipes.delete.bulkMessage', { count: recipes.length, seconds: UNDO_WINDOW_SECONDS }),
      confirmLabel: single ? t('actions.delete.confirm') : t('actions.delete.bulkConfirm', { count: recipes.length }),
      danger: true,
    })
    if (!ok) return false
    try {
      if (single) {
        const result = await recipesApi.remove(recipes[0].id)
        hooks.removed([recipes[0].id])
        const ids = undoBatchIds(result)
        toasts.push(
          t(ids.length ? 'actions.delete.done' : 'actions.delete.donePermanent', { name: recipeTitle(recipes[0]) }),
          'success',
          ids.length ? UNDO_TOAST_MS : 5000,
          undoAction(ids),
        )
        return true
      }
      const result = await recipesApi.bulkDelete(recipes.map((recipe) => recipe.id))
      const deleted = result.deleted ?? []
      const failed = result.failed ?? []
      hooks.removed(deleted)
      const ids = undoBatchIds(result)
      const text = failed.length
        ? t('recipes.delete.bulkPartial', {
            ok: deleted.length,
            total: recipes.length,
            failed: failed.length,
            error: failed[0].reason ?? t('common.error'),
          })
        : t('recipes.delete.bulkDone', { count: deleted.length })
      toasts.push(text, failed.length ? 'warning' : 'success', ids.length ? UNDO_TOAST_MS : 7000, undoAction(ids))
      return true
    } catch (error) {
      toasts.error(t('actions.delete.failed', { error: message(error) }))
      hooks.changed()
      return false
    }
  }

  /** Saves the given fields and reports the merged recipe; null on failure (toast shown). */
  async function update(recipe: RecipeItem, updates: RecipeUpdate): Promise<RecipeItem | null> {
    try {
      await recipesApi.update(recipe.id, updates)
    } catch (error) {
      toasts.error(t('recipes.saveFailed', { error: message(error) }))
      return null
    }
    const next = { ...recipe, ...updates }
    hooks.updated(next)
    return next
  }

  async function toggleFavorite(recipe: RecipeItem): Promise<void> {
    const next = !recipe.favorite
    if (await update(recipe, { favorite: next })) toasts.success(t(next ? 'detail.favoriteOn' : 'detail.favoriteOff'))
  }

  /** Returns null on success, otherwise the message for the dialog. */
  async function rename(recipe: RecipeItem, title: string): Promise<string | null> {
    const value = title.trim()
    if (!value) return t('recipes.rename.errorEmpty')
    if (value === recipe.title) return null
    try {
      await recipesApi.update(recipe.id, { title: value })
    } catch (error) {
      return message(error)
    }
    hooks.updated({ ...recipe, title: value })
    toasts.success(t('recipes.rename.done', { name: value }))
    return null
  }

  async function setTags(recipe: RecipeItem, tags: string[]): Promise<boolean> {
    return !!(await update(recipe, { tags }))
  }

  /** Merges tags into each recipe (one request per recipe; there is no bulk endpoint). */
  async function addTags(recipes: RecipeItem[], tags: string[]): Promise<{ ok: number; failed: number }> {
    let okCount = 0
    let failed = 0
    for (const recipe of recipes) {
      const current = recipe.tags ?? []
      const lower = new Set(current.map((tag) => tag.toLowerCase()))
      const merged = [...current, ...tags.filter((tag) => !lower.has(tag.toLowerCase()))]
      try {
        await recipesApi.update(recipe.id, { tags: merged })
        hooks.updated({ ...recipe, tags: merged })
        okCount += 1
      } catch {
        failed += 1
      }
    }
    if (failed) toasts.warning(t('recipes.tags.partial', { ok: okCount, failed }))
    else toasts.success(t('recipes.tags.done', { count: okCount }))
    return { ok: okCount, failed }
  }

  /** `targetPath` relative to the recipes root ('' = the root itself) or absolute inside it. */
  async function moveRecipes(recipes: RecipeItem[], targetPath: string): Promise<RecipeMoveSummary> {
    const summary: RecipeMoveSummary = { moved: [], failed: [] }
    try {
      if (recipes.length === 1) {
        await recipesApi.move(recipes[0].id, targetPath)
        summary.moved.push(recipes[0].id)
      } else {
        const result = await recipesApi.moveBulk(
          recipes.map((recipe) => recipe.id),
          targetPath,
        )
        for (const entry of result.results ?? []) {
          if (entry.success) summary.moved.push(String(entry.recipe_id))
          else summary.failed.push({ id: String(entry.recipe_id), message: entry.message || t('common.error') })
        }
      }
    } catch (error) {
      summary.failed = recipes.map((recipe) => ({ id: recipe.id, message: message(error) }))
    }
    if (summary.failed.length && summary.moved.length) {
      toasts.warning(t('recipes.move.partial', { ok: summary.moved.length, total: recipes.length, failed: summary.failed.length }))
    } else if (summary.failed.length) {
      toasts.error(t('actions.move.failed', { error: summary.failed[0].message }))
    } else {
      toasts.success(t('recipes.move.done', { count: summary.moved.length }))
    }
    if (summary.moved.length) hooks.changed()
    return summary
  }

  function withLora(recipe: RecipeItem, index: number, lora: RecipeLora | undefined): RecipeItem {
    if (!lora) return recipe
    const loras = [...(recipe.loras ?? [])]
    loras[index] = { ...lora }
    return { ...recipe, loras }
  }

  async function reconnect(recipe: RecipeItem, index: number, input: string): Promise<ReconnectResult> {
    const target = parseReconnectInput(input)
    if (!target) return { ok: false, error: t('recipes.reconnect.errorEmpty') }
    try {
      const result = await recipesApi.reconnect(recipe.id, index, target)
      hooks.updated(withLora(recipe, index, result.updated_lora))
      toasts.success(t('recipes.reconnect.done', { name: target }))
      const mismatch = result.base_model_mismatch
      if (mismatch) {
        toasts.warning(
          t('recipes.reconnect.baseModelWarning', { recipe: mismatch.recipe_base_model ?? '?', lora: mismatch.lora_base_model ?? '?' }),
        )
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: message(error) }
    }
  }

  async function restore(recipe: RecipeItem, index: number): Promise<boolean> {
    try {
      const result = await recipesApi.restore(recipe.id, index)
      hooks.updated(withLora(recipe, index, result.updated_lora))
      toasts.success(t('recipes.reconnect.restored'))
      return true
    } catch (error) {
      toasts.error(message(error))
      return false
    }
  }

  async function reconnectCheckpoint(recipe: RecipeItem, input: string): Promise<ReconnectResult> {
    const target = parseReconnectInput(input)
    if (!target) return { ok: false, error: t('recipes.reconnect.errorEmpty') }
    try {
      const result = await recipesApi.reconnectCheckpoint(recipe.id, target)
      if (result.updated_checkpoint) hooks.updated({ ...recipe, checkpoint: result.updated_checkpoint })
      toasts.success(t('recipes.reconnect.done', { name: target }))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: message(error) }
    }
  }

  /** Local re-match of deleted / hash-invalid entries; the caller reloads the recipe afterwards. */
  async function rematch(recipe: RecipeItem): Promise<boolean> {
    try {
      const result = await recipesApi.rematch(recipe.id)
      toasts.success(
        t('recipes.rematch.done', { matched: result.matched_entries ?? 0, unresolved: result.unresolved_entries ?? 0 }),
      )
      return true
    } catch (error) {
      toasts.error(t('recipes.rematch.failed', { error: message(error) }))
      return false
    }
  }

  async function copySyntax(recipe: RecipeItem): Promise<void> {
    try {
      const syntax = await recipesApi.syntax(recipe.id)
      if (await copyText(syntax)) toasts.success(t('workflow.syntaxCopied'))
      else toasts.error(t('common.copyFailed'))
    } catch (error) {
      toasts.error(message(error))
    }
  }

  /** Classic RecipeCard.sendRecipeToWorkflow: the recipe syntax through update-lora-code (Shift = replace). */
  async function sendToComfy(recipe: RecipeItem, mode: SendMode = 'append'): Promise<boolean> {
    let syntax: string
    try {
      syntax = await recipesApi.syntax(recipe.id)
    } catch (error) {
      toasts.error(message(error))
      return false
    }
    return workflow.sendCode(syntax, mode, () =>
      void copyText(syntax).then((ok) => (ok ? toasts.success(t('workflow.syntaxCopied')) : toasts.error(t('common.copyFailed')))),
    )
  }

  async function sendWorkflow(recipe: RecipeItem): Promise<boolean> {
    try {
      await recipesApi.sendWorkflow(recipe.id)
      toasts.success(t('recipes.workflow.sent'))
      return true
    } catch (error) {
      const reason = error instanceof ApiError ? (error.payload as { error?: string } | null)?.error : undefined
      if (reason === 'no_workflow') toasts.warning(t('recipes.workflow.none'))
      else if (reason === 'Standalone Mode Active') toasts.warning(t('workflow.standalone'))
      else toasts.error(message(error))
      return false
    }
  }

  return {
    deleteRecipes,
    update,
    toggleFavorite,
    rename,
    setTags,
    addTags,
    moveRecipes,
    reconnect,
    restore,
    reconnectCheckpoint,
    rematch,
    copySyntax,
    sendToComfy,
    sendWorkflow,
  }
}

export type RecipeActions = ReturnType<typeof useRecipeActions>
