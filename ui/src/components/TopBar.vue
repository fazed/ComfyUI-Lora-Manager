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
  <header class="topbar">
    <button
      type="button"
      class="lm-btn lm-btn--ghost lm-btn--icon topbar__nav-toggle"
      :aria-label="t('nav.toggle')"
      :aria-expanded="navOpen"
      @click="$emit('toggle-nav')"
    >
      <AppIcon name="menu" />
    </button>

    <div class="topbar__search" role="search">
      <AppIcon name="search" class="topbar__search-icon" />
      <label class="visually-hidden" for="global-search">{{ t('topbar.search') }}</label>
      <input
        id="global-search"
        v-model="query"
        class="lm-input topbar__search-input"
        type="search"
        autocomplete="off"
        :placeholder="searchable ? placeholder : t('topbar.search')"
        :disabled="!searchable"
      />
    </div>

    <div class="topbar__actions">
      <RouterLink
        to="/downloads"
        class="lm-btn lm-btn--ghost topbar__queue"
        :class="{ 'topbar__queue--busy': busy, 'topbar__queue--paused': paused }"
        :aria-label="queueLabel"
        :title="queueLabel"
      >
        <AppIcon :name="paused ? 'pause' : 'download'" />
        <span v-if="busy" class="topbar__queue-count">{{ active.length }}/{{ active.length + waiting.length }}</span>
        <span v-if="worker?.rate_limited" class="lm-badge lm-badge--warning">!</span>
      </RouterLink>
      <ThemeMenu />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: var(--lm-space-3);
  height: var(--lm-topbar-height);
  padding: 0 var(--lm-space-6);
  border-bottom: var(--lm-border-width) solid var(--lm-color-border);
  background: var(--lm-color-surface);
  flex: none;
}

.topbar__nav-toggle {
  display: none;
}

.topbar__search {
  position: relative;
  flex: 1;
  max-width: 560px;
}

.topbar__search-icon {
  position: absolute;
  left: var(--lm-space-3);
  top: 50%;
  transform: translateY(-50%);
  color: var(--lm-color-muted);
  pointer-events: none;
}

.topbar__search-input {
  padding-left: calc(var(--lm-space-3) * 2 + 18px);
  background: var(--lm-color-sunken);
  border-color: transparent;
}

.topbar__search-input:disabled {
  opacity: 0.6;
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: var(--lm-space-1);
  margin-left: auto;
}

.topbar__queue {
  position: relative;
  color: var(--lm-color-muted);
}

.topbar__queue--busy {
  color: var(--lm-color-accent);
}

.topbar__queue--paused {
  color: var(--lm-color-warning);
}

.topbar__queue-count {
  font-size: var(--lm-font-size-xs);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  .topbar {
    padding: 0 var(--lm-space-3);
  }

  .topbar__nav-toggle {
    display: inline-flex;
  }
}
</style>
