<script setup lang="ts">
/**
 * Updates page, "Old versions": model lines where the library owns more than
 * one version (same Civitai model, same base model), from the read-only
 * `GET /{prefix}/updates/old-versions`. The newest owned version is shown as
 * kept; every older one lists its files with "Delete…" (one file, the card
 * delete flow with Undo), and a line has "Delete all older…" (one summary
 * confirm listing every file, the existing bulk delete). Nothing is
 * preselected; every delete is an explicit choice behind a confirm.
 */
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import StateBlock from './StateBlock.vue'
import { createModelApi, updatesApi } from '@/api/endpoints'
import { ApiError } from '@/api/http'
import type { ModelPrefix, OldVersionEntry, OldVersionFile, OldVersionGroup, OldVersionsResponse } from '@/api/types'
import { useModelActions, type VersionFileTarget } from '@/composables/useModelActions'
import { withMountPrefix } from '@/utils/basePath'
import { formatBytes, formatDate, formatDateTime } from '@/utils/format'
import { isBlurred } from '@/utils/mature'
import { libraryLink } from '@/utils/updates'
import { t } from '@/i18n'

const props = defineProps<{ prefix: ModelPrefix; blurMature: boolean }>()
const emit = defineEmits<{ counts: [groups: number | null] }>()

const data = ref<OldVersionsResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let controller: AbortController | null = null

async function load(options: { throwOnError?: boolean } = {}): Promise<void> {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = null
  try {
    const result = await updatesApi.oldVersions(props.prefix, current.signal)
    if (controller !== current) return
    data.value = result
    emit('counts', result.totals?.groups ?? result.groups.length)
  } catch (err) {
    if ((err as Error)?.name === 'AbortError' || controller !== current) return
    error.value = err instanceof ApiError && err.status === 404 ? t('updates.notAvailable') : (err as Error)?.message || t('common.error')
    if (options.throwOnError) throw err
  } finally {
    if (controller === current) loading.value = false
  }
}

watch(
  () => props.prefix,
  () => {
    data.value = null
    emit('counts', null)
    void load()
  },
  { immediate: true },
)

defineExpose({ load })

const api = computed(() => createModelApi(props.prefix))
// Every successful delete / undo re-reads the list (the backend decides what is old now).
const actions = () =>
  useModelActions(api.value, {
    removed: () => void load(),
    changed: () => void load(),
  })

const groups = computed(() => data.value?.groups ?? [])
const versionName = (entry: OldVersionEntry) => entry.name || t('oldVersions.unknownVersion')
const groupName = (group: OldVersionGroup) => group.modelName || t('oldVersions.unnamedModel', { id: group.modelId })
const filesText = (count: number) =>
  t('oldVersions.files', { count, files: count === 1 ? t('replace.bulk.file') : t('replace.bulk.files') })
const totalsText = computed(() => {
  const totals = data.value?.totals
  if (!totals) return ''
  return t('oldVersions.totals', {
    versions: totals.olderVersions,
    versionsWord: totals.olderVersions === 1 ? t('oldVersions.version') : t('oldVersions.versions'),
    files: totals.olderFiles,
    filesWord: totals.olderFiles === 1 ? t('replace.bulk.file') : t('replace.bulk.files'),
    size: formatBytes(totals.olderBytes),
  })
})

function target(entry: OldVersionEntry, file: OldVersionFile): VersionFileTarget {
  return { filePath: file.filePath, fileName: file.fileName, folder: file.folder, sizeBytes: file.sizeBytes, versionName: entry.name }
}

function thumb(group: OldVersionGroup): OldVersionFile | undefined {
  return group.newest.files[0]
}

async function deleteOne(entry: OldVersionEntry, file: OldVersionFile): Promise<void> {
  await actions().deleteVersionFile(target(entry, file))
}

async function deleteAllOlder(group: OldVersionGroup): Promise<void> {
  const files = group.older.flatMap((entry) => entry.files.map((file) => target(entry, file)))
  await actions().deleteVersionFiles(files, { modelName: groupName(group), keptName: versionName(group.newest) })
}
</script>

