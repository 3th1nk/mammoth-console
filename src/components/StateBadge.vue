<script setup lang="ts">
import { computed } from 'vue'

/**
 * 全局状态徽章：machine / job / task 三类状态机的统一呈现
 * （文案与视觉映射见 docs/03-product-design.md §6.1）。
 */
const props = defineProps<{
  state: string
  kind: 'machine' | 'job' | 'task'
}>()

interface Style {
  label: string
  type: 'success' | 'warning' | 'danger' | 'info' | 'primary'
}

const MAP: Record<string, Record<string, Style>> = {
  machine: {
    registering: { label: '注册中', type: 'info' },
    discovering: { label: '盘查中', type: 'primary' },
    ready: { label: '就绪', type: 'success' },
    error: { label: '异常', type: 'danger' },
  },
  job: {
    pending: { label: '排队中', type: 'info' },
    running: { label: '执行中', type: 'primary' },
    succeeded: { label: '全部成功', type: 'success' },
    partial: { label: '部分成功', type: 'warning' },
    failed: { label: '失败', type: 'danger' },
    canceled: { label: '已取消', type: 'info' },
  },
  task: {
    pending: { label: '排队中', type: 'info' },
    running: { label: '执行中', type: 'primary' },
    succeeded: { label: '成功', type: 'success' },
    failed: { label: '失败', type: 'danger' },
    canceled: { label: '已取消', type: 'info' },
    interrupted: { label: '中断可续跑', type: 'warning' },
  },
}

const style = computed<Style>(
  () =>
    MAP[props.kind]?.[props.state] ?? { label: props.state, type: 'info' },
)
</script>

<template>
  <el-tag :type="style.type" effect="light" size="small" disable-transitions>
    {{ style.label }}
  </el-tag>
</template>
