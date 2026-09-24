<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { subscribeSse } from '@/api/sse'
import { useConnectionStore } from '@/stores/connection'
import type { components } from '@/api/types.gen'
import StateBadge from '@/components/StateBadge.vue'
import JobSummaryBar from '@/components/JobSummaryBar.vue'
import { formatTime } from '@/utils/format'

type Job = components['schemas']['Job']

const props = defineProps<{ id: string }>()
const router = useRouter()
const queryClient = useQueryClient()
const conn = useConnectionStore()

const jobQuery = useQuery({
  queryKey: computed(() => ['job', props.id]),
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/jobs/{id}', { params: { path: { id: props.id } } })),
})
const tasksQuery = useQuery({
  queryKey: computed(() => ['job-tasks', props.id]),
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/jobs/{id}/tasks', {
        params: { path: { id: props.id }, query: { page_size: 200 } },
      }),
    ),
})

const job = computed(() => jobQuery.data.value as Job | undefined)
const tasks = computed(() => tasksQuery.data.value?.items ?? [])

// job 级 SSE：任何事件触发查询失效刷新（summary 与 tasks 都是 DB 派生）
let closeSse: (() => void) | null = null
watch(
  () => props.id,
  () => {
    closeSse?.()
    closeSse = null
    if (!conn.connected) return
    const handle = subscribeSse({
      url: `/api/v1/jobs/${props.id}/events`,
      token: conn.token,
      onMessage: () => {
        void queryClient.invalidateQueries({ queryKey: ['job', props.id] })
        void queryClient.invalidateQueries({ queryKey: ['job-tasks', props.id] })
      },
      onError: () => {}, // 断线重连由 sse.ts 处理
    })
    closeSse = handle.close
  },
  { immediate: true },
)

const JOB_TYPE_LABEL: Record<string, string> = {
  install: '装机',
  power: '电源',
  discover: '盘查',
}

function currentStage(t: components['schemas']['Task']): string {
  const active = t.stages?.find((s) => s.state === 'running' || s.state === 'pending')
  return active?.name ?? t.stages?.filter((s) => s.state !== 'skipped').at(-1)?.name ?? '—'
}

function openSpec() {
  const spec = job.value?.spec
  if (!spec) return
  ElMessageBox.alert(
    `<pre style="max-height:60vh;overflow:auto;margin:0;font-size:12px">${JSON.stringify(spec, null, 2)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre>`,
    '解析后的最终 spec（审计）',
    { dangerouslyUseHTMLString: true, confirmButtonText: '关闭' },
  ).catch(() => {})
}

const canceling = ref(false)
async function cancelJob() {
  try {
    await ElMessageBox.confirm(
      '取消会停止调度并执行补偿（弹出介质、恢复引导序）。已运行的子任务会被中断。确定取消？',
      `取消任务 ${props.id}`,
      { type: 'warning', confirmButtonText: '取消任务', cancelButtonText: '再想想' },
    )
  } catch {
    return
  }
  canceling.value = true
  try {
    await unwrap(await getClient().POST('/api/v1/jobs/{id}/cancel', { params: { path: { id: props.id } } }))
    ElMessage.success('已提交取消')
    void queryClient.invalidateQueries({ queryKey: ['job', props.id] })
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    canceling.value = false
  }
}

function openTask(t: components['schemas']['Task']) {
  router.push({ name: 'task-detail', params: { jobId: props.id, taskId: t.id } })
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title mono">{{ id }}</h1>
        <StateBadge v-if="job" kind="job" :state="job.state" />
        <span v-if="job" class="text-muted">{{ JOB_TYPE_LABEL[job.type] ?? job.type }}任务</span>
      </div>
      <div>
        <el-button v-if="job?.spec" @click="openSpec">查看 spec</el-button>
        <el-button
          v-if="job && (job.state === 'pending' || job.state === 'running')"
          type="danger"
          plain
          :loading="canceling"
          @click="cancelJob"
        >
          取消任务
        </el-button>
        <el-button :icon="Refresh" @click="queryClient.invalidateQueries({ queryKey: ['job'] })">刷新</el-button>
      </div>
    </div>

    <el-alert
      v-if="jobQuery.error.value"
      :title="errorMessage(jobQuery.error.value)"
      type="error"
      :closable="false"
      show-icon
    />
    <el-skeleton v-else-if="jobQuery.isPending.value" :rows="4" animated />

    <template v-else-if="job">
      <el-card shadow="never" class="mb">
        <JobSummaryBar :summary="job.summary" />
        <el-descriptions :column="4" size="small" class="desc">
          <el-descriptions-item label="目标机器">{{ job.machine_ids?.length ?? job.summary.total }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatTime(job.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="结束时间">{{ formatTime(job.finished_at) }}</el-descriptions-item>
          <el-descriptions-item label="并发 / 失败策略">
            {{ job.policy?.concurrency ?? '—' }} / {{ job.policy?.on_task_failure === 'abort_batch' ? '中止整批' : '继续其余' }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never">
        <el-table
          :data="tasks"
          size="default"
          :row-style="{ cursor: 'pointer' }"
          @row-click="openTask"
        >
          <el-table-column label="机器" min-width="150">
            <template #default="{ row }"><span class="mono">{{ row.machine_id }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }"><StateBadge kind="task" :state="row.state" /></template>
          </el-table-column>
          <el-table-column label="执行轮次" width="100">
            <template #default="{ row }">第 {{ row.attempt }} 次</template>
          </el-table-column>
          <el-table-column label="当前阶段" min-width="140">
            <template #default="{ row }"><span class="mono">{{ currentStage(row) }}</span></template>
          </el-table-column>
          <el-table-column label="错误" min-width="180">
            <template #default="{ row }">
              <span v-if="row.error" class="error-code">{{ row.error.code }}</span>
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>
          <template #empty>该任务还没有子任务记录</template>
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mb {
  margin-bottom: 14px;
}
.desc {
  margin-top: 12px;
}
.error-code {
  color: #f56c6c;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
