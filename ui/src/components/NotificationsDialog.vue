<script setup lang="ts">
/**
 * Notifications (rail): the installed LoRA Manager version with the
 * user-started update check, and this session's messages (the toast history,
 * kept in memory only).
 */
import { computed, onMounted } from 'vue'
import AppIcon, { type IconName } from './AppIcon.vue'
import ModalShell from './ModalShell.vue'
import VersionCheck from './settings/VersionCheck.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppSettings } from '@/composables/useAppSettings'
import { useToasts, type ToastKind } from '@/composables/useFeedback'
import { formatDateTime } from '@/utils/format'
import { t } from '@/i18n'

const emit = defineEmits<{ close: [] }>()

const { history } = useToasts()
const appSettings = useAppSettings()
const nightly = computed(() => appSettings.settings.value?.update_channel === 'nightly')
onMounted(() => void appSettings.load())

const ICON: Record<ToastKind, IconName> = { info: 'sparkle', success: 'check', warning: 'alert', error: 'alert' }
</script>

<template>
  <ModalShell :title="t('notifications.title')" title-id="notifications-dialog-title" @close="emit('close')">
    <Tabs default-value="updates" class="min-h-0 flex-1 px-5 pb-5">
      <TabsList :aria-label="t('notifications.tabs')">
        <TabsTrigger value="updates">{{ t('notifications.updates') }}</TabsTrigger>
        <TabsTrigger value="messages">{{ t('notifications.messages') }}</TabsTrigger>
      </TabsList>
      <TabsContent value="updates" class="overflow-y-auto pt-4">
        <VersionCheck :nightly="nightly" />
      </TabsContent>
      <TabsContent value="messages" class="flex min-h-0 flex-col gap-3 overflow-y-auto pt-4">
        <p class="lm-hint">{{ t('notifications.messagesIntro') }}</p>
        <p v-if="!history.length" class="text-sm text-muted">{{ t('notifications.empty') }}</p>
        <ul v-else class="flex flex-col">
          <li v-for="entry in history" :key="entry.id" class="flex items-start gap-3 hairline-b border-border py-2 text-sm last:border-b-0">
            <AppIcon :name="ICON[entry.kind]" :size="16" class="mt-px flex-none" :class="entry.kind === 'error' ? 'text-danger' : 'text-muted'" />
            <span class="min-w-0 flex-1 whitespace-pre-line wrap-anywhere">{{ entry.message }}</span>
            <time class="flex-none text-xs text-muted tabular-nums" :datetime="new Date(entry.at).toISOString()">{{ formatDateTime(entry.at) }}</time>
          </li>
        </ul>
      </TabsContent>
    </Tabs>
  </ModalShell>
</template>
