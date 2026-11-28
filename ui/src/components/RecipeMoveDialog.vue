<script setup lang="ts">
/**
 * Move recipes to another folder of the recipes root (POST /recipe/move,
 * /recipes/move-bulk). The target is sent relative to the root; a typed new
 * subfolder is created by the backend. Failures stay listed and Move retries
 * only those.
 */
import { computed, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import ModalShell from './ModalShell.vue'
import { recipesApi } from '@/api/recipes'
import type { FolderTree, RecipeItem } from '@/api/types'
import { recipeTitle, type RecipeActions } from '@/composables/useRecipeActions'
import { flattenFolderTree, validateNewFolder } from '@/utils/modelActions'
import { t } from '@/i18n'

const props = defineProps<{ items: RecipeItem[]; actions: RecipeActions }>()
const emit = defineEmits<{ close: [] }>()

const root = ref('')
const tree = ref<FolderTree>({})
const folder = ref(props.items.length === 1 ? (props.items[0].folder ?? '') : '')
const filter = ref('')
const newFolder = ref('')
const loading = ref(true)
const loadError = ref<string | null>(null)
const busy = ref(false)
const pending = ref<RecipeItem[]>([...props.items])
const failures = ref<{ id: string; message: string }[]>([])

const single = computed(() => props.items.length === 1)
const title = computed(() =>
  single.value ? t('recipes.move.title', { name: recipeTitle(props.items[0]) }) : t('recipes.move.bulkTitle', { count: props.items.length }),
)
const folders = computed(() => flattenFolderTree(tree.value))
const shownFolders = computed(() => {
  const query = filter.value.trim().toLowerCase()
  return query ? folders.value.filter((path) => path.toLowerCase().includes(query)) : folders.value
})
const folderError = computed(() => {
  const key = validateNewFolder(newFolder.value)
  return key ? t(key) : null
})
/** Relative to the recipes root ('' = the root). */
const target = computed(() =>
  [folder.value, newFolder.value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')].filter(Boolean).join('/'),
)
const preview = computed(() => [root.value.replace(/\\/g, '/').replace(/\/+$/, ''), target.value].filter(Boolean).join('/'))
const sameFolder = computed(() => pending.value.every((item) => (item.folder ?? '') === target.value))
const canMove = computed(() => !!root.value && !folderError.value && !sameFolder.value && !busy.value && !loading.value)
const nameOf = (id: string) => recipeTitle(props.items.find((item) => item.id === id) ?? { id })

onMounted(async () => {
  try {
    const [roots, folderTree] = await Promise.all([recipesApi.roots(), recipesApi.folderTree()])
    root.value = roots[0] ?? ''
    tree.value = folderTree
  } catch (error) {
    loadError.value = t('actions.move.loadFailed', { error: (error as Error).message })
  } finally {
    loading.value = false
  }
})

async function onSubmit(): Promise<void> {
  if (!canMove.value) return
  busy.value = true
  failures.value = []
  try {
    // The root itself is sent as its absolute path (an empty target_path is refused).
    const summary = await props.actions.moveRecipes(pending.value, target.value || root.value)
    if (summary.failed.length) {
      failures.value = summary.failed
      const failed = new Set(summary.failed.map((entry) => entry.id))
      pending.value = pending.value.filter((item) => failed.has(item.id))
    } else emit('close')
  } finally {
    busy.value = false
  }
}

const rowClass = 'lm-row flex min-h-[30px] cursor-pointer items-center gap-2 px-2 text-sm has-focus-visible:focus-ring'
</script>

<template>
  <ModalShell :title="title" title-id="recipe-move-title" :busy="busy" @close="emit('close')">
    <form class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5" novalidate @submit.prevent="onSubmit">
      <fieldset class="flex min-w-0 flex-col gap-2" :disabled="busy">
        <legend class="lm-label mb-1">{{ t('actions.move.folder') }}</legend>
        <label class="sr-only" for="recipe-move-filter">{{ t('actions.move.filter') }}</label>
        <input id="recipe-move-filter" v-model="filter" class="lm-input" type="search" :placeholder="t('actions.move.filter')" />
        <div class="max-h-[min(300px,40vh)] overflow-y-auto rounded-md hairline border-border bg-surface p-1">
          <p v-if="loading" class="p-2 text-sm text-muted">{{ t('common.loading') }}</p>
          <p v-else-if="loadError" class="lm-error-text p-2">{{ loadError }}</p>
          <template v-else>
            <label v-if="!filter.trim()" :class="[rowClass, { 'is-selected': folder === '' }]">
              <input v-model="folder" class="sr-only" type="radio" name="recipe-move-folder" value="" />
              <AppIcon name="grid" :size="15" />
              <span>{{ t('recipes.detail.rootFolder') }}</span>
            </label>
            <label
              v-for="path in shownFolders"
              :key="path"
              :class="[rowClass, { 'is-selected': folder === path }]"
              :style="{ paddingLeft: filter.trim() ? undefined : `calc(var(--lm-space-2) + ${path.split('/').length - 1} * var(--lm-space-4))` }"
              :title="path"
            >
              <input v-model="folder" class="sr-only" type="radio" name="recipe-move-folder" :value="path" />
              <AppIcon name="folder" :size="15" />
              <span class="truncate">{{ filter.trim() ? path : path.split('/').pop() }}</span>
            </label>
            <p v-if="filter.trim() && !shownFolders.length" class="p-2 text-sm text-muted">{{ t('actions.move.noFolders') }}</p>
          </template>
        </div>
      </fieldset>

      <div class="flex flex-col gap-1">
        <label class="lm-label" for="recipe-move-new">{{ t('actions.move.newFolder') }}</label>
        <input
          id="recipe-move-new"
          v-model="newFolder"
          class="lm-input font-mono"
          autocomplete="off"
          spellcheck="false"
          :disabled="busy"
          :aria-invalid="!!folderError"
          aria-describedby="recipe-move-new-hint recipe-move-new-error"
        />
        <p id="recipe-move-new-hint" class="lm-hint">{{ t('actions.move.newFolderHint') }}</p>
        <p id="recipe-move-new-error" class="lm-error-text" role="alert">{{ folderError ?? '' }}</p>
      </div>

      <div class="rounded-md bg-sunken p-3 text-sm">
        <p class="lm-overline mb-1">{{ t('actions.move.target') }}</p>
        <p class="lm-mono wrap-anywhere">{{ preview || '-' }}</p>
        <p class="mt-2 text-xs text-muted">{{ t('recipes.move.hint') }}</p>
      </div>

      <div v-if="failures.length" class="rounded-md hairline border-danger bg-danger-soft p-3 text-sm" role="alert">
        <p class="mb-1 font-bold">{{ t('actions.move.failuresTitle') }}</p>
        <ul class="flex flex-col gap-1">
          <li v-for="failure in failures" :key="failure.id" class="wrap-anywhere">{{ nameOf(failure.id) }}: {{ failure.message }}</li>
        </ul>
      </div>

      <div class="lm-dialog-footer">
        <button type="button" class="lm-btn" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="submit" class="lm-btn lm-btn--primary" :disabled="!canMove">
          <AppIcon name="folderMove" :size="16" />
          {{ busy ? t('actions.move.moving') : single ? t('actions.move.confirm') : t('actions.move.bulkConfirm', { count: pending.length }) }}
        </button>
      </div>
    </form>
  </ModalShell>
</template>
