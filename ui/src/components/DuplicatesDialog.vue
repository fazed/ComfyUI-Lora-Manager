<script setup lang="ts">
/**
 * Duplicate finder (port of the classic ModelDuplicatesManager): groups of
 * models with the same hash shown side by side, "Verify hashes" per group,
 * and delete of the selected copies through the phase A delete flow
 * (danger confirm + Undo). One copy of every group must stay. A second tab
 * lists file name conflicts (read-only).
 */
import { computed, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import ModalShell from './ModalShell.vue'
import StateBlock from './StateBlock.vue'
import type { ModelApi } from '@/api/endpoints'
import type { DuplicateGroup, FilenameConflict, ModelItem } from '@/api/types'
import type { useModelActions } from '@/composables/useModelActions'
import { useToasts } from '@/composables/useFeedback'
import { duplicateDeleteError, pruneDuplicateGroups } from '@/utils/modelTools'
import { formatBytes, formatDateTime } from '@/utils/format'
import { withMountPrefix } from '@/utils/basePath'
import { t } from '@/i18n'

const props = defineProps<{ api: ModelApi; actions: ReturnType<typeof useModelActions>; blurMature?: boolean }>()
const emit = defineEmits<{ close: []; open: [item: ModelItem] }>()

const toasts = useToasts()
const tab = ref<'hash' | 'name'>('hash')
const groups = ref<DuplicateGroup[]>([])
const conflicts = ref<FilenameConflict[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const conflictsLoaded = ref(false)
const selected = ref<Set<string>>(new Set())
const mismatched = ref<Set<string>>(new Set())
const verified = ref<Set<string>>(new Set())
const verifying = ref<string | null>(null)
const busy = ref(false)

const deleteError = computed(() => duplicateDeleteError(groups.value, selected.value, mismatched.value))
const selectedItems = computed(() => groups.value.flatMap((group) => group.models).filter((model) => selected.value.has(model.file_path)))

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    groups.value = await props.api.findDuplicates()
  } catch (error) {
    loadError.value = (error as Error).message
  } finally {
    loading.value = false
  }
}

async function loadConflicts(): Promise<void> {
  if (conflictsLoaded.value) return
  try {
    conflicts.value = await props.api.filenameConflicts()
  } catch (error) {
    toasts.error((error as Error).message)
  } finally {
    conflictsLoaded.value = true
  }
}

onMounted(load)

function toggle(model: ModelItem): void {
  if (mismatched.value.has(model.file_path)) return
  const next = new Set(selected.value)
  if (next.has(model.file_path)) next.delete(model.file_path)
  else next.add(model.file_path)
  selected.value = next
}

async function verify(group: DuplicateGroup): Promise<void> {
  verifying.value = group.hash
  try {
    const result = await props.api.verifyDuplicates(group.models.map((model) => model.file_path))
    const nextMismatch = new Set(mismatched.value)
    const nextSelected = new Set(selected.value)
    for (const path of result.mismatched_files ?? []) {
      nextMismatch.add(path)
      nextSelected.delete(path)
    }
    mismatched.value = nextMismatch
    selected.value = nextSelected
    verified.value = new Set([...verified.value, group.hash])
  } catch (error) {
    toasts.error(t('tools.duplicates.verifyFailed', { error: (error as Error).message }))
  } finally {
    verifying.value = null
  }
}

async function deleteSelected(): Promise<void> {
  if (deleteError.value) return
  const items = selectedItems.value
  busy.value = true
  try {
    const ok = await props.actions.deleteItems(items)
    if (ok) {
      groups.value = pruneDuplicateGroups(groups.value, items.map((item) => item.file_path))
      selected.value = new Set()
    }
  } finally {
    busy.value = false
  }
}

function folderOf(model: ModelItem): string {
  return model.folder || '/'
}
</script>

