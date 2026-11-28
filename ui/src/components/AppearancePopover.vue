<script setup lang="ts">
/**
 * Appearance (theme, density, text size, highlight colour) from the rail: the
 * shared ThemeOptions in a Popover. Focus moves in on open and back to the
 * rail button on close (both from the primitive).
 */
import AppIcon from './AppIcon.vue'
import ThemeOptions from './ThemeOptions.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n'

defineProps<{ buttonClass: string }>()
</script>

<template>
  <Popover>
    <Tooltip>
      <PopoverTrigger as-child>
        <TooltipTrigger as-child>
          <button type="button" :class="buttonClass" :aria-label="t('rail.appearance')">
            <AppIcon name="palette" :size="20" />
          </button>
        </TooltipTrigger>
      </PopoverTrigger>
      <TooltipContent side="right">{{ t('rail.appearance') }}</TooltipContent>
    </Tooltip>
    <PopoverContent side="right" align="end" :side-offset="8" class="max-h-[calc(100vh-var(--lm-space-6))] w-[20rem] overflow-y-auto" :aria-label="t('rail.appearance')">
      <ThemeOptions />
    </PopoverContent>
  </Popover>
</template>
