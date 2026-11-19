<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { stateStyle, toneBadgeStyle } from '@/utils/stateColors'

/**
 * 全局状态徽章：machine / job / task 三类状态机的统一呈现
 * （文案与色彩映射收口到 utils/stateColors.ts）。
 */
const props = defineProps<{
  state: string
  kind: 'machine' | 'job' | 'task'
}>()

const style = computed(() => stateStyle(props.kind, props.state))
const badgeStyle = computed(() => toneBadgeStyle(style.value.tone))
</script>

<template>
  <Badge variant="outline" class="rounded-md font-medium" :style="badgeStyle">
    {{ style.label }}
  </Badge>
</template>