<template>
  <ModalShell :title="t('tools.duplicates.title')" title-id="duplicates-dialog-title" :busy="busy" wide @close="emit('close')">
    <div class="flex min-h-0 flex-col gap-3 px-5 pb-5">
      <div class="flex gap-1" role="tablist" :aria-label="t('tools.duplicates.title')">
        <button
          id="dup-tab-hash"
          type="button"
          role="tab"
          class="lm-btn lm-btn--sm"
          :class="{ 'lm-chip--active': tab === 'hash' }"
          :aria-selected="tab === 'hash'"
          aria-controls="dup-panel-hash"
          @click="tab = 'hash'"
        >
          {{ t('tools.duplicates.byHash') }}
          <span v-if="!loading" class="lm-badge">{{ groups.length }}</span>
        </button>
        <button
          id="dup-tab-name"
          type="button"
          role="tab"
          class="lm-btn lm-btn--sm"
          :class="{ 'lm-chip--active': tab === 'name' }"
          :aria-selected="tab === 'name'"
          aria-controls="dup-panel-name"
          @click="tab = 'name'; loadConflicts()"
        >
          {{ t('tools.duplicates.byName') }}
          <span v-if="conflictsLoaded" class="lm-badge">{{ conflicts.length }}</span>
        </button>
      </div>

      <section v-if="tab === 'hash'" id="dup-panel-hash" role="tabpanel" aria-labelledby="dup-tab-hash" class="flex min-h-0 flex-col gap-3">
        <p class="lm-hint">{{ t('tools.duplicates.intro') }}</p>
        <div class="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <StateBlock v-if="loading" kind="loading" />
          <StateBlock v-else-if="loadError" kind="error" :message="loadError" @retry="load" />
          <StateBlock v-else-if="!groups.length" kind="empty" :title="t('tools.duplicates.none')" />
          <div v-for="group in groups" v-else :key="group.hash" class="lm-panel flex flex-col gap-2 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="min-w-0 flex-1 text-sm">
                {{ t('tools.duplicates.group', { count: group.models.length, hash: group.hash.slice(0, 12) }) }}
              </strong>
              <span v-if="verified.has(group.hash)" class="lm-badge lm-badge--success">{{ t('tools.duplicates.verified') }}</span>
              <button type="button" class="lm-btn lm-btn--sm" :disabled="verifying === group.hash" @click="verify(group)">
                <AppIcon name="refresh" :size="14" />{{ t('tools.duplicates.verify') }}
              </button>
            </div>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
              <article
                v-for="model in group.models"
                :key="model.file_path"
                class="flex min-w-0 flex-col gap-1 rounded-md hairline border-border bg-surface p-2 text-xs"
                :class="{ 'ring-selected': selected.has(model.file_path), 'opacity-50': mismatched.has(model.file_path) }"
              >
                <label class="flex items-center gap-2 text-sm">
                  <input
                    class="lm-check"
                    type="checkbox"
                    :checked="selected.has(model.file_path)"
                    :disabled="mismatched.has(model.file_path) || busy"
                    :aria-label="t('tools.duplicates.select', { name: model.file_name })"
                    @change="toggle(model)"
                  />
                  <span class="min-w-0 truncate font-bold" :title="model.model_name">{{ model.model_name || model.file_name }}</span>
                </label>
                <button type="button" class="block cursor-pointer overflow-hidden rounded-sm" :title="model.file_path" @click="emit('open', model)">
                  <LazyMedia
                    class="aspect-card max-h-[220px] w-full"
                    :media-class="['size-full object-cover', blurMature && (model.preview_nsfw_level ?? 0) >= 4 && 'scale-110 blur-[18px]']"
                    :src="model.preview_url ? withMountPrefix(model.preview_url) : ''"
                  />
                </button>
                <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                  <dt class="text-muted">{{ t('tools.duplicates.field.path') }}</dt>
                  <dd class="lm-mono wrap-anywhere">{{ folderOf(model) }}/{{ model.file_name }}</dd>
                  <dt class="text-muted">{{ t('tools.duplicates.field.size') }}</dt>
                  <dd>{{ formatBytes(model.file_size) }}</dd>
                  <dt class="text-muted">{{ t('tools.duplicates.field.modified') }}</dt>
                  <dd>{{ formatDateTime(model.modified) }}</dd>
                  <dt class="text-muted">{{ t('tools.duplicates.field.base') }}</dt>
                  <dd>{{ model.base_model || '-' }}</dd>
                  <dt class="text-muted">{{ t('tools.duplicates.field.version') }}</dt>
                  <dd class="wrap-anywhere">{{ model.civitai?.name || '-' }}</dd>
                </dl>
                <span v-if="mismatched.has(model.file_path)" class="lm-badge lm-badge--warning">{{ t('tools.duplicates.verifyMismatch') }}</span>
              </article>
            </div>
          </div>
        </div>
        <div v-if="groups.length" class="flex flex-wrap items-center justify-end gap-2">
          <span class="text-sm tabular-nums" aria-live="polite">{{ t('tools.duplicates.selectedCount', { count: selected.size }) }}</span>
          <span v-if="deleteError === 'keepOne'" class="lm-error-text" role="alert">{{ t('tools.duplicates.keepOne') }}</span>
          <button type="button" class="lm-btn lm-btn--danger" :disabled="!!deleteError || busy" @click="deleteSelected">
            <AppIcon name="trash" :size="16" />{{ t('tools.duplicates.delete') }}
          </button>
        </div>
      </section>

      <section v-else id="dup-panel-name" role="tabpanel" aria-labelledby="dup-tab-name" class="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <p class="lm-hint">{{ t('tools.duplicates.namesIntro') }}</p>
        <StateBlock v-if="!conflictsLoaded" kind="loading" />
        <StateBlock v-else-if="!conflicts.length" kind="empty" :title="t('tools.duplicates.namesNone')" />
        <div v-for="conflict in conflicts" v-else :key="conflict.filename" class="lm-panel p-3 text-sm">
          <strong class="lm-mono">{{ conflict.filename }}</strong>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="model in conflict.models" :key="model.file_path">
              <button type="button" class="lm-mono cursor-pointer text-left wrap-anywhere text-accent" @click="emit('open', model)">{{ model.file_path }}</button>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </ModalShell>
</template>
