<script setup lang="ts">
/** Phase-1 recipes view: a read-only grid; details live in the classic UI. */
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTimeoutFn } from '@vueuse/core'
import LazyMedia from '@/components/LazyMedia.vue'
import StateBlock from '@/components/StateBlock.vue'
import VirtualGrid from '@/components/VirtualGrid.vue'
import AppIcon from '@/components/AppIcon.vue'
import SearchCombobox from '@/components/SearchCombobox.vue'
import { LOCAL_PER_GROUP, MAX_TAGS } from '@/api/suggestSource'
import { queryParam } from '@/config/navigation'
import type { SuggestOption } from '@/utils/suggest'
import { recipesApi } from '@/api/endpoints'
import type { RecipeItem } from '@/api/types'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { withMountPrefix } from '@/utils/basePath'
import { t } from '@/i18n'

const classicUrl = withMountPrefix('/loras/recipes')
const route = useRoute()
const router = useRouter()
/** Applied search (list endpoint `search`); `searchText` is the box, applied after a pause or on Enter. */
const search = ref('')
const searchText = ref('')
// Typing applies after a 250 ms pause; Enter / a pick applies at once (cancels the pending apply).
const { start: applyLater, stop: cancelApply } = useTimeoutFn(() => (search.value = searchText.value.trim()), 250, {
  immediate: false,
})

function commitSearch(value: string): void {
  cancelApply()
  searchText.value = value
  search.value = value.trim()
}

watch(searchText, (value) => {
  cancelApply()
  if (value.trim() !== search.value) applyLater()
})

function onSearchChoose(option: SuggestOption): void {
  if (option.kind === 'item') commitSearch(option.item.name)
  else if (option.kind === 'tag') commitSearch(option.tag.tag)
}

// ?q= (from the global search) prefills the box and is then dropped from the URL.
watch(
  () => route.query.q,
  (q) => {
    if (q === undefined) return
    commitSearch(queryParam(q))
    void router.replace({ query: { ...route.query, q: undefined } })
  },
  { immediate: true },
)
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
      <div class="flex flex-wrap items-center gap-2 phone:w-full">
        <SearchCombobox
          id="recipe-search"
          v-model="searchText"
          scope="recipes"
          class="w-[260px] narrow:w-[200px] phone:w-full"
          :label="t('library.search', { section: t('nav.recipes') })"
          :placeholder="t('library.searchPlaceholder', { section: t('nav.recipes') })"
          :max-per-group="LOCAL_PER_GROUP"
          :max-tags="MAX_TAGS"
          panel-class="left-0 top-[calc(100%+var(--lm-space-1))] w-[min(420px,calc(100vw-24px))] phone:right-0 phone:w-auto"
          @commit="commitSearch"
          @choose="onSearchChoose"
        />
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
          <LazyMedia
            class="size-full"
            media-class="size-full object-cover"
            :src="item.file_url ? withMountPrefix(item.file_url) : ''"
            loop
          />
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
