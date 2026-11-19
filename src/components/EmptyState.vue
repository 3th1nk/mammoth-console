<script setup lang="ts">
/** 全站统一空态（替代 el-empty）：表格/列表无数据时的一种写法。 */
withDefaults(defineProps<{ description?: string }>(), { description: '暂无数据' })
</script>

<template>
  <div class="flex flex-col items-center justify-center px-4 py-12 text-center">
    <p class="text-sm text-muted-foreground">{{ description }}</p>
    <slot />
  </div>
</template>
