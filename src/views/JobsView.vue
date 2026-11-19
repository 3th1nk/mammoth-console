<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { RefreshCcw, Search } from 'lucide-vue-next'
import { useQuery } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { jobListKey } from '@/api/queryKeys'
import type { components } from '@/api/types.gen'
import StateBadge from '@/components/StateBadge.vue'
import JobSummaryBar from '@/components/JobSummaryBar.vue'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import Pager from '@/components/Pager.vue'
import { formatTime } from '@/utils/format'

type Job = components['schemas']['Job']
type JobType = components['schemas']['JobType']
type JobState = components['schemas']['JobState']

const PAGE_SIZE = 50
const { t } = useI18n()
const router = useRouter()

const typeFilter = ref<JobType | ''>('')
const stateFilter = ref<JobState | ''>('')
const cursor = ref<string | undefined>(undefined)
const cursorStack = ref<(string | undefined)[]>([])

const query = useQuery({
  queryKey: computed(() => jobListKey(typeFilter.value, stateFilter.value, cursor.value)),
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/jobs', {
        params: {
          query: {
            type: typeFilter.value || undefined,
            state: stateFilter.value || undefined,
            page_size: PAGE_SIZE,
            cursor: cursor.value,
          },
        },
      }),
    ),
})

const rows = computed(() => query.data.value?.items ?? [])
const nextCursor = computed(() => query.data.value?.next_cursor ?? null)

// reka Select 不允许空串 value：以 'all' 哨兵表示「全部」
const typeModel = computed({
  get: () => typeFilter.value || 'all',
  set: (v: string) => {
    typeFilter.value = (v === 'all' ? '' : v) as JobType | ''
  },
})
const stateModel = computed({
  get: () => stateFilter.value || 'all',
  set: (v: string) => {
    stateFilter.value = (v === 'all' ? '' : v) as JobState | ''
  },
})

const TYPE_OPTIONS = [
  { value: 'install', label: t('jobs.typeInstall') },
  { value: 'power', label: t('jobs.typePower') },
  { value: 'discover', label: t('jobs.typeDiscover') },
]
const STATE_OPTIONS = [
  { value: 'pending', label: t('states.jobPending') },
  { value: 'running', label: t('states.jobRunning') },
  { value: 'succeeded', label: t('states.jobSucceeded') },
  { value: 'partial', label: t('states.jobPartial') },
  { value: 'failed', label: t('states.jobFailed') },
  { value: 'canceled', label: t('states.jobCanceled') },
]

function resetPaging() {
  cursor.value = undefined
  cursorStack.value = []
}

function nextPage() {
  if (!nextCursor.value) return
  cursorStack.value = [...cursorStack.value, cursor.value]
  cursor.value = nextCursor.value
}

function prevPage() {
  const prev = cursorStack.value[cursorStack.value.length - 1]
  cursorStack.value = cursorStack.value.slice(0, -1)
  cursor.value = prev
}

function open(job: Job) {
  router.push({ name: 'job-detail', params: { id: job.id } })
}

const JOB_TYPE_LABEL: Record<string, string> = {
  install: t('jobs.typeInstall'),
  power: t('jobs.typePower'),
  discover: t('jobs.typeDiscover'),
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">{{ t('jobs.title') }}</h2>
        <p class="text-sm text-muted-foreground">{{ t('jobs.subtitle') }}</p>
      </div>
      <Button variant="outline" size="sm" @click="query.refetch()">
        <RefreshCcw class="size-4" /> {{ t('common.refresh') }}
      </Button>
    </div>

    <Alert v-if="query.error.value" variant="destructive">
      <AlertTitle>{{ errorMessage(query.error.value) }}</AlertTitle>
    </Alert>

    <Card>
      <CardContent class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <Select v-model="typeModel" @update:model-value="resetPaging">
            <SelectTrigger class="w-[130px]">
              <SelectValue :placeholder="t('jobs.filterAllTypes')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{{ t('jobs.filterAllTypes') }}</SelectItem>
              <SelectItem v-for="o in TYPE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="stateModel" @update:model-value="resetPaging">
            <SelectTrigger class="w-[140px]">
              <SelectValue :placeholder="t('jobs.filterAllStates')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{{ t('jobs.filterAllStates') }}</SelectItem>
              <SelectItem v-for="o in STATE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" @click="resetPaging"><Search class="size-4" /> {{ t('common.apply') }}</Button>
        </div>

        <Skeleton v-if="query.isPending.value" class="h-56 w-full" />
        <div v-else class="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="w-44">{{ t('jobs.colId') }}</TableHead>
                <TableHead class="w-20">{{ t('jobs.colType') }}</TableHead>
                <TableHead class="w-28">{{ t('jobs.colState') }}</TableHead>
                <TableHead class="min-w-[240px]">{{ t('jobs.colProgress') }}</TableHead>
                <TableHead class="w-16">{{ t('jobs.colTarget') }}</TableHead>
                <TableHead class="min-w-[150px]">{{ t('jobs.colCreatedAt') }}</TableHead>
                <TableHead class="min-w-[150px]">{{ t('jobs.colFinishedAt') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in rows" :key="row.id" class="cursor-pointer" @click="open(row)">
                <TableCell><span class="font-mono text-xs">{{ row.id }}</span></TableCell>
                <TableCell>{{ JOB_TYPE_LABEL[row.type] ?? row.type }}</TableCell>
                <TableCell><StateBadge kind="job" :state="row.state" /></TableCell>
                <TableCell><JobSummaryBar :summary="row.summary" compact /></TableCell>
                <TableCell class="text-muted-foreground">{{ row.summary.total }}</TableCell>
                <TableCell class="text-muted-foreground">{{ formatTime(row.created_at) }}</TableCell>
                <TableCell class="text-muted-foreground">{{ formatTime(row.finished_at) }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <EmptyState v-if="rows.length === 0" :description="t('jobs.empty')" />
        </div>

        <Pager
          :has-prev="cursorStack.length > 0"
          :has-next="!!nextCursor"
          @prev="prevPage"
          @next="nextPage"
        />
      </CardContent>
    </Card>
  </div>
</template>
