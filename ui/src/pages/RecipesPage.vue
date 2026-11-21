<script setup lang="ts">
/** Phase-1 recipes view: a read-only grid; details live in the classic UI. */
import { onMounted, ref, watch } from 'vue'
import StateBlock from '@/components/StateBlock.vue'
import VirtualGrid from '@/components/VirtualGrid.vue'
import AppIcon from '@/components/AppIcon.vue'
import { recipesApi } from '@/api/endpoints'
import type { RecipeItem } from '@/api/types'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { useSearch } from '@/composables/useSearch'
import { withMountPrefix } from '@/utils/basePath'
import { isVideoUrl } from '@/utils/format'
import { t } from '@/i18n'

const classicUrl = withMountPrefix('/loras/recipes')
const { debounced: search } = useSearch()
const sort = ref('date:desc')
const grid = ref<InstanceType<typeof VirtualGrid> | null>(null)

const list = useInfiniteList<RecipeItem>((page, signal) =>
  recipesApi.list({ page, pageSize: 60, sortBy: sort.value, search: search.value }, signal),
)

watch([search, sort], () => {
  grid.value?.scrollToTop()
  void list.reset()
})
onMounted(() => void list.reset())
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="lm-toolbar pb-2">
      <div class="lm-toolbar-title">
        <h1>{{ t('recipes.title') }}</h1>
        <span class="lm-muted">{{ list.total.value.toLocaleString() }}</span>
      </div>
      <div class="flex gap-2">
        <label class="sr-only" for="recipe-sort">{{ t('library.sort') }}</label>
        <select id="recipe-sort" v-model="sort" class="lm-select w-auto">
          <option value="date:desc">{{ t('library.sort.dateDesc') }}</option>
          <option value="date:asc">{{ t('library.sort.dateAsc') }}</option>
          <option value="name:asc">{{ t('library.sort.nameAsc') }}</option>
          <option value="name:desc">{{ t('library.sort.nameDesc') }}</option>
        </select>
        <a class="lm-btn" :href="classicUrl"><AppIcon name="external" :size="16" />{{ t('common.openClassic') }}</a>
      </div>
    </div>
    <p class="mx-6 mb-3 text-sm text-muted phone:mx-3">{{ t('recipes.classicHint') }}</p>

    <StateBlock v-if="list.error.value && !list.items.value.length" kind="error" :message="list.error.value" @retry="list.reset()" />
    <StateBlock v-else-if="list.loaded.value && !list.items.value.length" kind="empty" icon="book" :title="t('recipes.empty')" />
    <StateBlock v-else-if="!list.loaded.value" kind="loading" />

    <VirtualGrid
      v-show="list.items.value.length"
      ref="grid"
      :items="list.items.value"
      :item-key="(item: RecipeItem) => item.id"
      :min-item-width="220"
      :label="t('recipes.title')"
      @reach-end="list.loadMore()"
    >
      <template #default="{ item }">
        <a
          class="relative block h-full overflow-hidden rounded-md hairline border-border bg-sunken text-on-scrim no-underline"
          :href="classicUrl"
          :title="item.title"
        >
          <video
            v-if="isVideoUrl(item.file_url)"
            class="size-full object-cover"
            :src="withMountPrefix(item.file_url ?? '')"
            muted
            loop
            playsinline
            preload="metadata"
          ></video>
          <img v-else-if="item.file_url" class="size-full object-cover" :src="withMountPrefix(item.file_url)" alt="" loading="lazy" />
          <div class="absolute inset-x-0 bottom-0 flex flex-col gap-[2px] bg-scrim-fade px-3 pt-6 pb-3 text-xs">
            <strong class="text-sm">{{ item.title || item.id }}</strong>
            <span>
              <template v-if="item.base_model">{{ item.base_model }} &middot; </template>{{ t('recipes.loras', { count: item.loras?.length ?? 0 }) }}
            </span>
          </div>
        </a>
      </template>
    </VirtualGrid>
  </div>
</template>
