<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import * as echarts from 'echarts'
import { Refresh, CircleCheck } from '@element-plus/icons-vue'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { useConnectionStore } from '@/stores/connection'
import StateBadge from '@/components/StateBadge.vue'
import { formatTime } from '@/utils/format'

const MACHINES_STATS_PAGE = 200

const conn = useConnectionStore()

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

// ── 开箱向导（首启五步；有成功装机后自动消失） ──────────────────────────────
const dismissed = ref(localStorage.getItem('mammoth.console.onboarding') === 'done')
function dismissOnboarding() {
  dismissed.value = true
  localStorage.setItem('mammoth.console.onboarding', 'done')
}
const credsQuery = useQuery({
  queryKey: ['credentials'],
  queryFn: async () => unwrap(await getClient().GET('/api/v1/credentials')),
})
const imagesAllQuery = useQuery({
  queryKey: ['images'],
  queryFn: async () => unwrap(await getClient().GET('/api/v1/images')),
})
const installJobQuery = useQuery({
  queryKey: ['dashboard', 'install-jobs'],
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/jobs', { params: { query: { type: 'install', page_size: 1 } } })),
})
const hasInstall = computed(() => (installJobQuery.data.value?.items?.length ?? 0) > 0)
const hasImage = computed(() =>
  (imagesAllQuery.data.value?.items ?? []).some((i) => i.state === 'ready'),
)
const hasCred = computed(() => (credsQuery.data.value?.items ?? []).some((c) => c.type === 'bmc'))
const showOnboarding = computed(() => !dismissed.value && !hasInstall.value)
const onboardingSteps = computed(() => [
  {
    done: true,
    title: '连接引擎',
    desc: `已连接 v${conn.capabilities?.version ?? ''}`,
    to: '',
  },
  {
    done: hasCred.value,
    title: '新建 BMC 凭证',
    desc: '带外操作的登录凭据（用户名/密码）',
    to: '/credentials',
  },
  {
    done: hasImage.value,
    title: '注册装机镜像',
    desc: 'http(s) 地址 + SHA256，引擎后台拉取校验',
    to: '/images',
  },
  {
    done: machines.value.length > 0,
    title: '机器就绪',
    desc: '注册机器，或开启零注册等机器自己出现',
    to: '/machines',
  },
  {
    done: hasInstall.value,
    title: '跑第一次装机',
    desc: '机器列表勾选 → 装机 → 四步向导',
    to: '/machines',
  },
])

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

    <el-card v-if="showOnboarding" shadow="never" class="mb onboarding">
      <template #header>
        <div class="ob-head">
          <span>开箱向导 · 五步到第一台装好的机器</span>
          <el-button size="small" text @click="dismissOnboarding">跳过引导</el-button>
        </div>
      </template>
      <div class="ob-steps">
        <div v-for="(st, i) in onboardingSteps" :key="st.title" class="ob-step" :class="{ done: st.done }">
          <el-icon v-if="st.done" class="ob-check"><CircleCheck /></el-icon>
          <span v-else class="ob-num">{{ i }}</span>
          <div class="ob-body">
            <div class="ob-title">{{ st.title }}</div>
            <div class="ob-desc">{{ st.desc }}</div>
          </div>
          <router-link v-if="!st.done && st.to" :to="st.to">
            <el-button size="small" type="primary" plain>前往</el-button>
          </router-link>
        </div>
      </div>
    </el-card>

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
.ob-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ob-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ob-step {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 8px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}
.ob-step.done {
  opacity: 0.65;
}
.ob-check {
  color: #67c23a;
  font-size: 20px;
}
.ob-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #409eff;
  color: #fff;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ob-body {
  flex: 1;
}
.ob-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.ob-desc {
  font-size: 12px;
  color: #909399;
}
.donut {
  height: 240px;
}
.stat-note {
  font-size: 12px;
  margin-top: 4px;
}
</style>
