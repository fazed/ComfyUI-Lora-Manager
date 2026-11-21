<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from '@/components/AppSidebar.vue'
import TopBar from '@/components/TopBar.vue'
import ToastHost from '@/components/ToastHost.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import NodePickerDialog from '@/components/NodePickerDialog.vue'
import { useTheme } from '@/composables/useTheme'
import { useSearch } from '@/composables/useSearch'
import { t } from '@/i18n'

useTheme()
const route = useRoute()
const search = useSearch()
const navOpen = ref(false)

const pageTitle = computed(() => (route.meta.title ? t(route.meta.title) : t('app.title')))

watch(
  () => route.name,
  () => {
    navOpen.value = false
    search.clear()
  },
)

watch(
  pageTitle,
  (title) => {
    document.title = `${title} - ${t('app.title')}`
  },
  { immediate: true },
)
</script>

<template>
  <a
    class="absolute -top-[100px] left-2 z-100 rounded-sm bg-accent px-3 py-2 text-on-accent focus:top-2"
    href="#main-content"
  >
    {{ t('app.skipToContent') }}
  </a>
  <div class="grid h-full grid-cols-[var(--lm-sidebar-width)_minmax(0,1fr)] tablet:grid-cols-[minmax(0,1fr)]">
    <!-- Below the tablet breakpoint the sidebar becomes an off-canvas panel. -->
    <AppSidebar
      class="tablet:fixed tablet:inset-y-0 tablet:left-0 tablet:z-40 tablet:w-[min(var(--lm-sidebar-width),85vw)] tablet:shadow-lg tablet:transition-transform tablet:duration-(--lm-motion-normal) tablet:ease-standard"
      :class="navOpen ? '' : 'tablet:-translate-x-full'"
      @navigate="navOpen = false"
    />
    <div
      v-if="navOpen"
      class="hidden tablet:fixed tablet:inset-0 tablet:z-30 tablet:block tablet:bg-overlay"
      aria-hidden="true"
      @click="navOpen = false"
    ></div>
    <div class="flex min-h-0 min-w-0 flex-col">
      <TopBar :nav-open="navOpen" @toggle-nav="navOpen = !navOpen" />
      <main id="main-content" class="relative flex min-h-0 flex-1 flex-col overflow-hidden focus:outline-none" tabindex="-1">
        <!-- Keyed by route name: the library page component is shared by several routes. -->
        <RouterView v-slot="{ Component, route: current }">
          <component :is="Component" :key="String(current.name)" />
        </RouterView>
      </main>
    </div>
  </div>
  <ToastHost />
  <ConfirmDialog />
  <NodePickerDialog />
</template>
