<script setup lang="ts">
/** el-descriptions 的替代：N 列 label/value 网格，细边框卡片观感。 */
withDefaults(defineProps<{ columns?: number; bordered?: boolean }>(), {
  columns: 4,
  bordered: true,
})
</script>

<template>
  <div
    class="grid items-start gap-x-8 gap-y-3.5 p-4 text-sm"
    :class="bordered ? 'rounded-lg border' : ''"
    :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
  >
    <slot />
  </div>
</template>
