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
const linkClass =
  'lm-row lm-row--nav flex min-h-control items-center gap-3 px-3 font-medium no-underline transition-[background]'
</script>

<template>
  <nav class="flex h-full flex-col gap-4 overflow-y-auto hairline-r border-border bg-surface px-3 py-4" :aria-label="t('nav.main')">
    <div class="flex min-h-[calc(var(--lm-topbar-height)-var(--lm-space-4)*2)] items-center gap-2 px-2 text-lg font-bold">
      <span class="inline-grid size-[32px] place-items-center rounded-sm bg-accent text-on-accent" aria-hidden="true">
        <AppIcon name="layers" :size="20" />
      </span>
      <span>{{ t('app.title') }}</span>
    </div>
    <ul v-for="(group, index) in [primary, secondary]" :key="index" class="flex flex-col gap-[2px]">
      <li v-for="item in group" :key="item.to">
        <RouterLink :to="item.to" :class="linkClass" active-class="is-selected" @click="$emit('navigate')">
          <AppIcon :name="item.icon" />
          <span>{{ t(item.label) }}</span>
          <span
            v-if="item.to === '/downloads' && active.length + waiting.length > 0"
            class="ml-auto rounded-pill bg-accent px-2 text-xs text-on-accent"
          >
            {{ active.length + waiting.length }}
          </span>
        </RouterLink>
      </li>
    </ul>
    <div class="flex-1"></div>
    <a :class="[linkClass, 'text-sm']" :href="classicUrl">
      <AppIcon name="external" />
      <span>{{ t('nav.classic') }}</span>
    </a>
  </nav>
</template>
