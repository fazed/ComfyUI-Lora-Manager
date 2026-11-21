<script setup lang="ts">
import PageShell from '@/components/PageShell.vue'
import StateBlock from '@/components/StateBlock.vue'
import { t } from '@/i18n'
</script>

<template>
  <PageShell :title="t('notFound.title')">
    <StateBlock kind="empty" icon="search" :title="t('notFound.body')">
      <RouterLink class="lm-btn lm-btn--primary" to="/loras">{{ t('notFound.home') }}</RouterLink>
    </StateBlock>
  </PageShell>
</template>
