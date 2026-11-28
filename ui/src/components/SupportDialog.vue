<script setup lang="ts">
/** Support (rail): where to report issues and how to support the project (plain external links). */
import AppIcon, { type IconName } from './AppIcon.vue'
import ModalShell from './ModalShell.vue'
import { t, type MessageKey } from '@/i18n'

const emit = defineEmits<{ close: [] }>()

const LINKS: { label: MessageKey; href: string; icon: IconName }[] = [
  { label: 'support.issue', href: 'https://github.com/willmiao/ComfyUI-Lora-Manager/issues/new', icon: 'alert' },
  { label: 'support.discord', href: 'https://discord.gg/vcqNrWVFvM', icon: 'external' },
  { label: 'support.kofi', href: 'https://ko-fi.com/pixelpawsai', icon: 'heart' },
  { label: 'support.patreon', href: 'https://patreon.com/PixelPawsAI', icon: 'heart' },
  { label: 'support.civitai', href: 'https://civitai.com/user/PixelPawsAI', icon: 'external' },
  { label: 'support.youtube', href: 'https://www.youtube.com/@pixelpaws-ai', icon: 'play' },
]
</script>

<template>
  <ModalShell :title="t('support.title')" title-id="support-dialog-title" @close="emit('close')">
    <div class="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5">
      <p class="text-sm text-muted">{{ t('support.intro') }}</p>
      <ul class="flex flex-col gap-2">
        <li v-for="link in LINKS" :key="link.href">
          <a
            :href="link.href"
            target="_blank"
            rel="noopener noreferrer"
            class="flex min-h-control items-center gap-3 rounded-md hairline border-border bg-surface px-3 py-2 text-fg no-underline hover:bg-sunken phone:min-h-touch"
          >
            <AppIcon :name="link.icon" :size="16" class="flex-none text-muted" />
            <span class="min-w-0 flex-1 font-medium">{{ t(link.label) }}</span>
            <AppIcon name="external" :size="15" class="flex-none text-muted" />
          </a>
        </li>
      </ul>
    </div>
  </ModalShell>
</template>
