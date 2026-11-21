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
  <div class="recipes">
    <div class="recipes__toolbar">
      <div class="recipes__title">
        <h1>{{ t('recipes.title') }}</h1>
        <span class="lm-muted">{{ list.total.value.toLocaleString() }}</span>
      </div>
      <div class="recipes__controls">
        <label class="visually-hidden" for="recipe-sort">{{ t('library.sort') }}</label>
        <select id="recipe-sort" v-model="sort" class="lm-select">
          <option value="date:desc">{{ t('library.sort.dateDesc') }}</option>
          <option value="date:asc">{{ t('library.sort.dateAsc') }}</option>
          <option value="name:asc">{{ t('library.sort.nameAsc') }}</option>
          <option value="name:desc">{{ t('library.sort.nameDesc') }}</option>
        </select>
        <a class="lm-btn" :href="classicUrl"><AppIcon name="external" :size="16" />{{ t('common.openClassic') }}</a>
      </div>
    </div>
    <p class="recipes__hint lm-muted">{{ t('recipes.classicHint') }}</p>

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
        <a class="recipe" :href="classicUrl" :title="item.title">
          <video v-if="isVideoUrl(item.file_url)" :src="withMountPrefix(item.file_url ?? '')" muted loop playsinline preload="metadata"></video>
          <img v-else-if="item.file_url" :src="withMountPrefix(item.file_url)" alt="" loading="lazy" />
          <div class="recipe__info">
            <strong>{{ item.title || item.id }}</strong>
            <span>
              <template v-if="item.base_model">{{ item.base_model }} &middot; </template>{{ t('recipes.loras', { count: item.loras?.length ?? 0 }) }}
            </span>
          </div>
        </a>
      </template>
    </VirtualGrid>
  </div>
</template>

<style scoped>
.recipes {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.recipes__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--lm-space-3);
  padding: var(--lm-space-5) var(--lm-space-6) var(--lm-space-2);
}

.recipes__title {
  display: flex;
  align-items: baseline;
  gap: var(--lm-space-3);
}

.recipes__title h1 {
  font-size: var(--lm-font-size-2xl);
}

.recipes__controls {
  display: flex;
  gap: var(--lm-space-2);
}

.recipes__controls .lm-select {
  width: auto;
}

.recipes__hint {
  margin: 0 var(--lm-space-6) var(--lm-space-3);
  font-size: var(--lm-font-size-sm);
}

.recipe {
  position: relative;
  display: block;
  height: 100%;
  overflow: hidden;
  border: var(--lm-border-width) solid var(--lm-color-border);
  border-radius: var(--lm-radius-md);
  background: var(--lm-color-sunken);
  color: var(--lm-color-on-scrim);
  text-decoration: none;
}

.recipe img,
.recipe video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.recipe__info {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--lm-space-6) var(--lm-space-3) var(--lm-space-3);
  background: linear-gradient(to top, var(--lm-color-scrim), transparent);
  font-size: var(--lm-font-size-xs);
}

.recipe__info strong {
  font-size: var(--lm-font-size-sm);
}

@media (max-width: 720px) {
  .recipes__toolbar {
    padding: var(--lm-space-4) var(--lm-space-3) var(--lm-space-2);
  }

  .recipes__hint {
    margin: 0 var(--lm-space-3) var(--lm-space-3);
  }
}
</style>
