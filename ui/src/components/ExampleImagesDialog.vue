<script setup lang="ts">
/**
 * Example images of one model: download from Civitai (synchronous), import
 * own files (copied into the example folder), rating per image, delete an
 * imported image (permanent, confirmed) and open the folder. Works on the
 * drawer's useExampleImages instance, so the drawer updates too.
 */
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import ModalShell from './ModalShell.vue'
import type { useExampleImages } from '@/composables/useExampleImages'
import { withMountPrefix } from '@/utils/basePath'
import { IMPORT_EXTENSIONS, NSFW_LEVELS, type ExampleMedia } from '@/utils/exampleImages'
import { t } from '@/i18n'

const props = defineProps<{ name: string; ex: ReturnType<typeof useExampleImages> }>()
const emit = defineEmits<{ close: [] }>()
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

const src = (item: ExampleMedia) => (item.local ? withMountPrefix(item.url) : item.url)
const sourceLabel = (item: ExampleMedia) => (item.source === 'custom' ? t('examples.custom') : item.local ? t('examples.local') : t('examples.remote'))

async function onFiles(list: FileList | null | undefined): Promise<void> {
  if (list?.length) await props.ex.importFiles([...list])
  if (fileInput.value) fileInput.value.value = ''
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  void onFiles(event.dataTransfer?.files)
}
</script>

<template>
  <ModalShell :title="t('examples.dialogTitle', { name })" title-id="examples-title" :busy="ex.busy.value === 'download' || ex.busy.value === 'import'" wide @close="emit('close')">
    <div class="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5">
      <p v-if="!ex.hash.value" class="text-muted">{{ t('examples.noHash') }}</p>
      <div v-else-if="!ex.configured.value" class="flex flex-col items-start gap-2 rounded-md bg-warning-soft p-3 text-sm" role="note">
        <p>{{ t('examples.notConfigured') }}</p>
        <RouterLink class="lm-btn lm-btn--sm" to="/settings/example-images" @click="emit('close')">{{ t('examples.openSettings') }}</RouterLink>
      </div>
      <template v-else>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="lm-btn lm-btn--primary" :disabled="!!ex.busy.value" :aria-busy="ex.busy.value === 'download'" :title="t('examples.downloadThisHint')" @click="ex.downloadThis()">
            <AppIcon name="download" :size="16" />{{ ex.busy.value === 'download' ? t('examples.downloading') : t('examples.downloadThis') }}
          </button>
          <button type="button" class="lm-btn" :disabled="!!ex.busy.value" @click="fileInput?.click()">
            <AppIcon name="upload" :size="16" />{{ t('examples.import') }}
          </button>
          <button type="button" class="lm-btn lm-btn--ghost" :disabled="!!ex.busy.value" @click="ex.openFolder()">
            <AppIcon name="folder" :size="16" />{{ t('examples.openFolder') }}
          </button>
          <input ref="fileInput" type="file" multiple class="sr-only" tabindex="-1" :accept="IMPORT_EXTENSIONS.join(',')" @change="onFiles(($event.target as HTMLInputElement).files)" />
        </div>
        <div
          class="rounded-md border-2 border-dashed p-3 text-center text-sm text-muted"
          :class="dragging ? 'border-accent bg-accent-soft' : 'border-border'"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          {{ t('examples.dropHere') }} · {{ t('examples.importHint') }}
        </div>
      </template>

      <p v-if="ex.error.value" class="lm-error-text" role="alert">{{ ex.error.value }}</p>
      <p v-if="!ex.media.value.length" class="text-muted">{{ t('examples.empty') }}</p>
      <ul v-else class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        <li v-for="(item, i) in ex.media.value" :key="item.key" class="flex flex-col gap-1 rounded-md hairline border-border p-2" :aria-busy="ex.busy.value === item.key">
          <div class="relative aspect-square overflow-hidden rounded-sm bg-sunken">
            <LazyMedia class="size-full" media-class="size-full object-cover" :src="src(item)" :kind="item.isVideo ? 'video' : 'image'" :icon-size="20" />
            <span class="absolute top-1 left-1 lm-badge" :class="item.local ? 'lm-badge--success' : ''">{{ sourceLabel(item) }}</span>
          </div>
          <label class="sr-only" :for="`nsfw-${item.key}`">{{ t('examples.nsfwOf', { index: i + 1 }) }}</label>
          <div class="flex items-center gap-1">
            <select
              :id="`nsfw-${item.key}`"
              class="lm-select min-h-control-sm flex-1 text-xs"
              :value="item.nsfwLevel"
              :disabled="!!ex.busy.value"
              @change="ex.setNsfw(item, Number(($event.target as HTMLSelectElement).value))"
            >
              <option v-if="!NSFW_LEVELS.some((l) => l.value === item.nsfwLevel)" :value="item.nsfwLevel">{{ t('examples.nsfw') }}: ?</option>
              <option v-for="level in NSFW_LEVELS" :key="level.value" :value="level.value">{{ level.label }}</option>
            </select>
            <button
              v-if="item.source === 'custom'"
              type="button"
              class="lm-btn lm-btn--icon lm-btn--sm lm-btn--ghost text-danger"
              :disabled="!!ex.busy.value"
              :aria-label="t('examples.deleteAction')"
              :title="t('examples.deleteAction')"
              @click="ex.remove(item)"
            >
              <AppIcon name="trash" :size="14" />
            </button>
          </div>
        </li>
      </ul>
      <p v-if="ex.media.value.some((m) => m.source === 'civitai')" class="lm-hint">{{ t('examples.deleteOnlyImported') }}</p>
    </div>
  </ModalShell>
</template>
