<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ArrowLeft, RefreshCcw, RotateCcw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { getClient } from '@/api/client'
import { unwrap, errorMessage, codeText } from '@/api/problem'
import { subscribeSse } from '@/api/sse'
import { taskKey } from '@/api/queryKeys'
import { confirm } from '@/composables/confirm'
import { useConnectionStore } from '@/stores/connection'
import type { components } from '@/api/types.gen'
import StateBadge from '@/components/StateBadge.vue'
import LogViewer from '@/components/LogViewer.vue'
import DescriptionList from '@/components/DescriptionList.vue'
import DescriptionItem from '@/components/DescriptionItem.vue'
import StepProgress, { type StepView } from '@/components/StepProgress.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTime } from '@/utils/format'

type Task = components['schemas']['Task']

const props = defineProps<{ jobId: string; taskId: string }>()
const { t } = useI18n()
const router = useRouter()
const queryClient = useQueryClient()
const conn = useConnectionStore()

const query = useQuery({
  queryKey: computed(() => taskKey(props.jobId, props.taskId)),
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/jobs/{id}/tasks/{taskId}', {
        params: { path: { id: props.jobId, taskId: props.taskId } },
      }),
    ),
  // SSE 不可用（代理不支持/网络异常）时的保底：日志降级 2s 轮询仍在动、
  // 阶段步骤不能停在 mount 时——任务未终态期间 10s 轮询,终态即停。
  // 主刷新路径是下方 job 级 SSE 失效 + 日志 eos 信号。
  refetchInterval: (q) => {
    const s = (q.state.data as Task | undefined)?.state
    return s === 'pending' || s === 'running' ? 10_000 : false
  },
})

// job 级 SSE：任何事件失效 ['job', jobId] 前缀（命中本 job 的 detail/
// tasks/task 全部查询）——阶段步骤、子任务信息随事件实时推进，与下方
// 日志流的进度同步（手动刷新只做兜底）
let closeSse: (() => void) | null = null
watch(
  () => props.jobId,
  () => {
    closeSse?.()
    closeSse = null
    if (!conn.connected) return
    const handle = subscribeSse({
      url: `/api/v1/jobs/${props.jobId}/events`,
      token: conn.token,
      onMessage: () => {
        void queryClient.invalidateQueries({ queryKey: ['job', props.jobId] })
      },
      onError: () => {}, // 断线重连由 sse.ts 处理
    })
    closeSse = handle.close
  },
  { immediate: true },
)
onUnmounted(() => closeSse?.())

// 日志流 eos = 任务终态确认（断线错过 job 事件时的兜底）：把阶段步骤
// 拉到终态，顶部状态徽章同步
function onLogEnded() {
  void queryClient.invalidateQueries({ queryKey: taskKey(props.jobId, props.taskId) })
}

const task = computed(() => query.data.value as Task | undefined)

const STEPS = ['verify_layout', 'configure_raid', 'prepare_media', 'boot', 'install_os', 'verify_ready']

