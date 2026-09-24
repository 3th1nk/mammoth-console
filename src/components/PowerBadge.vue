<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ state: string }>()

const style = computed(() => {
  switch (props.state) {
    case 'on':
      return { label: '运行中', type: 'success' as const }
    case 'off':
      return { label: '已关机', type: 'info' as const }
    default:
      return { label: '电源未知', type: 'warning' as const }
  }
})
</script>

<template>
  <el-tag :type="style.type" effect="plain" size="small" disable-transitions>
    {{ style.label }}
  </el-tag>
</template>