<template>
  <section class="flex flex-col gap-3" aria-labelledby="old-versions-heading" :aria-busy="loading || undefined" data-testid="old-versions">
    <h2 id="old-versions-heading" class="text-lg">
      {{ t('oldVersions.heading') }}
      <span v-if="data" class="text-muted tabular-nums">{{ groups.length }}</span>
    </h2>
    <p class="text-sm text-pretty text-muted">{{ t('oldVersions.hint') }}</p>
    <p v-if="groups.length" class="text-sm text-muted tabular-nums">{{ totalsText }}</p>

    <StateBlock v-if="error && !data" kind="error" :title="t('oldVersions.loadError')" :message="error" @retry="load()" />
    <StateBlock v-else-if="!data" kind="loading" />
    <StateBlock
      v-else-if="!groups.length"
      kind="empty"
      icon="check"
      :title="t('oldVersions.empty')"
      :message="t('oldVersions.emptyHint')"
    />
    <ul v-else class="flex flex-col gap-2">
      <li v-for="group in groups" :key="group.key" class="lm-panel flex flex-col gap-3 p-3" :data-testid="`old-group-${group.key}`">
        <div class="flex items-start gap-3 phone:flex-wrap">
          <LazyMedia
            class="lm-thumb h-[4.5rem] w-[3.5rem] flex-none"
            :media-class="['size-full object-cover', isBlurred(thumb(group)?.previewNsfwLevel ?? 0, blurMature) && 'scale-110 blur-[12px]']"
            :src="thumb(group)?.previewUrl ? withMountPrefix(thumb(group)!.previewUrl!) : ''"
            :icon-size="18"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <h3 class="text-md wrap-anywhere">
              {{ groupName(group) }}
              <span v-if="group.baseModel" class="lm-badge lm-badge--accent ml-1 align-middle">{{ group.baseModel }}</span>
            </h3>
            <p class="flex flex-wrap items-center gap-2 text-sm">
              <span class="lm-badge lm-badge--success">{{ t('oldVersions.newest') }}</span>
              <strong class="wrap-anywhere">{{ versionName(group.newest) }}</strong>
              <span v-if="group.newest.releasedAt" class="text-xs text-muted">{{ formatDate(group.newest.releasedAt) }}</span>
              <RouterLink
                v-if="group.newest.files[0]"
                class="text-xs text-accent hover:underline phone:inline-flex phone:min-h-touch phone:items-center"
                :to="libraryLink(prefix, group.newest.files[0].filePath)"
              >{{ group.newest.files[0].fileName }}</RouterLink>
            </p>
          </div>
          <button
            type="button"
            class="lm-btn lm-btn--sm flex-none text-danger phone:min-h-touch phone:w-full"
            :aria-label="t('oldVersions.deleteAllLabel', { name: groupName(group) })"
            data-testid="delete-all-older"
            @click="deleteAllOlder(group)"
          >
            <AppIcon name="trash" :size="14" />{{ t('oldVersions.deleteAll') }}
          </button>
        </div>

        <ul class="flex flex-col gap-2" :aria-label="t('oldVersions.older')">
          <li v-for="entry in group.older" :key="entry.versionId" class="flex flex-col gap-1 rounded-md hairline border-border p-2">
            <p class="flex flex-wrap items-center gap-2 text-sm">
              <span class="lm-badge">{{ t('oldVersions.older') }}</span>
              <strong class="wrap-anywhere">{{ versionName(entry) }}</strong>
              <span v-if="entry.releasedAt" class="text-xs text-muted">{{ formatDate(entry.releasedAt) }}</span>
              <span class="text-xs text-muted">{{ filesText(entry.files.length) }}</span>
            </p>
            <ul class="flex flex-col gap-1">
              <li v-for="file in entry.files" :key="file.filePath" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="old-file">
                <span class="min-w-0 flex-1 wrap-anywhere" :title="file.filePath">
                  <span class="text-fg">{{ file.fileName }}</span>
                  <span class="text-muted"> · {{ file.folder || t('versions.rootFolder') }}</span>
                  <span v-if="file.sizeBytes" class="text-muted tabular-nums"> · {{ formatBytes(file.sizeBytes) }}</span>
                  <span v-if="file.modified" class="text-muted tabular-nums"> · {{ formatDateTime(file.modified) }}</span>
                </span>
                <button
                  type="button"
                  class="lm-btn lm-btn--ghost lm-btn--sm text-danger phone:min-h-touch"
                  :aria-label="t('oldVersions.deleteFileLabel', { version: versionName(entry), file: file.fileName })"
                  data-testid="delete-old-file"
                  @click="deleteOne(entry, file)"
                >
                  <AppIcon name="trash" :size="14" />{{ t('oldVersions.deleteFile') }}
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>
  </section>
</template>
