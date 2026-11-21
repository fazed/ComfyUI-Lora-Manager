<script setup lang="ts">
/** Excluded models of one library (GET /{prefix}/excluded) with Restore (unexclude). */
import { onMounted, ref } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import ModalShell from './ModalShell.vue'
import StateBlock from './StateBlock.vue'
import type { ModelApi } from '@/api/endpoints'
import type { ModelItem } from '@/api/types'
import type { ModelTools } from '@/composables/useModelTools'
import { t } from '@/i18n'

const props = defineProps<{ api: ModelApi; tools: ModelTools }>()
const emit = defineEmits<{ close: [] }>()

const PAGE_SIZE = 50
const items = ref<ModelItem[]>([])
const total = ref(0)
const page = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const restoring = ref<string | null>(null)

async function load(reset = false): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = null
  try {
    const next = reset ? 1 : page.value + 1
    const response = await props.api.excluded(next, PAGE_SIZE, search.value)
    items.value = reset ? response.items : [...items.value, ...response.items]
    total.value = response.total
    page.value = next
  } catch (failure) {
    error.value = (failure as Error).message
  } finally {
    loading.value = false
  }
}

const { start: searchLater } = useTimeoutFn(() => void load(true), 300, { immediate: false })
onMounted(() => void load(true))

async function restore(item: ModelItem): Promise<void> {
  restoring.value = item.file_path
  try {
    if (await props.tools.unexclude(item)) {
      items.value = items.value.filter((entry) => entry.file_path !== item.file_path)
      total.value = Math.max(0, total.value - 1)
    }
  } finally {
    restoring.value = null
  }
}
</script>

<template>
  <ModalShell :title="t('tools.excluded.title')" title-id="excluded-dialog-title" wide @close="emit('close')">
    <div class="flex min-h-0 flex-col gap-3 px-5 pb-5">
      <p class="lm-hint">{{ t('tools.excluded.intro') }}</p>
      <label class="sr-only" for="excluded-search">{{ t('topbar.search') }}</label>
      <input id="excluded-search" v-model="search" class="lm-input" type="search" :placeholder="t('topbar.search')" @input="searchLater()" />
      <div class="flex min-h-0 flex-col gap-1 overflow-y-auto">
        <StateBlock v-if="error && !items.length" kind="error" :message="error" @retry="load(true)" />
        <StateBlock v-else-if="loading && !items.length" kind="loading" />
        <StateBlock v-else-if="!items.length" kind="empty" :title="t('tools.excluded.empty')" />
        <div v-for="item in items" :key="item.file_path" class="flex items-center gap-3 rounded-md hairline border-border bg-surface p-2">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold">{{ item.model_name || item.file_name }}</p>
            <p class="lm-mono text-xs text-muted wrap-anywhere">{{ item.file_path }}</p>
          </div>
          <button type="button" class="lm-btn lm-btn--sm" :disabled="restoring === item.file_path" @click="restore(item)">
            <AppIcon name="eye" :size="14" />{{ t('tools.excluded.restore') }}
          </button>
        </div>
        <button v-if="items.length < total" type="button" class="lm-btn lm-btn--sm self-center" :disabled="loading" @click="load()">
          {{ t('library.loadMore') }}
        </button>
      </div>
    </div>
  </ModalShell>
</template>
