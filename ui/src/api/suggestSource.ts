/**
 * Autocomplete / global search data source on top of the existing list and
 * search-tags endpoints (the backend has no dedicated suggest endpoint).
 *
 * Scopes: 'all' (global top-bar search: every library in parallel, tags from
 * LoRAs), a model prefix or 'recipes' (local search of one page).
 */

import { createModelApi, recipesApi } from './endpoints'
import type { ModelItem, ModelPrefix, RecipeItem } from './types'
import type { SuggestItem, SuggestPlan, SuggestSource } from '@/utils/suggest'

export type LibraryScope = ModelPrefix | 'recipes'
export type SearchScope = LibraryScope | 'all'

export const MODEL_SCOPES: ModelPrefix[] = ['loras', 'checkpoints', 'embeddings']
/** Global search sections, in display order. */
export const GLOBAL_SCOPES: LibraryScope[] = [...MODEL_SCOPES, 'recipes']
/** Global tag suggestions come from the biggest library; choosing one filters LoRAs. */
export const GLOBAL_TAG_SCOPE: ModelPrefix = 'loras'

export const GLOBAL_PER_GROUP = 4
export const LOCAL_PER_GROUP = 6
export const MAX_TAGS = 5

export function isModelScope(scope: string): scope is ModelPrefix {
  return (MODEL_SCOPES as string[]).includes(scope)
}

export function isLibraryScope(scope: string): scope is LibraryScope {
  return (GLOBAL_SCOPES as string[]).includes(scope)
}

/** Requests made for a scope; unknown scopes make none. */
export function planFor(scope: string): SuggestPlan {
  if (scope === 'all') return { groups: [...GLOBAL_SCOPES], tagScope: GLOBAL_TAG_SCOPE, limit: GLOBAL_PER_GROUP + 2 }
  if (isLibraryScope(scope)) return { groups: [scope], tagScope: scope, limit: LOCAL_PER_GROUP + 2 }
  return { groups: [], tagScope: null, limit: 0 }
}

export function modelToSuggestItem(item: ModelItem): SuggestItem {
  return {
    key: item.file_path,
    name: item.model_name || item.file_name,
    secondary: item.file_name,
    badge: item.base_model || undefined,
    thumb: item.preview_url || undefined,
    nsfwLevel: item.preview_nsfw_level,
    payload: item,
  }
}

export function recipeToSuggestItem(item: RecipeItem): SuggestItem {
  return {
    key: item.id,
    name: item.title || item.id,
    badge: item.base_model || undefined,
    thumb: item.file_url || undefined,
    payload: item,
  }
}

/** One page of search hits for a library, mapped for display. */
export async function searchLibrary(
  scope: LibraryScope,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<{ items: SuggestItem[]; total: number }> {
  if (isModelScope(scope)) {
    const page = await createModelApi(scope).list({ page: 1, pageSize: limit, sortBy: 'name:asc', search: query }, signal)
    return { items: (page.items ?? []).map(modelToSuggestItem), total: page.total ?? 0 }
  }
  const page = await recipesApi.list({ page: 1, pageSize: limit, search: query }, signal)
  return { items: (page.items ?? []).map(recipeToSuggestItem), total: page.total ?? 0 }
}

export const apiSuggestSource: SuggestSource = {
  plan: planFor,
  items(group, query, limit, signal) {
    if (!isLibraryScope(group)) return Promise.resolve({ items: [], total: 0 })
    return searchLibrary(group, query, limit, signal)
  },
  tags(tagScope, query, limit, signal) {
    if (isModelScope(tagScope)) return createModelApi(tagScope).searchTags(query, limit, signal)
    if (tagScope === 'recipes') return recipesApi.searchTags(query, limit, signal)
    return Promise.resolve([])
  },
}
