<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import * as echarts from 'echarts'
import { CircleCheck, RefreshCcw } from 'lucide-vue-next'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import {
  pendingListKey,
  credentialsKey,
  imagesKey,
  dashboardKey,
} from '@/api/queryKeys'
import { MACHINE_STATE_COLOR, TONE_COLOR } from '@/utils/stateColors'
import { useConnectionStore } from '@/stores/connection'
import { useThemeStore } from '@/stores/theme'
import StateBadge from '@/components/StateBadge.vue'
import EmptyState from '@/components/EmptyState.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTime, formatVersion } from '@/utils/format'

const MACHINES_STATS_PAGE = 200

const conn = useConnectionStore()
const theme = useThemeStore()

const machinesQuery = useQuery({
  queryKey: dashboardKey('machines'),
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/machines', {
        params: { query: { page_size: MACHINES_STATS_PAGE } },
      }),
    ),
})
// key 与侧栏徽标/待认领列表共享（pendingListKey）：一处失效三处联动
const pendingQuery = useQuery({
  queryKey: pendingListKey,
  queryFn: async () => unwrap(await getClient().GET('/api/v1/pending-machines')),
})
const runningJobsQuery = useQuery({
  queryKey: dashboardKey('jobs-running'),
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/jobs', {
        params: { query: { state: 'running', page_size: 100 } },
      }),
    ),
})
const failedJobsQuery = useQuery({
  queryKey: dashboardKey('jobs-failed'),
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
  queryKey: credentialsKey,
  queryFn: async () => unwrap(await getClient().GET('/api/v1/credentials')),
})
const imagesAllQuery = useQuery({
  queryKey: imagesKey,
  queryFn: async () => unwrap(await getClient().GET('/api/v1/images')),
})
const installJobQuery = useQuery({
  queryKey: dashboardKey('install-jobs'),
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
    desc: `已连接 ${formatVersion(conn.capabilities?.version)}`,
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

// ── 状态分布 donut（ECharts） ───────────────────────────────────────────────
const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

/** 从 token 层读当前主题的语义色（oklch 字符串可直接给 canvas）。 */
function tokenColor(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || '#94a3b8'
}

function renderChart() {
  if (!chartEl.value) return
  chart ??= echarts.init(chartEl.value)
  const fgMuted = tokenColor('--muted-foreground')
  const data = Object.entries(stateCounts.value).map(([name, value]) => ({
    name,
    value,
    itemStyle: { color: MACHINE_STATE_COLOR[name] ?? TONE_COLOR.neutral },
  }))
  chart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, icon: 'circle', textStyle: { color: fgMuted, fontSize: 12 } },
    series: [
      {
        type: 'pie',
        radius: ['52%', '78%'],
        label: { show: false },
        data: data.length > 0 ? data : [{ name: '暂无机器', value: 1, itemStyle: { color: fgMuted } }],
      },
    ],
  })
}

watch(stateCounts, renderChart, { deep: true })
// 暗色切换重渲染（图例文字色跟随 token）
watch(
  () => theme.dark,
  () => {
    if (chart) {
      chart.dispose()
      chart = null
      renderChart()
    }
  },
)
onMounted(renderChart)
onUnmounted(() => {
  chart?.dispose()
  chart = null
})

const STATS = computed(() => [
  { label: '机器（已注册）', value: machines.value.length, note: truncated.value ? `仅统计最近 ${MACHINES_STATS_PAGE} 台` : '' },
  { label: '待认领（零注册）', value: pendingQuery.data.value?.items.length ?? 0, note: '' },
  { label: '进行中任务', value: runningJobsQuery.data.value?.items.length ?? 0, note: '' },
  { label: '最近失败任务', value: failedJobsQuery.data.value?.items.length ?? 0, note: '' },
])
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">总览</h2>
        <p class="text-sm text-muted-foreground">机器、待认领与任务概况</p>
      </div>
      <Button variant="outline" size="sm" @click="refetchAll">
        <RefreshCcw class="size-4" /> 刷新
      </Button>
    </div>

    <Alert v-if="loadError" variant="destructive">
      <AlertTitle>{{ loadError }}</AlertTitle>
    </Alert>

    <Card v-if="showOnboarding" class="onboarding">
      <CardHeader>
        <CardTitle class="text-base">开箱向导 · 五步到第一台装好的机器</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" @click="dismissOnboarding">跳过引导</Button>
        </CardAction>
      </CardHeader>
      <CardContent class="flex flex-col gap-2.5">
        <div
          v-for="(st, i) in onboardingSteps"
          :key="st.title"
          class="flex items-center gap-3 rounded-lg border px-3 py-2.5"
          :class="st.done ? 'opacity-60' : ''"
        >
          <CircleCheck v-if="st.done" class="size-5 shrink-0" style="color: #10b981" />
          <span
            v-else
            class="grid size-5 shrink-0 place-items-center rounded-full text-xs text-primary-foreground"
            style="background: oklch(0.554 0.046 257.417)"
          >
            {{ i }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold">{{ st.title }}</div>
            <div class="text-xs text-muted-foreground">{{ st.desc }}</div>
          </div>
          <RouterLink v-if="!st.done && st.to" :to="st.to">
            <Button variant="outline" size="sm">前往</Button>
          </RouterLink>
        </div>
        <Alert
          v-if="!conn.capabilities?.netboot_enabled"
          class="border-amber-500/40 bg-amber-500/5"
        >
          <AlertTitle class="text-amber-700 dark:text-amber-400">
            当前引擎未启用 PXE——零注册走不通，裸机插电不会自己出现在待认领里
          </AlertTitle>
          <AlertDescription>
            要让机器自己出现，需在引擎部署环境设置 MAMMOTH_PXE_ENABLED=true（零注册再加
            MAMMOTH_PXE_ENROLL 与 MAMMOTH_PXE_ENROLL_TOKEN）并重启；否则请用注册对话框或 API
            手动录入机器。
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>

    <div class="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      <Card v-for="s in STATS" :key="s.label">
        <CardContent class="flex flex-col gap-1 py-5">
          <span class="text-sm text-muted-foreground">{{ s.label }}</span>
          <span class="text-3xl font-semibold tracking-tight">{{ s.value }}</span>
          <span v-if="s.note" class="text-xs text-muted-foreground">{{ s.note }}</span>
        </CardContent>
      </Card>
    </div>

    <div class="grid gap-3.5 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle class="text-base">机器状态分布</CardTitle></CardHeader>
        <CardContent>
          <div ref="chartEl" class="h-[280px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle class="text-base">进行中的任务</CardTitle></CardHeader>
        <CardContent>
          <div class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="w-20">类型</TableHead>
                  <TableHead class="w-24">状态</TableHead>
                  <TableHead class="w-24">目标机器</TableHead>
                  <TableHead class="min-w-[140px]">创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in runningJobsQuery.data.value?.items ?? []" :key="row.id">
                  <TableCell>{{ JOB_TYPE_LABEL[row.type] ?? row.type }}</TableCell>
                  <TableCell><StateBadge kind="job" :state="row.state" /></TableCell>
                  <TableCell class="text-muted-foreground">{{ row.machine_ids?.length ?? row.summary?.total ?? '—' }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ formatTime(row.created_at) }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="(runningJobsQuery.data.value?.items ?? []).length === 0" description="当前没有进行中的任务" />
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
