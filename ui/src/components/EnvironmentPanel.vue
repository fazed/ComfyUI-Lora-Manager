<script setup lang="ts">
/** Versions of LoRA Manager, ComfyUI, Python, OS and browser (GET /environment, read-only) with a Markdown copy. */
import { onMounted, shallowRef } from 'vue'
import { doctorApi } from '@/api/maintenance'
import { copyText, useToasts } from '@/composables/useFeedback'
import { environmentMarkdown, normaliseEnvironment, type EnvironmentInfo } from '@/utils/maintenance'
import { t } from '@/i18n'

const toasts = useToasts()
const env = shallowRef<EnvironmentInfo | null>(null)
const browser = typeof navigator === 'undefined' ? '' : navigator.userAgent

onMounted(async () => {
  try {
    env.value = normaliseEnvironment(await doctorApi.environment())
  } catch {
    env.value = normaliseEnvironment({})
  }
})

async function copy(): Promise<void> {
  if (!env.value) return
  const ok = await copyText(environmentMarkdown(env.value, browser))
  if (ok) toasts.success(t('doctor.envCopied'))
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      <template v-for="row in [
        ['about.app', env?.app],
        ['about.comfyui', env?.comfyui],
        ['about.frontend', env?.frontend],
        ['about.python', env?.python],
        ['about.os', env?.platform],
        ['about.browser', browser],
      ] as const" :key="row[0]">
        <dt class="text-muted">{{ t(row[0]) }}</dt>
        <dd class="min-w-0 wrap-anywhere font-mono text-xs leading-normal">{{ row[1] ?? '—' }}</dd>
      </template>
    </dl>
    <button type="button" class="lm-btn lm-btn--sm self-start" :disabled="!env" @click="copy">{{ t('doctor.copyEnv') }}</button>
  </div>
</template>
