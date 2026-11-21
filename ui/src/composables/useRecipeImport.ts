/**
 * Import flow of one recipe (port of the classic ImportManager):
 *
 *   input --analyze--> analyzing --ok--> review --save--> saving --> done
 *                          |  error / no metadata          | error
 *                          v                               v
 *                        input (with the message)        review (with the message)
 *
 * Sources: an uploaded file (multipart analyze), an http(s) URL (the backend
 * downloads it; Civitai image pages are read from the Civitai API) or an image
 * path on the server's disk. Analysis only writes temp files; `save` writes the
 * recipe (image + JSON) into the recipes root. A newer analysis supersedes a
 * slower older one.
 */

import { computed, ref, shallowRef } from 'vue'
import { recipesApi } from '@/api/recipes'
import type { RecipeAnalysis } from '@/api/types'
import { buildSaveMetadata, defaultRecipeName, isHttpUrl, isLocalImagePath, normalizeAnalysis } from '@/utils/recipes'
import { t } from '@/i18n'

export type ImportStep = 'input' | 'analyzing' | 'review' | 'saving' | 'done'

export type ImportSource = { kind: 'file'; file: File } | { kind: 'url'; url: string } | { kind: 'local'; path: string }

const message = (error: unknown) => (error as Error)?.message || t('common.error')

export function useRecipeImport() {
  const step = ref<ImportStep>('input')
  const error = ref<string | null>(null)
  const analysis = shallowRef<RecipeAnalysis | null>(null)
  const source = shallowRef<ImportSource | null>(null)
  const name = ref('')
  const tags = ref<string[]>([])
  const savedId = ref<string | null>(null)
  let generation = 0
  let controller: AbortController | null = null

  const view = computed(() => (analysis.value ? normalizeAnalysis(analysis.value) : null))
  const canSave = computed(() => step.value === 'review' && !!analysis.value && !view.value?.error && !!name.value.trim())

  async function run(next: ImportSource, call: (signal: AbortSignal) => Promise<RecipeAnalysis>): Promise<boolean> {
    generation += 1
    const current = generation
    controller?.abort()
    controller = new AbortController()
    step.value = 'analyzing'
    error.value = null
    source.value = next
    analysis.value = null
    try {
      const result = await call(controller.signal)
      if (current !== generation) return false
      const normalized = normalizeAnalysis(result ?? {})
      if (normalized.error) {
        step.value = 'input'
        error.value = normalized.error
        return false
      }
      analysis.value = result
      name.value = defaultRecipeName(result, next.kind === 'file' ? next.file.name : undefined)
      tags.value = []
      step.value = 'review'
      return true
    } catch (err) {
      if (current !== generation || (err as Error)?.name === 'AbortError') return false
      step.value = 'input'
      error.value = message(err)
      return false
    }
  }

  function analyzeFile(file: File): Promise<boolean> {
    if (file.type && !/^(image|video)\//.test(file.type)) {
      error.value = t('recipes.import.errorNotImage')
      return Promise.resolve(false)
    }
    return run({ kind: 'file', file }, (signal) => recipesApi.analyzeFile(file, signal))
  }

  /** A URL goes to analyze-image, an image path to analyze-local-image; anything else is refused locally. */
  function analyzeInput(text: string): Promise<boolean> {
    const value = text.trim()
    if (isHttpUrl(value)) return run({ kind: 'url', url: value }, (signal) => recipesApi.analyzeUrl(value, signal))
    if (isLocalImagePath(value)) return run({ kind: 'local', path: value }, (signal) => recipesApi.analyzeLocal(value, signal))
    error.value = value ? t('recipes.import.errorInput') : t('recipes.import.errorEmpty')
    return Promise.resolve(false)
  }

  async function save(): Promise<string | null> {
    const raw = analysis.value
    const origin = source.value
    if (!canSave.value || !raw || !origin) return null
    step.value = 'saving'
    error.value = null
    try {
      const result = await recipesApi.save({
        image: origin.kind === 'file' ? origin.file : undefined,
        imageBase64: origin.kind === 'file' ? undefined : raw.image_base64,
        extension: origin.kind === 'file' ? undefined : raw.extension,
        name: name.value.trim(),
        tags: tags.value,
        metadata: buildSaveMetadata(raw, origin.kind === 'url' ? origin.url : undefined),
      })
      savedId.value = result.recipe_id ?? null
      step.value = 'done'
      return savedId.value
    } catch (err) {
      step.value = 'review'
      error.value = message(err)
      return null
    }
  }

  /** Back to the input step (keeps nothing of the previous analysis). */
  function reset(): void {
    generation += 1
    controller?.abort()
    controller = null
    step.value = 'input'
    error.value = null
    analysis.value = null
    source.value = null
    name.value = ''
    tags.value = []
    savedId.value = null
  }

  return { step, error, analysis, view, source, name, tags, savedId, canSave, analyzeFile, analyzeInput, save, reset }
}

export type RecipeImportFlow = ReturnType<typeof useRecipeImport>
