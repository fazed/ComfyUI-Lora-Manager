<script setup lang="ts">
import AppIcon, { type IconName } from './AppIcon.vue'
import { useDownloadQueue } from '@/composables/useDownloadQueue'
import { t, type MessageKey } from '@/i18n'
import { withMountPrefix } from '@/utils/basePath'

defineEmits<{ navigate: [] }>()

interface NavItem {
  to: string
  label: MessageKey
  icon: IconName
}

const primary: NavItem[] = [
  { to: '/loras', label: 'nav.loras', icon: 'layers' },
  { to: '/checkpoints', label: 'nav.checkpoints', icon: 'box' },
  { to: '/embeddings', label: 'nav.embeddings', icon: 'type' },
  { to: '/recipes', label: 'nav.recipes', icon: 'book' },
]

const secondary: NavItem[] = [
  { to: '/downloads', label: 'nav.downloads', icon: 'download' },
  { to: '/settings', label: 'nav.settings', icon: 'settings' },
]

const { active, waiting } = useDownloadQueue(5000)
const classicUrl = withMountPrefix('/loras')
</script>

<template>
  <nav class="sidebar" :aria-label="t('nav.main')">
    <div class="sidebar__brand">
      <span class="sidebar__logo" aria-hidden="true"><AppIcon name="layers" :size="20" /></span>
      <span>{{ t('app.title') }}</span>
    </div>
    <ul class="sidebar__list">
      <li v-for="item in primary" :key="item.to">
        <RouterLink :to="item.to" class="sidebar__link" active-class="is-active" @click="$emit('navigate')">
          <AppIcon :name="item.icon" />
          <span>{{ t(item.label) }}</span>
        </RouterLink>
      </li>
    </ul>
    <ul class="sidebar__list">
      <li v-for="item in secondary" :key="item.to">
        <RouterLink :to="item.to" class="sidebar__link" active-class="is-active" @click="$emit('navigate')">
          <AppIcon :name="item.icon" />
          <span>{{ t(item.label) }}</span>
          <span v-if="item.to === '/downloads' && active.length + waiting.length > 0" class="sidebar__count">
            {{ active.length + waiting.length }}
          </span>
        </RouterLink>
      </li>
    </ul>
    <div class="sidebar__spacer"></div>
    <a class="sidebar__link sidebar__link--muted" :href="classicUrl">
      <AppIcon name="external" />
      <span>{{ t('nav.classic') }}</span>
    </a>
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--lm-space-4);
  height: 100%;
  padding: var(--lm-space-4) var(--lm-space-3);
  border-right: var(--lm-border-width) solid var(--lm-color-border);
  background: var(--lm-color-surface);
  overflow-y: auto;
}

.sidebar__brand {
  display: flex;
  align-items: center;
  gap: var(--lm-space-2);
  padding: 0 var(--lm-space-2);
  min-height: calc(var(--lm-topbar-height) - var(--lm-space-4) * 2);
  font-weight: var(--lm-font-weight-bold);
  font-size: var(--lm-font-size-lg);
}

.sidebar__logo {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--lm-radius-sm);
  background: var(--lm-color-accent);
  color: var(--lm-color-on-accent);
}

.sidebar__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sidebar__link {
  display: flex;
  align-items: center;
  gap: var(--lm-space-3);
  min-height: var(--lm-control-height);
  padding: 0 var(--lm-space-3);
  border-radius: var(--lm-radius-sm);
  color: var(--lm-color-muted);
  font-weight: var(--lm-font-weight-medium);
  text-decoration: none;
  transition: background var(--lm-motion-fast) var(--lm-ease);
}

.sidebar__link:hover {
  background: var(--lm-color-sunken);
  color: var(--lm-color-text);
}

.sidebar__link.is-active {
  background: var(--lm-color-accent-soft);
  color: var(--lm-color-accent);
}

.sidebar__count {
  margin-left: auto;
  padding: 0 var(--lm-space-2);
  border-radius: var(--lm-radius-pill);
  background: var(--lm-color-accent);
  color: var(--lm-color-on-accent);
  font-size: var(--lm-font-size-xs);
}

.sidebar__spacer {
  flex: 1;
}

.sidebar__link--muted {
  font-size: var(--lm-font-size-sm);
}
</style>
