<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { JOB_SUMMARY_SEGMENTS, TONE_COLOR } from '@/utils/stateColors'

/**
 * job.summary 的分段进度条 + 计数（docs/03-product-design.md §7.5）。
 * 分段顺序与色彩来自 stateColors 单一来源。
 */
const props = withDefaults(
  defineProps<{
    summary: {
      total: number
      pending?: number
      running?: number
      succeeded?: number
      failed?: number
      interrupted?: number
      canceled?: number
    }
    compact?: boolean
  }>(),
  { compact: false },
)

const { t } = useI18n()

const parts = computed(() =>
  JOB_SUMMARY_SEGMENTS.map((s) => ({
    ...s,
    color: TONE_COLOR[s.tone],
    count: props.summary[s.key] ?? 0,
  })).filter((s) => s.count > 0),
)
</script>

<template>
  <div>
    <div class="flex overflow-hidden rounded-full bg-muted" :class="compact ? 'h-1.5' : 'h-2.5'">
      <div
        v-for="p in parts"
        :key="p.key"
        class="border-r border-background last:border-r-0"
        :style="{ width: `${(p.count / Math.max(summary.total, 1)) * 100}%`, background: p.color }"
        :title="`${t(p.labelKey)} ${p.count}`"
      />
    </div>
    <div v-if="!compact" class="mt-1.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
      <span v-for="p in parts" :key="p.key" class="inline-flex items-center gap-1.5">
        <i class="inline-block size-2 rounded-full" :style="{ background: p.color }" />
        {{ t(p.labelKey) }} {{ p.count }}
      </span>
      <span v-if="parts.length === 0">{{ t('states.sumTotal', { n: summary.total }) }}</span>
    </div>
  </div>
</template>