function stepStatus(state: string): StepView['status'] {
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

/** 单 stage 流（power/discover）直接按 stages 渲染；install 流按固定六段排序。 */
const steps = computed<StepView[]>(() => {
  const stages = task.value?.stages ?? []
  if (stages.length === 0) return []
  // noop = 引擎 no-op 直通标记（configure_raid 无硬件 RAID 声明）：渲染为
  // "跳过"而非毫秒时长（引擎 Stage.noop，docs/06 §2 六段契约不变）
  if (stages.length <= 2) {
    return stages.map((s) => ({
      // 阶段名经 stages 域翻译(引擎契约值缺失时回落原文)
      name: t(`stages.${s.name}`),
      status: s.noop ? ('skip' as const) : stepStatus(s.state),
      description: s.noop ? t('taskDetail.stageSkipped') : s.duration_ms ? fmtDuration(s.duration_ms) : s.started_at ? formatTime(s.started_at).slice(11) : t('common.notRun'),
    }))
  }
  const byName = new Map(stages.map((s) => [s.name, s]))
  return STEPS.map((name) => {
    const s = byName.get(name)
    return {
      name: t(`stages.${name}`),
      status: !s ? ('wait' as const) : s.noop ? ('skip' as const) : stepStatus(s.state),
      description: !s ? t('common.notRun') : s.noop ? t('taskDetail.stageSkipped') : (s.duration_ms ? fmtDuration(s.duration_ms) : s.started_at ? formatTime(s.started_at).slice(11) : ''),
    }
  })
})

// ── 断点重试 ────────────────────────────────────────────────────────────────
const retrying = ref(false)
async function retry() {
  const ok = await confirm({
    title: t('taskDetail.retryConfirmTitle', { id: props.taskId }),
    description: t('taskDetail.retryConfirmDesc'),
    confirmText: t('taskDetail.retryConfirmText'),
  })
  if (!ok) return
  retrying.value = true
  try {
    await unwrap(
      await getClient().POST('/api/v1/jobs/{id}/tasks/{taskId}/retry', {
        params: { path: { id: props.jobId, taskId: props.taskId } },
      }),
    )
    toast.success(t('taskDetail.retryQueued'))
    void queryClient.invalidateQueries({ queryKey: taskKey(props.jobId, props.taskId) })
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          class="size-8 shrink-0"
          @click="router.push({ name: 'job-detail', params: { id: jobId } })"
        >
          <ArrowLeft class="size-4" />
          <span class="sr-only">返回任务</span>
        </Button>
        <h2 class="truncate font-mono text-xl font-bold tracking-tight">{{ taskId }}</h2>
        <StateBadge v-if="task" kind="task" :state="task.state" />
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="task && (task.state === 'failed' || task.state === 'interrupted')"
          variant="outline"
          size="sm"
          class="border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400"
          :disabled="retrying"
          @click="retry"
        >
          <RotateCcw class="size-4" /> {{ t('taskDetail.retry') }}
        </Button>
        <Button variant="outline" size="sm" @click="query.refetch()">
          <RefreshCcw class="size-4" /> {{ t('common.refresh') }}
        </Button>
      </div>
    </div>

    <Alert v-if="query.error.value" variant="destructive">
      <AlertTitle>{{ errorMessage(query.error.value) }}</AlertTitle>
    </Alert>
    <Skeleton v-else-if="query.isPending.value" class="h-40 w-full" />

    <template v-else-if="task">
      <Card v-if="steps.length > 0">
        <CardContent class="py-6">
          <StepProgress :steps="steps" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-base">{{ t('taskDetail.subInfo') }}</CardTitle>
        </CardHeader>
        <CardContent>
          <DescriptionList :columns="4">
            <DescriptionItem :label="t('taskDetail.colMachine')" mono>{{ task.machine_id }}</DescriptionItem>
            <DescriptionItem :label="t('taskDetail.colFlow')">{{ task.flow_name }}</DescriptionItem>
            <DescriptionItem :label="t('taskDetail.colAttempt')">
              {{ task.attempt > 1 ? t('taskDetail.attemptRetry', { n: task.attempt }) : t('jobs.attemptN', { n: task.attempt }) }}
            </DescriptionItem>
            <DescriptionItem :label="t('taskDetail.colAnswerUrl')">
              <a v-if="task.answer_url" :href="task.answer_url" target="_blank" class="font-mono text-xs underline underline-offset-2">
                {{ t('taskDetail.view') }}
              </a>
              <span v-else class="text-muted-foreground text-xs">{{ t('taskDetail.noAnswerUrl') }}</span>
            </DescriptionItem>
            <DescriptionItem :label="t('taskDetail.colCreatedAt')">{{ formatTime(task.created_at) }}</DescriptionItem>
            <DescriptionItem :label="t('taskDetail.colUpdatedAt')">{{ formatTime(task.updated_at) }}</DescriptionItem>
            <DescriptionItem :label="t('taskDetail.colFinishedAt')">{{ formatTime(task.finished_at) }}</DescriptionItem>
          </DescriptionList>
        </CardContent>
      </Card>

      <Alert
        v-if="task.error"
        :variant="task.state === 'interrupted' ? 'default' : 'destructive'"
        :class="task.state === 'interrupted' ? 'border-amber-500/40 bg-amber-500/5' : ''"
      >
        <AlertTitle>{{ task.error.code }}{{ codeText(task.error.code) ? '：' + codeText(task.error.code) : '' }}</AlertTitle>
        <AlertDescription>{{ task.error.message }}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle class="text-base">{{ t('taskDetail.logTitle') }}</CardTitle>
          <p class="text-xs text-muted-foreground">{{ t('taskDetail.logDesc') }}</p>
        </CardHeader>
        <CardContent>
          <LogViewer :job-id="jobId" :task-id="taskId" @ended="onLogEnded" />
        </CardContent>
      </Card>
    </template>
  </div>
</template>
