<script setup lang="ts">
/**
 * Help (rail): the keyboard shortcuts from config/shortcuts.ts, grouped by
 * where they work, and links to the wiki guides (plain external links).
 */
import AppIcon from './AppIcon.vue'
import ModalShell from './ModalShell.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SHORTCUT_SCOPES, SHORTCUTS } from '@/config/shortcuts'
import { t, type MessageKey } from '@/i18n'

const emit = defineEmits<{ close: [] }>()

const WIKI = 'https://github.com/willmiao/ComfyUI-Lora-Manager/wiki'
const DOCS: { label: MessageKey; href: string }[] = [
  { label: 'help.doc.wiki', href: WIKI },
  { label: 'help.doc.gettingStarted', href: `${WIKI}/Getting-Started` },
  { label: 'help.doc.library', href: `${WIKI}/Model-Library` },
  { label: 'help.doc.downloading', href: `${WIKI}/Downloading-and-Organizing-Models` },
  { label: 'help.doc.recipes', href: `${WIKI}/Recipes-Feature-Tutorial-%E2%80%93-ComfyUI-LoRA-Manager` },
  { label: 'help.doc.comfyui', href: `${WIKI}/ComfyUI-Integration` },
  { label: 'help.doc.syntax', href: `${WIKI}/LoRA-Syntax-and-Duplicate-Filenames` },
  { label: 'help.doc.configuration', href: `${WIKI}/Configuration` },
  { label: 'help.doc.extension', href: `${WIKI}/LoRA-Manager-Civitai-Extension-(Chrome-Extension)` },
  { label: 'help.doc.troubleshooting', href: `${WIKI}/Troubleshooting-Tips` },
  { label: 'help.doc.faq', href: `${WIKI}/FAQ-(Frequently-Asked-Questions)` },
  { label: 'help.doc.releases', href: 'https://github.com/willmiao/ComfyUI-Lora-Manager/releases' },
]

const groups = SHORTCUT_SCOPES.map((group) => ({
  ...group,
  shortcuts: Object.values(SHORTCUTS).filter((entry) => entry.scope === group.scope),
}))
</script>

<template>
  <ModalShell :title="t('help.title')" title-id="help-dialog-title" wide @close="emit('close')">
    <Tabs default-value="shortcuts" class="min-h-0 flex-1 px-5 pb-5">
      <TabsList :aria-label="t('help.tabs')">
        <TabsTrigger value="shortcuts">{{ t('help.shortcuts') }}</TabsTrigger>
        <TabsTrigger value="docs">{{ t('help.docs') }}</TabsTrigger>
      </TabsList>
      <TabsContent value="shortcuts" class="flex min-h-0 flex-col gap-5 overflow-y-auto pt-4">
        <section v-for="group in groups" :key="group.scope" class="flex flex-col gap-2" :aria-labelledby="`help-scope-${group.scope}`">
          <h3 :id="`help-scope-${group.scope}`" class="lm-overline">{{ t(group.label) }}</h3>
          <dl class="grid grid-cols-[minmax(8rem,max-content)_1fr] items-center gap-x-4 gap-y-2 text-sm phone:grid-cols-1 phone:gap-y-1">
            <template v-for="entry in group.shortcuts" :key="entry.label">
              <dt class="flex flex-wrap items-center gap-1">
                <template v-for="(key, index) in entry.keys" :key="key">
                  <span v-if="index" class="text-xs text-muted">{{ t('shortcuts.or') }}</span>
                  <kbd class="rounded-sm hairline border-border-strong bg-sunken px-2 font-mono text-xs">{{ key }}</kbd>
                </template>
              </dt>
              <dd class="phone:mb-2">{{ t(entry.label) }}</dd>
            </template>
          </dl>
        </section>
      </TabsContent>
      <TabsContent value="docs" class="flex min-h-0 flex-col gap-3 overflow-y-auto pt-4">
        <p class="lm-hint">{{ t('help.docsIntro') }}</p>
        <ul class="flex flex-col gap-1">
          <li v-for="doc in DOCS" :key="doc.href">
            <a :href="doc.href" target="_blank" rel="noopener noreferrer" class="lm-row flex min-h-control items-center gap-3 px-3 text-fg no-underline phone:min-h-touch">
              <span class="min-w-0 flex-1">{{ t(doc.label) }}</span>
              <AppIcon name="external" :size="15" class="flex-none text-muted" />
            </a>
          </li>
        </ul>
      </TabsContent>
    </Tabs>
  </ModalShell>
</template>
