<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, RefreshCcw, ScrollText } from 'lucide-vue-next'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
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
const { t } = useI18n()
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
  install: t('jobs.typeInstall'),
  power: t('jobs.typePower'),
  discover: t('jobs.typeDiscover'),
}

function currentStage(t2: components['schemas']['Task']): string {
  const active = t2.stages?.find((s) => s.state === 'running' || s.state === 'pending')
  return active?.name ?? t2.stages?.filter((s) => s.state !== 'skipped').at(-1)?.name ?? '—'
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
    title: t('jobs.cancelConfirmTitle'),
    description: t('jobs.cancelConfirmDesc'),
    confirmText: t('jobs.cancelConfirmText'),
    destructive: true,
  })
  if (!ok) return
  canceling.value = true
  try {
    await unwrap(await getClient().POST('/api/v1/jobs/{id}/cancel', { params: { path: { id: props.id } } }))
    toast.success(t('jobs.cancelSubmitted'))
    // 取消会连带改任务状态：scope 失效覆盖 summary/任务列表/子任务详情
    void queryClient.invalidateQueries({ queryKey: jobScopeKey(props.id) })
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    canceling.value = false
  }
}

function openTask(t2: components['schemas']['Task']) {
  router.push({ name: 'task-detail', params: { jobId: props.id, taskId: t2.id } })
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon" class="size-8 shrink-0" @click="router.push({ name: 'jobs' })">
          <ArrowLeft class="size-4" />
          <span class="sr-only">{{ t('machines.backToList') }}</span>
        </Button>
        <h2 class="truncate font-mono text-xl font-bold tracking-tight">{{ id }}</h2>
        <StateBadge v-if="job" kind="job" :state="job.state" />
        <span v-if="job" class="text-sm text-muted-foreground">{{ t('jobs.installJob', { type: JOB_TYPE_LABEL[job.type] ?? job.type }) }}</span>
      </div>
      <div class="flex items-center gap-2">
        <Button v-if="job?.spec" variant="outline" size="sm" @click="openSpec">
          <ScrollText class="size-4" /> {{ t('jobs.viewSpec') }}
        </Button>
        <Button
          v-if="job && (job.state === 'pending' || job.state === 'running')"
          variant="outline"
          size="sm"
          class="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          :disabled="canceling"
          @click="cancelJob"
        >
          {{ t('jobs.cancelJob') }}
        </Button>
        <Button variant="outline" size="sm" @click="queryClient.invalidateQueries({ queryKey: jobScopeKey(id) })">
          <RefreshCcw class="size-4" /> {{ t('common.refresh') }}
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
            <DescriptionItem :label="t('dashboard.colTarget')">{{ job.machine_ids?.length ?? job.summary.total }}</DescriptionItem>
            <DescriptionItem :label="t('jobs.colCreatedAt')">{{ formatTime(job.created_at) }}</DescriptionItem>
            <DescriptionItem :label="t('jobs.colFinishedAt')">{{ formatTime(job.finished_at) }}</DescriptionItem>
            <DescriptionItem :label="t('jobs.concurrency')">
              {{ job.policy?.concurrency ?? '—' }} / {{ job.policy?.on_task_failure === 'abort_batch' ? t('jobs.policyAbort') : t('jobs.policyContinue') }}
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
                  <TableHead class="min-w-[150px]">{{ t('jobs.colMachine') }}</TableHead>
                  <TableHead class="w-28">{{ t('jobs.colState') }}</TableHead>
                  <TableHead class="w-24">{{ t('jobs.colAttempt') }}</TableHead>
                  <TableHead class="min-w-[140px]">{{ t('jobs.colStage') }}</TableHead>
                  <TableHead class="min-w-[160px]">{{ t('jobs.colError') }}</TableHead>
                </TableRow>

              </TableHeader>
              <TableBody>
                <TableRow v-for="row in tasks" :key="row.id" class="cursor-pointer" @click="openTask(row)">
                  <TableCell><span class="font-mono text-xs">{{ row.machine_id }}</span></TableCell>
                  <TableCell><StateBadge kind="task" :state="row.state" /></TableCell>
                  <TableCell class="text-muted-foreground">{{ t('jobs.attemptN', { n: row.attempt }) }}</TableCell>
                  <TableCell><span class="font-mono text-xs">{{ currentStage(row) }}</span></TableCell>
                  <TableCell>
                    <span v-if="row.error" class="font-mono text-xs text-destructive">{{ row.error.code }}</span>
                    <span v-else class="text-muted-foreground">—</span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="tasks.length === 0" :description="t('jobs.tasksEmpty')" />
          </div>
        </CardContent>
      </Card>
    </template>

    <Dialog :open="specVisible" @update:open="(v: boolean) => (specVisible = v)">
      <DialogContent class="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{{ t('jobs.specTitle') }}</DialogTitle>
          <DialogDescription>{{ t('jobs.specDesc') }}</DialogDescription>
        </DialogHeader>
        <pre class="max-h-[60vh] overflow-auto rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed">{{ specText }}</pre>
      </DialogContent>
    </Dialog>
  </div>
</template>
