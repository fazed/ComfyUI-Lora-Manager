<script setup lang="ts">
/**
 * Recipe duplicates (classic DuplicatesManager in recipe mode): read-only
 * groups from GET /recipes/find-duplicates (same LoRAs + strengths, optionally
 * also the same prompt; or the same source URL). One recipe of every group
 * always stays: the newest is preselected as the keeper. Deletion goes through
 * the normal delete (confirm + 20 s undo).
 */
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import ModalShell from './ModalShell.vue'
import { recipesApi } from '@/api/recipes'
import type { RecipeDuplicateGroup, RecipeItem } from '@/api/types'
import type { RecipeActions } from '@/composables/useRecipeActions'
import { withMountPrefix } from '@/utils/basePath'
import { formatDateTime } from '@/utils/format'
import { t } from '@/i18n'

const props = defineProps<{ actions: RecipeActions }>()
const emit = defineEmits<{ close: []; open: [id: string] }>()

const groups = ref<RecipeDuplicateGroup[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const includePrompt = ref(false)
const selected = ref<Set<string>>(new Set())
const busy = ref(false)

/** A group may not lose all its recipes. */
function canSelect(group: RecipeDuplicateGroup, id: string): boolean {
  if (selected.value.has(id)) return true
  const others = group.recipes.filter((recipe) => recipe.id !== id)
  return others.some((recipe) => !selected.value.has(recipe.id))
}

function toggle(group: RecipeDuplicateGroup, id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else if (canSelect(group, id)) next.add(id)
  selected.value = next
}

/** Selects every recipe except the newest of each group. */
function selectAllButNewest(): void {
  const next = new Set<string>()
  for (const group of groups.value) group.recipes.slice(1).forEach((recipe) => next.add(recipe.id))
  selected.value = next
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  selected.value = new Set()
  try {
    groups.value = await recipesApi.findDuplicates(includePrompt.value)
  } catch (err) {
    error.value = (err as Error).message
    groups.value = []
  } finally {
    loading.value = false
  }
}

watch(includePrompt, () => void load())
onMounted(() => void load())

const selectedRecipes = computed<RecipeItem[]>(() =>
  groups.value.flatMap((group) => group.recipes).filter((recipe, index, all) => selected.value.has(recipe.id) && all.findIndex((other) => other.id === recipe.id) === index),
)

async function deleteSelected(): Promise<void> {
  if (!selectedRecipes.value.length) return
  busy.value = true
  try {
    if (await props.actions.deleteRecipes(selectedRecipes.value)) await load()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalShell :title="t('recipes.duplicates.title')" title-id="recipe-dups-title" :busy="busy" wide @close="emit('close')">
    <div class="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5">
      <p class="text-sm text-muted">{{ t('recipes.duplicates.intro') }}</p>
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-2 text-sm"><input v-model="includePrompt" class="lm-check" type="checkbox" :disabled="loading || busy" />{{ t('recipes.duplicates.includePrompt') }}</label>
        <span class="flex-1"></span>
        <button type="button" class="lm-btn lm-btn--sm" :disabled="!groups.length || busy" @click="selectAllButNewest">{{ t('recipes.duplicates.keepNewest') }}</button>
      </div>
      <p v-if="loading" class="text-sm text-muted">{{ t('common.loading') }}</p>
      <p v-else-if="error" class="lm-error-text">{{ error }}</p>
      <p v-else-if="!groups.length" class="py-6 text-center text-muted">{{ t('recipes.duplicates.none') }}</p>
      <section
        v-for="(group, groupIndex) in groups"
        v-else
        :key="group.key"
        class="flex flex-col gap-2 rounded-md hairline border-border p-3"
        :aria-label="t('recipes.duplicates.group', { index: groupIndex + 1, count: group.recipes.length })"
      >
        <p class="lm-overline">
          {{ t('recipes.duplicates.group', { index: groupIndex + 1, count: group.recipes.length }) }} ·
          {{ group.type === 'source_path' ? t('recipes.duplicates.bySource') : t('recipes.duplicates.byLoras') }}
        </p>
        <ul class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          <li
            v-for="entry in group.recipes"
            :key="entry.id"
            class="flex flex-col overflow-hidden rounded-md hairline"
            :class="selected.has(entry.id) ? 'border-danger ring-selected' : 'border-border'"
          >
            <LazyMedia class="aspect-square w-full bg-sunken" media-class="size-full object-cover" :src="entry.file_url ? withMountPrefix(entry.file_url) : ''" />
            <div class="flex flex-col gap-1 p-2 text-xs">
              <button type="button" class="truncate text-left text-sm font-medium hover:text-accent" :title="entry.title" @click="emit('open', entry.id)">{{ entry.title || entry.id }}</button>
              <span class="text-muted">{{ formatDateTime(entry.modified ?? entry.created_date) }}</span>
              <span class="text-muted">{{ t('recipes.loras', { count: entry.lora_count ?? 0 }) }}</span>
              <label class="mt-1 flex items-center gap-2">
                <input
                  class="lm-check"
                  type="checkbox"
                  :checked="selected.has(entry.id)"
                  :disabled="busy || !canSelect(group, entry.id)"
                  @change="toggle(group, entry.id)"
                />
                {{ t('recipes.duplicates.markDelete') }}
              </label>
            </div>
          </li>
        </ul>
      </section>
      <div class="lm-dialog-footer">
        <span class="text-sm text-muted tabular-nums">{{ t('library.selected', { count: selectedRecipes.length }) }}</span>
        <button type="button" class="lm-btn" :disabled="busy" @click="emit('close')">{{ t('common.close') }}</button>
        <button type="button" class="lm-btn lm-btn--danger" :disabled="busy || !selectedRecipes.length" @click="deleteSelected">
          <AppIcon name="trash" :size="16" />{{ t('recipes.duplicates.delete', { count: selectedRecipes.length }) }}
        </button>
      </div>
    </div>
  </ModalShell>
</template>
