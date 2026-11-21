<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from '@/components/AppSidebar.vue'
import TopBar from '@/components/TopBar.vue'
import ToastHost from '@/components/ToastHost.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
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
  <a class="skip-link" href="#main-content">{{ t('app.skipToContent') }}</a>
  <div class="shell" :class="{ 'shell--nav-open': navOpen }">
    <AppSidebar class="shell__sidebar" @navigate="navOpen = false" />
    <div v-if="navOpen" class="shell__backdrop" aria-hidden="true" @click="navOpen = false"></div>
    <div class="shell__main">
      <TopBar :nav-open="navOpen" @toggle-nav="navOpen = !navOpen" />
      <main id="main-content" class="shell__content" tabindex="-1">
        <!-- Keyed by route name: the library page component is shared by several routes. -->
        <RouterView v-slot="{ Component, route: current }">
          <component :is="Component" :key="String(current.name)" />
        </RouterView>
      </main>
    </div>
  </div>
  <ToastHost />
  <ConfirmDialog />
</template>

<style scoped>
.skip-link {
  position: absolute;
  left: var(--lm-space-2);
  top: -100px;
  z-index: 100;
  padding: var(--lm-space-2) var(--lm-space-3);
  border-radius: var(--lm-radius-sm);
  background: var(--lm-color-accent);
  color: var(--lm-color-on-accent);
}

.skip-link:focus {
  top: var(--lm-space-2);
}

.shell {
  display: grid;
  grid-template-columns: var(--lm-sidebar-width) minmax(0, 1fr);
  height: 100%;
}

.shell__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.shell__content {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.shell__content:focus {
  outline: none;
}

.shell__backdrop {
  display: none;
}

@media (max-width: 900px) {
  .shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .shell__sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 40;
    width: min(var(--lm-sidebar-width), 85vw);
    transform: translateX(-100%);
    transition: transform var(--lm-motion-normal) var(--lm-ease);
    box-shadow: var(--lm-shadow-lg);
  }

  .shell--nav-open .shell__sidebar {
    transform: none;
  }

  .shell__backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 30;
    background: var(--lm-color-overlay);
  }
}
</style>
