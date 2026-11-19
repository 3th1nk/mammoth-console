<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { powerStyle, toneBadgeStyle } from '@/utils/stateColors'

/** 电源状态徽章（BMC power_state）。 */
const props = defineProps<{ state: string }>()

const { t } = useI18n()
const style = computed(() => powerStyle(props.state))
const badgeStyle = computed(() => toneBadgeStyle(style.value.tone))
</script>

<template>
  <Badge variant="outline" class="rounded-md font-medium" :style="badgeStyle">
    {{ t(style.labelKey) }}
  </Badge>
</template>
