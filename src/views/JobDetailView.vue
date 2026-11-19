<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, RefreshCcw, ScrollText } from 'lucide-vue-next'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { subscribeSse } from '@/api/sse'
import { jobScopeKey, jobKey, jobTasksKey } from '@/api/queryKeys'
import { confirm } from '@/composables/confirm'
import { useConnectionStore } from '@/stores/connection'
import type { components } from '@/api/types.gen'
import StateBadge from '@/components/StateBadge.vue'
import JobSummaryBar from '@/components/JobSummaryBar.vue'
import DescriptionList from '@/components/DescriptionList.vue'
import DescriptionItem from '@/components/DescriptionItem.vue'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import EmptyState from '@/components/EmptyState.vue'
import { formatTime } from '@/utils/format'

type Job = components['schemas']['Job']

const props = defineProps<{ id: string }>()
const router = useRouter()
const queryClient = useQueryClient()
const conn = useConnectionStore()

const jobQuery = useQuery({
  queryKey: computed(() => jobKey(props.id)),
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/jobs/{id}', { params: { path: { id: props.id } } })),
})
const tasksQuery = useQuery({
  queryKey: computed(() => jobTasksKey(props.id)),
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/jobs/{id}/tasks', {
        params: { path: { id: props.id }, query: { page_size: 200 } },
      }),
    ),
})

const job = computed(() => jobQuery.data.value as Job | undefined)
const tasks = computed(() => tasksQuery.data.value?.items ?? [])

// job 级 SSE：任何事件失效 ['job', jobId] 前缀——层级 key 下 summary、
// 任务列表与打开中的子任务详情一次命中（都是 DB 派生）
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
        void queryClient.invalidateQueries({ queryKey: jobScopeKey(props.id) })
      },
      onError: () => {}, // 断线重连由 sse.ts 处理
    })
    closeSse = handle.close
  },
  { immediate: true },
)
onUnmounted(() => closeSse?.())

const JOB_TYPE_LABEL: Record<string, string> = {
  install: '装机',
  power: '电源',
  discover: '盘查',
}

function currentStage(t: components['schemas']['Task']): string {
  const active = t.stages?.find((s) => s.state === 'running' || s.state === 'pending')
  return active?.name ?? t.stages?.filter((s) => s.state !== 'skipped').at(-1)?.name ?? '—'
}

// ── spec 查看 ───────────────────────────────────────────────────────────────
const specVisible = ref(false)
const specText = ref('')

function openSpec() {
  const spec = job.value?.spec
  if (!spec) return
  specText.value = JSON.stringify(spec, null, 2)
  specVisible.value = true
}

// ── 取消任务 ────────────────────────────────────────────────────────────────
const canceling = ref(false)
async function cancelJob() {
  const ok = await confirm({
    title: '取消任务',
    description:
      '取消会停止调度并执行补偿（弹出介质、恢复引导序）。已运行的子任务会被中断。确定取消？',
    confirmText: '取消任务',
    destructive: true,
  })
  if (!ok) return
  canceling.value = true
  try {
    await unwrap(await getClient().POST('/api/v1/jobs/{id}/cancel', { params: { path: { id: props.id } } }))
    toast.success('已提交取消')
    // 取消会连带改任务状态：scope 失效覆盖 summary/任务列表/子任务详情
    void queryClient.invalidateQueries({ queryKey: jobScopeKey(props.id) })
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    canceling.value = false
  }
}

function openTask(t: components['schemas']['Task']) {
  router.push({ name: 'task-detail', params: { jobId: props.id, taskId: t.id } })
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon" class="size-8 shrink-0" @click="router.push({ name: 'jobs' })">
          <ArrowLeft class="size-4" />
          <span class="sr-only">返回任务列表</span>
        </Button>
        <h2 class="truncate font-mono text-xl font-bold tracking-tight">{{ id }}</h2>
        <StateBadge v-if="job" kind="job" :state="job.state" />
        <span v-if="job" class="text-sm text-muted-foreground">{{ JOB_TYPE_LABEL[job.type] ?? job.type }}任务</span>
      </div>
      <div class="flex items-center gap-2">
        <Button v-if="job?.spec" variant="outline" size="sm" @click="openSpec">
          <ScrollText class="size-4" /> 查看 spec
        </Button>
        <Button
          v-if="job && (job.state === 'pending' || job.state === 'running')"
          variant="outline"
          size="sm"
          class="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          :disabled="canceling"
          @click="cancelJob"
        >
          取消任务
        </Button>
        <Button variant="outline" size="sm" @click="queryClient.invalidateQueries({ queryKey: jobScopeKey(id) })">
          <RefreshCcw class="size-4" /> 刷新
        </Button>
      </div>
    </div>

    <Alert v-if="jobQuery.error.value" variant="destructive">
      <AlertTitle>{{ errorMessage(jobQuery.error.value) }}</AlertTitle>
    </Alert>
    <Skeleton v-else-if="jobQuery.isPending.value" class="h-40 w-full" />

    <template v-else-if="job">
      <Card>
        <CardContent class="flex flex-col gap-3">
          <JobSummaryBar :summary="job.summary" />
          <DescriptionList :columns="4" class="border-0 p-0">
            <DescriptionItem label="目标机器">{{ job.machine_ids?.length ?? job.summary.total }}</DescriptionItem>
            <DescriptionItem label="创建时间">{{ formatTime(job.created_at) }}</DescriptionItem>
            <DescriptionItem label="结束时间">{{ formatTime(job.finished_at) }}</DescriptionItem>
            <DescriptionItem label="并发 / 失败策略">
              {{ job.policy?.concurrency ?? '—' }} / {{ job.policy?.on_task_failure === 'abort_batch' ? '中止整批' : '继续其余' }}
            </DescriptionItem>
          </DescriptionList>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="min-w-[150px]">机器</TableHead>
                  <TableHead class="w-28">状态</TableHead>
                  <TableHead class="w-24">执行轮次</TableHead>
                  <TableHead class="min-w-[140px]">当前阶段</TableHead>
                  <TableHead class="min-w-[160px]">错误</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in tasks" :key="row.id" class="cursor-pointer" @click="openTask(row)">
                  <TableCell><span class="font-mono text-xs">{{ row.machine_id }}</span></TableCell>
                  <TableCell><StateBadge kind="task" :state="row.state" /></TableCell>
                  <TableCell class="text-muted-foreground">第 {{ row.attempt }} 次</TableCell>
                  <TableCell><span class="font-mono text-xs">{{ currentStage(row) }}</span></TableCell>
                  <TableCell>
                    <span v-if="row.error" class="font-mono text-xs text-destructive">{{ row.error.code }}</span>
                    <span v-else class="text-muted-foreground">—</span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="tasks.length === 0" description="该任务还没有子任务记录" />
          </div>
        </CardContent>
      </Card>
    </template>

    <Dialog :open="specVisible" @update:open="(v: boolean) => (specVisible = v)">
      <DialogContent class="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>解析后的最终 spec（审计）</DialogTitle>
          <DialogDescription>提交时快照的实际执行规格。</DialogDescription>
        </DialogHeader>
        <pre class="max-h-[60vh] overflow-auto rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed">{{ specText }}</pre>
      </DialogContent>
    </Dialog>
  </div>
</template>
