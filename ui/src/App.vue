<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppRail from '@/components/AppRail.vue'
import ConnectionBanner from '@/components/ConnectionBanner.vue'
import StatusBar from '@/components/StatusBar.vue'
import ToastHost from '@/components/ToastHost.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ReplaceChoiceDialog from '@/components/ReplaceChoiceDialog.vue'
import NodePickerDialog from '@/components/NodePickerDialog.vue'
import { useTheme } from '@/composables/useTheme'
import { useAppearance } from '@/composables/useAppearance'
import { useRefreshHost } from '@/composables/useRefresh'
import { t } from '@/i18n'

useTheme()
useAppearance()
// `r` refreshes the current page; opted-in pages refresh silently after the tab was hidden for a while.
useRefreshHost()
const route = useRoute()

// Route change (not a tab/query change inside a page): move focus to <main> when it was on
// the rail or nowhere, so the skip link / keyboard users start at the new page.
watch(
  () => route.name,
  async (_name, previous) => {
    if (previous === undefined) return
    await nextTick()
    const active = document.activeElement
    if (!active || active === document.body || active.closest('nav')) document.getElementById('main-content')?.focus({ preventScroll: true })
  },
)

const pageTitle = computed(() => (route.meta.title ? t(route.meta.title) : t('app.title')))

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
  <!-- Icon rail | page, status bar along the bottom. On phones the rail is a bottom bar (column-reverse). -->
  <div class="flex h-full min-w-0 flex-col">
    <div class="flex min-h-0 flex-1 phone:flex-col-reverse">
      <AppRail />
      <main id="main-content" :data-layout="route.meta.layout" class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden focus:outline-none" tabindex="-1">
        <ConnectionBanner />
        <!-- Keyed by route name: the library page component is shared by several routes. -->
        <RouterView v-slot="{ Component, route: current }">
          <component :is="Component" :key="String(current.name)" />
        </RouterView>
      </main>
    </div>
    <StatusBar />
  </div>
  <ToastHost />
  <ConfirmDialog />
  <ReplaceChoiceDialog />
  <NodePickerDialog />
</template>
