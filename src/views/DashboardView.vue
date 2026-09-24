<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import * as echarts from 'echarts'
import { Refresh } from '@element-plus/icons-vue'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import StateBadge from '@/components/StateBadge.vue'
import { formatTime } from '@/utils/format'

const MACHINES_STATS_PAGE = 200

const machinesQuery = useQuery({
  queryKey: ['dashboard', 'machines'],
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/machines', {
        params: { query: { page_size: MACHINES_STATS_PAGE } },
      }),
    ),
})
const pendingQuery = useQuery({
  queryKey: ['dashboard', 'pending'],
  queryFn: async () => unwrap(await getClient().GET('/api/v1/pending-machines')),
})
const runningJobsQuery = useQuery({
  queryKey: ['dashboard', 'jobs-running'],
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/jobs', {
        params: { query: { state: 'running', page_size: 100 } },
      }),
    ),
})
const failedJobsQuery = useQuery({
  queryKey: ['dashboard', 'jobs-failed'],
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/jobs', {
        params: { query: { state: 'failed', page_size: 5 } },
      }),
    ),
})

const machines = computed(() => machinesQuery.data.value?.items ?? [])
const stateCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  for (const m of machines.value) counts[m.state] = (counts[m.state] ?? 0) + 1
  return counts
})
const truncated = computed(() => !!machinesQuery.data.value?.next_cursor)

const STATE_COLORS: Record<string, string> = {
  ready: '#67c23a',
  discovering: '#409eff',
  registering: '#909399',
  error: '#f56c6c',
}

const JOB_TYPE_LABEL: Record<string, string> = {
  install: '装机',
  power: '电源',
  discover: '盘查',
}

function refetchAll() {
  machinesQuery.refetch()
  pendingQuery.refetch()
  runningJobsQuery.refetch()
  failedJobsQuery.refetch()
}

const loadError = computed(() => {
  for (const q of [machinesQuery, pendingQuery, runningJobsQuery, failedJobsQuery]) {
    if (q.error.value) return errorMessage(q.error.value)
  }
  return null
})

const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

function renderChart() {
  if (!chartEl.value) return
  chart ??= echarts.init(chartEl.value)
  const data = Object.entries(stateCounts.value).map(([name, value]) => ({
    name,
    value,
    itemStyle: { color: STATE_COLORS[name] ?? '#909399' },
  }))
  chart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, icon: 'circle' },
    series: [
      {
        type: 'pie',
        radius: ['52%', '78%'],
        label: { show: false },
        data: data.length > 0 ? data : [{ name: '暂无机器', value: 1, itemStyle: { color: '#e4e7ed' } }],
      },
    ],
  })
}

watch(stateCounts, renderChart, { deep: true })
onMounted(renderChart)
onUnmounted(() => {
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">总览</h1>
      <el-button :icon="Refresh" @click="refetchAll">刷新</el-button>
    </div>

    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon class="mb" />

    <el-row :gutter="14" class="mb">
      <el-col :span="6">
        <el-card shadow="never">
          <el-statistic title="机器（已注册）" :value="machines.length" />
          <div v-if="truncated" class="text-muted stat-note">仅统计最近 {{ MACHINES_STATS_PAGE }} 台</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <el-statistic title="待认领（零注册）" :value="pendingQuery.data.value?.items.length ?? 0" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <el-statistic title="进行中任务" :value="runningJobsQuery.data.value?.items.length ?? 0" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <el-statistic title="最近失败任务" :value="failedJobsQuery.data.value?.items.length ?? 0" />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="14">
      <el-col :span="12">
        <el-card shadow="never" header="机器状态分布">
          <div ref="chartEl" class="donut" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never" header="进行中的任务">
          <el-table :data="runningJobsQuery.data.value?.items ?? []" size="small">
            <el-table-column label="类型" width="90">
              <template #default="{ row }">{{ JOB_TYPE_LABEL[row.type] ?? row.type }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }"><StateBadge kind="job" :state="row.state" /></template>
            </el-table-column>
            <el-table-column label="目标机器" width="90">
              <template #default="{ row }">{{ row.machine_ids?.length ?? row.summary?.total ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="创建时间">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
            <template #empty>当前没有进行中的任务</template>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.mb {
  margin-bottom: 14px;
}
.donut {
  height: 240px;
}
.stat-note {
  font-size: 12px;
  margin-top: 4px;
}
</style>
