<script setup lang="ts">
/**
 * Folder picker for moving one or more models: library root, a filterable
 * folder list from GET /{prefix}/folder-tree?model_root=..&include_empty=true
 * and an optional new subfolder (the backend creates it on move). Failures of
 * a bulk move stay listed in the dialog; a clean move closes it.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import ModalShell from './ModalShell.vue'
import type { ModelApi } from '@/api/endpoints'
import type { FolderTree, ModelItem } from '@/api/types'
import type { useModelActions } from '@/composables/useModelActions'
import { displayPath, flattenFolderTree, joinTargetPath, relativeFolder, validateNewFolder, type Failure } from '@/utils/modelActions'
import { t } from '@/i18n'

const props = defineProps<{
  items: ModelItem[]
  api: ModelApi
  actions: ReturnType<typeof useModelActions>
  defaultRoot?: string
  /** Download path template of the type (preview of "use default path"). */
  template?: string
}>()
const emit = defineEmits<{ close: [] }>()

const roots = ref<string[]>([])
const root = ref('')
const tree = ref<FolderTree>({})
const folder = ref('')
const filter = ref('')
const newFolder = ref('')
const loading = ref(true)
const loadError = ref<string | null>(null)
const busy = ref(false)
const failures = ref<Failure[]>([])
// The backend joins each model's download path template below the root.
const useDefaultPath = ref(false)

