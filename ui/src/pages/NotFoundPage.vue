<script setup lang="ts">
import StateBlock from '@/components/StateBlock.vue'
import { t } from '@/i18n'
</script>

<template>
  <div class="lm-page">
    <StateBlock kind="empty" icon="search" :title="t('notFound.title')" :message="t('notFound.body')">
      <RouterLink class="lm-btn lm-btn--primary" to="/loras">{{ t('notFound.home') }}</RouterLink>
    </StateBlock>
  </div>
</template>
