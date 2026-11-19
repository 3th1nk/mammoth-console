<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { stateStyle, toneBadgeStyle } from '@/utils/stateColors'

/**
 * 全局状态徽章：machine / job / task 三类状态机的统一呈现
 * （文案 key 指向 locales states 域，色彩收口 stateColors）。
 */
const props = defineProps<{
  state: string
  kind: 'machine' | 'job' | 'task'
}>()

const { t } = useI18n()
const style = computed(() => stateStyle(props.kind, props.state))
const badgeStyle = computed(() => toneBadgeStyle(style.value.tone))
</script>

<template>
  <Badge variant="outline" class="rounded-md font-medium" :style="badgeStyle">
    {{ t(style.labelKey) }}
  </Badge>
</template>
