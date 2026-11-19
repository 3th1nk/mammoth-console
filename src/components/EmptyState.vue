<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

/** 全站统一空态(替代 el-empty):表格/列表无数据时的一种写法。 */
withDefaults(defineProps<{ description?: string }>(), { description: '' })
</script>

<template>
  <div class="flex flex-col items-center justify-center px-4 py-12 text-center">
    <p class="text-sm text-muted-foreground">{{ description || t('common.empty') }}</p>
    <slot />
  </div>
</template>
