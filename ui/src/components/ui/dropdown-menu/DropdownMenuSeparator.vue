<script setup lang="ts">
import type { DropdownMenuSeparatorProps } from 'reka-ui'
import { DropdownMenuSeparator } from 'reka-ui'

const props = defineProps<DropdownMenuSeparatorProps>()
</script>

<template>
  <DropdownMenuSeparator data-slot="dropdown-menu-separator" v-bind="props" class="mx-1 my-1 hairline-t border-border" />
</template>
