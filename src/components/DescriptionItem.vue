<script setup lang="ts">
/** el-descriptions-item 的替代：小字 label + 内容值。 */
withDefaults(defineProps<{ label: string; mono?: boolean }>(), { mono: false })
</script>

<template>
  <div class="min-w-0">
    <dt class="text-xs text-muted-foreground">{{ label }}</dt>
    <dd class="mt-1 break-words leading-relaxed" :class="mono ? 'font-mono text-xs' : 'text-sm'">
      <slot />
    </dd>
  </div>
</template>
