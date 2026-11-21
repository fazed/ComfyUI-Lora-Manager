<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from './AppIcon.vue'
import ThemeMenu from './ThemeMenu.vue'
import { useSearch } from '@/composables/useSearch'
import { useDownloadQueue } from '@/composables/useDownloadQueue'
import { t } from '@/i18n'

defineProps<{ navOpen: boolean }>()
defineEmits<{ 'toggle-nav': [] }>()

const route = useRoute()
const { query } = useSearch()
const { active, waiting, paused, worker } = useDownloadQueue(5000)

const searchable = computed(() => !!route.meta.searchable)
const placeholder = computed(() =>
  t('topbar.searchPlaceholder', { section: route.meta.title ? t(route.meta.title).toLowerCase() : '' }),
)
const busy = computed(() => active.value.length + waiting.value.length > 0)
const queueLabel = computed(() =>
  paused.value
    ? t('topbar.queuePaused')
    : t('topbar.queue', { active: active.value.length, queued: waiting.value.length }),
)
</script>

<template>
  <header class="flex h-topbar flex-none items-center gap-3 hairline-b border-border bg-surface px-6 tablet:px-3">
    <button
      type="button"
      class="lm-btn lm-btn--ghost lm-btn--icon hidden tablet:inline-flex"
      :aria-label="t('nav.toggle')"
      :aria-expanded="navOpen"
      @click="$emit('toggle-nav')"
    >
      <AppIcon name="menu" />
    </button>

    <div class="relative max-w-[560px] flex-1" role="search">
      <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      <label class="sr-only" for="global-search">{{ t('topbar.search') }}</label>
      <input
        id="global-search"
        v-model="query"
        class="lm-input border-transparent bg-sunken pl-[calc(var(--lm-space-3)*2+18px)] disabled:opacity-60"
        type="search"
        autocomplete="off"
        :placeholder="searchable ? placeholder : t('topbar.search')"
        :disabled="!searchable"
      />
    </div>

    <div class="ml-auto flex items-center gap-1">
      <RouterLink
        to="/downloads"
        class="lm-btn lm-btn--ghost relative"
        :class="paused ? 'text-warning' : busy ? 'text-accent' : 'text-muted'"
        :aria-label="queueLabel"
        :title="queueLabel"
      >
        <AppIcon :name="paused ? 'pause' : 'download'" />
        <span v-if="busy" class="text-xs tabular-nums">{{ active.length }}/{{ active.length + waiting.length }}</span>
        <span v-if="worker?.rate_limited" class="lm-badge lm-badge--warning">!</span>
      </RouterLink>
      <ThemeMenu />
    </div>
  </header>
</template>
