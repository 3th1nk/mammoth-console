<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getClient } from '@/api/client'
import { unwrap, errorMessage, codeText } from '@/api/problem'
import type { components } from '@/api/types.gen'
import StateBadge from '@/components/StateBadge.vue'
import LogViewer from '@/components/LogViewer.vue'
import { formatTime } from '@/utils/format'

type Task = components['schemas']['Task']

const props = defineProps<{ jobId: string; taskId: string }>()
const router = useRouter()
const queryClient = useQueryClient()

const query = useQuery({
  queryKey: computed(() => ['task', props.jobId, props.taskId]),
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/jobs/{id}/tasks/{taskId}', {
        params: { path: { id: props.jobId, taskId: props.taskId } },
      }),
    ),
})

const task = computed(() => query.data.value as Task | undefined)

const STEPS = ['verify_layout', 'configure_raid', 'prepare_media', 'boot', 'install_os', 'verify_ready']

interface StepView {
  name: string
  status: 'wait' | 'process' | 'finish' | 'error'
  duration_ms?: number | null
  started_at?: string | null
}

/** 单 stage 流（power/discover）直接按 stages 渲染；install 流按固定六段排序。 */
const steps = computed<StepView[]>(() => {
  const stages = task.value?.stages ?? []
  if (stages.length === 0) return []
  if (stages.length <= 2) {
    return stages.map((s) => ({ name: s.name, status: stepStatus(s.state), duration_ms: s.duration_ms, started_at: s.started_at }))
  }
  const byName = new Map(stages.map((s) => [s.name, s]))
  return STEPS.map((name) => {
    const s = byName.get(name)
    return s
      ? { name: s.name, status: stepStatus(s.state), duration_ms: s.duration_ms, started_at: s.started_at }
      : { name, status: 'wait' as const }
  })
})

function stepStatus(state: string): 'wait' | 'process' | 'finish' | 'error' {
  switch (state) {
    case 'running':
      return 'process'
    case 'succeeded':
      return 'finish'
    case 'failed':
      return 'error'
    default:
      return 'wait'
  }
}

function fmtDuration(ms?: number | null): string {
  if (ms === undefined || ms === null) return ''
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`
}

const retrying = ref(false)
async function retry() {
  try {
    await ElMessageBox.confirm(
      '从最后一个阶段断点续跑（不重头开始）。确定重试？',
      `重试 ${props.taskId}`,
      { type: 'warning', confirmButtonText: '重试', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  retrying.value = true
  try {
    await unwrap(
      await getClient().POST('/api/v1/jobs/{id}/tasks/{taskId}/retry', {
        params: { path: { id: props.jobId, taskId: props.taskId } },
      }),
    )
    ElMessage.success('已重新入队，从断点续跑')
    void queryClient.invalidateQueries({ queryKey: ['task', props.jobId, props.taskId] })
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" text @click="router.push({ name: 'job-detail', params: { id: jobId } })">
          返回任务
        </el-button>
        <h1 class="page-title mono">{{ taskId }}</h1>
        <StateBadge v-if="task" kind="task" :state="task.state" />
      </div>
      <div>
        <el-button
          v-if="task && (task.state === 'failed' || task.state === 'interrupted')"
          type="warning"
          plain
          :loading="retrying"
          @click="retry"
        >
          断点重试
        </el-button>
        <el-button :icon="Refresh" @click="query.refetch()">刷新</el-button>
      </div>
    </div>

    <el-alert
      v-if="query.error.value"
      :title="errorMessage(query.error.value)"
      type="error"
      :closable="false"
      show-icon
    />
    <el-skeleton v-else-if="query.isPending.value" :rows="5" animated />

    <template v-else-if="task">
      <el-card shadow="never" class="mb">
        <el-steps :active="steps.length" align-center>
          <el-step
            v-for="s in steps"
            :key="s.name"
            :title="s.name"
            :status="s.status"
            :description="s.duration_ms ? fmtDuration(s.duration_ms) : s.status === 'wait' ? '未执行' : formatTime(s.started_at).slice(11)"
          />
        </el-steps>
      </el-card>

      <el-card shadow="never" header="子任务信息" class="mb">
        <el-descriptions :column="4" size="small" border>
          <el-descriptions-item label="机器"><span class="mono">{{ task.machine_id }}</span></el-descriptions-item>
          <el-descriptions-item label="流程">{{ task.flow_name }}</el-descriptions-item>
          <el-descriptions-item label="执行轮次">第 {{ task.attempt }} 次{{ task.attempt > 1 ? '（重试续跑）' : '' }}</el-descriptions-item>
          <el-descriptions-item label="应答文件地址">
            <a v-if="task.answer_url" :href="task.answer_url" target="_blank" class="mono">查看</a>
            <span v-else class="text-muted">—（虚拟介质装机无此地址）</span>
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatTime(task.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ formatTime(task.updated_at) }}</el-descriptions-item>
          <el-descriptions-item label="结束时间">{{ formatTime(task.finished_at) }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-alert
        v-if="task.error"
        :title="`${task.error.code}${codeText(task.error.code) ? '：' + codeText(task.error.code) : ''}`"
        :description="task.error.message"
        :type="task.state === 'interrupted' ? 'warning' : 'error'"
        :closable="false"
        show-icon
        class="mb"
      />

      <el-card shadow="never" header="执行日志（安装器输出经 syslog 归因落库）">
        <LogViewer :job-id="jobId" :task-id="taskId" />
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
</style>