// Models still to move: after a partial bulk move only the failed ones remain (retry).
const pending = ref<ModelItem[]>([...props.items])
const single = computed(() => props.items.length === 1)
const title = computed(() =>
  single.value
    ? t('actions.move.title', { name: props.items[0].model_name || props.items[0].file_name })
    : t('actions.move.bulkTitle', { count: props.items.length }),
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
const relativeTarget = computed(() =>
  [folder.value, newFolder.value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')].filter(Boolean).join('/'),
)
const targetPath = computed(() =>
  root.value ? joinTargetPath(root.value, useDefaultPath.value ? '' : relativeTarget.value) : '',
)
const targetPreview = computed(() =>
  useDefaultPath.value && targetPath.value && props.template ? `${targetPath.value}/${props.template}` : targetPath.value,
)
/** Every selected model already lives in the destination. */
const sameFolder = computed(() =>
  pending.value.every((item) => {
    const dir = item.file_path.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
    return dir.toLowerCase() === targetPath.value.toLowerCase()
  }),
)
const canMove = computed(
  () => !!targetPath.value && (useDefaultPath.value || (!folderError.value && !sameFolder.value)) && !busy.value && !loading.value,
)

async function loadTree(): Promise<void> {
  if (!root.value) return
  loading.value = true
  loadError.value = null
  try {
    tree.value = await props.api.rootFolderTree(root.value)
  } catch (error) {
    tree.value = {}
    loadError.value = t('actions.move.loadFailed', { error: (error as Error).message })
  } finally {
    loading.value = false
  }
  // Show the preselected folder (the model's current one) in the list.
  await nextTick()
  document.querySelector<HTMLInputElement>('input[name="move-folder"]:checked')?.closest('label')?.scrollIntoView({ block: 'nearest' })
}

onMounted(async () => {
  try {
    roots.value = await props.api.roots()
  } catch (error) {
    loadError.value = t('actions.move.loadFailed', { error: (error as Error).message })
    loading.value = false
    return
  }
  // Start in the root (and folder) of the first selected model.
  const first = props.items[0]?.file_path.replace(/\\/g, '/').toLowerCase() ?? ''
  const own = roots.value.find((candidate) => first.startsWith(candidate.replace(/\\/g, '/').toLowerCase() + '/'))
  root.value = own ?? (props.defaultRoot && roots.value.includes(props.defaultRoot) ? props.defaultRoot : roots.value[0] ?? '')
  if (own && single.value) folder.value = relativeFolder(props.items[0].file_path, [own])
  await loadTree()
})

watch(root, (value, previous) => {
  if (previous && value !== previous) {
    folder.value = ''
    void loadTree()
  }
})

async function onSubmit(): Promise<void> {
  if (!canMove.value) return
  busy.value = true
  failures.value = []
  try {
    const summary = await props.actions.moveItems(pending.value, targetPath.value, roots.value, useDefaultPath.value)
    if (summary.failed.length) {
      failures.value = summary.failed
      const failed = new Set(summary.failed.map((entry) => entry.path))
      pending.value = pending.value.filter((item) => failed.has(item.file_path))
    }
    else emit('close')
  } finally {
    busy.value = false
  }
}

// The radio itself is visually hidden; its row shows the keyboard focus.
const rowClass = 'lm-row flex min-h-[30px] cursor-pointer items-center gap-2 px-2 text-sm has-focus-visible:focus-ring'
</script>

<template>
  <ModalShell :title="title" title-id="move-dialog-title" :busy="busy" @close="emit('close')">
    <form class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5" novalidate @submit.prevent="onSubmit">
      <div v-if="roots.length > 1" class="flex flex-col gap-1">
        <label class="lm-label" for="move-root">{{ t('actions.move.root') }}</label>
        <select id="move-root" v-model="root" class="lm-select" :disabled="busy">
          <option v-for="entry in roots" :key="entry" :value="entry">{{ entry }}</option>
        </select>
      </div>

      <label class="flex items-start gap-2 text-sm">
        <input v-model="useDefaultPath" class="lm-check mt-1" type="checkbox" :disabled="busy" />
        <span>
          {{ t('move.useDefault') }}
          <span class="block text-xs text-muted">{{ template ? t('move.useDefaultHint', { template }) : t('move.useDefaultFlat') }}</span>
        </span>
      </label>

      <fieldset v-if="!useDefaultPath" class="flex min-w-0 flex-col gap-2" :disabled="busy">
        <legend class="lm-label mb-1">{{ t('actions.move.folder') }}</legend>
        <label class="sr-only" for="move-filter">{{ t('actions.move.filter') }}</label>
        <input id="move-filter" v-model="filter" class="lm-input" type="search" :placeholder="t('actions.move.filter')" />
        <div class="max-h-[min(300px,40vh)] overflow-y-auto rounded-md hairline border-border bg-surface p-1">
          <p v-if="loading" class="p-2 text-sm text-muted">{{ t('common.loading') }}</p>
          <p v-else-if="loadError" class="lm-error-text p-2">{{ loadError }}</p>
          <template v-else>
            <label v-if="!filter.trim()" :class="[rowClass, { 'is-selected': folder === '' }]">
              <input v-model="folder" class="sr-only" type="radio" name="move-folder" value="" />
              <AppIcon name="grid" :size="15" />
              <span>{{ t('actions.move.rootFolder') }}</span>
            </label>
            <label
              v-for="path in shownFolders"
              :key="path"
              :class="[rowClass, { 'is-selected': folder === path }]"
              :style="{ paddingLeft: filter.trim() ? undefined : `calc(var(--lm-space-2) + ${path.split('/').length - 1} * var(--lm-space-4))` }"
              :title="path"
            >
              <input v-model="folder" class="sr-only" type="radio" name="move-folder" :value="path" />
              <AppIcon name="folder" :size="15" />
              <span class="truncate">{{ filter.trim() ? path : path.split('/').pop() }}</span>
            </label>
            <p v-if="filter.trim() && !shownFolders.length" class="p-2 text-sm text-muted">{{ t('actions.move.noFolders') }}</p>
          </template>
        </div>
      </fieldset>

      <div v-if="!useDefaultPath" class="flex flex-col gap-1">
        <label class="lm-label" for="move-new-folder">{{ t('actions.move.newFolder') }}</label>
        <input
          id="move-new-folder"
          v-model="newFolder"
          class="lm-input font-mono"
          autocomplete="off"
          spellcheck="false"
          :disabled="busy"
          :aria-invalid="!!folderError"
          aria-describedby="move-new-folder-hint move-new-folder-error"
        />
        <p id="move-new-folder-hint" class="lm-hint">{{ t('actions.move.newFolderHint') }}</p>
        <p id="move-new-folder-error" class="lm-error-text" role="alert">{{ folderError ?? '' }}</p>
      </div>

      <div class="rounded-md bg-sunken p-3 text-sm">
        <p class="lm-overline mb-1">{{ t('actions.move.target') }}</p>
        <p class="lm-mono wrap-anywhere" data-testid="move-target">{{ targetPreview || '-' }}</p>
        <p class="mt-2 text-xs text-muted">{{ t('actions.move.hint') }}</p>
      </div>

      <div v-if="failures.length" class="rounded-md hairline border-danger bg-danger-soft p-3 text-sm" role="alert">
        <p class="mb-1 font-bold">{{ t('actions.move.failuresTitle') }}</p>
        <ul class="flex flex-col gap-1">
          <li v-for="failure in failures" :key="failure.path" class="wrap-anywhere">
            <span class="lm-mono">{{ displayPath(failure.path, roots) }}</span>: {{ failure.message }}
          </li>
        </ul>
      </div>

      <div class="flex justify-end gap-2">
        <button type="button" class="lm-btn" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="submit" class="lm-btn lm-btn--primary" :disabled="!canMove">
          <AppIcon name="folderMove" :size="16" />
          {{ busy ? t('actions.move.moving') : single ? t('actions.move.confirm') : t('actions.move.bulkConfirm', { count: pending.length }) }}
        </button>
      </div>
    </form>
  </ModalShell>
</template>
