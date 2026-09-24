<script setup lang="ts">
import { computed } from 'vue'

/** job.summary 的分段进度条 + 计数（docs/03-product-design.md §7.5）。 */
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

const SEGMENTS = [
  { key: 'succeeded', label: '成功', color: '#67c23a' },
  { key: 'running', label: '执行中', color: '#409eff' },
  { key: 'pending', label: '排队', color: '#c0c4cc' },
  { key: 'interrupted', label: '中断', color: '#e6a23c' },
  { key: 'failed', label: '失败', color: '#f56c6c' },
  { key: 'canceled', label: '取消', color: '#a8abb2' },
] as const

const parts = computed(() =>
  SEGMENTS.map((s) => ({
    ...s,
    count: props.summary[s.key as keyof typeof props.summary] ?? 0,
  })).filter((s) => s.count > 0),
)
</script>

<template>
  <div class="summary-bar">
    <div class="bar" :class="{ compact }">
      <div
        v-for="p in parts"
        :key="p.key"
        class="seg"
        :style="{ width: `${(p.count / Math.max(summary.total, 1)) * 100}%`, background: p.color }"
        :title="`${p.label} ${p.count}`"
      />
    </div>
    <div v-if="!compact" class="counts">
      <span v-for="p in parts" :key="p.key" class="count">
        <i class="dot" :style="{ background: p.color }" />{{ p.label }} {{ p.count }}
      </span>
      <span v-if="parts.length === 0" class="count text-muted">共 {{ summary.total }} 台</span>
    </div>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  background: var(--el-fill-color);
}
.bar.compact {
  height: 6px;
}
.seg + .seg {
  border-left: 1px solid #fff;
}
.counts {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  flex-wrap: wrap;
}
.count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
</style>
