<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { Refresh, Search } from '@element-plus/icons-vue'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import StateBadge from '@/components/StateBadge.vue'
import JobSummaryBar from '@/components/JobSummaryBar.vue'
import { formatTime } from '@/utils/format'

type Job = components['schemas']['Job']
type JobType = components['schemas']['JobType']
type JobState = components['schemas']['JobState']

const PAGE_SIZE = 50
const router = useRouter()

const typeFilter = ref<JobType | ''>('')
const stateFilter = ref<JobState | ''>('')
const cursor = ref<string | undefined>(undefined)
const cursorStack = ref<(string | undefined)[]>([])

const query = useQuery({
  queryKey: computed(() => ['jobs', typeFilter.value, stateFilter.value, cursor.value]),
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
  install: '装机',
  power: '电源',
  discover: '盘查',
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">任务</h1>
      <el-button :icon="Refresh" @click="query.refetch()">刷新</el-button>
    </div>

    <el-card shadow="never" class="toolbar">
      <div class="filters">
        <el-select
          v-model="typeFilter"
          placeholder="全部类型"
          clearable
          style="width: 130px"
          @change="resetPaging"
        >
          <el-option label="装机" value="install" />
          <el-option label="电源" value="power" />
          <el-option label="盘查" value="discover" />
        </el-select>
        <el-select
          v-model="stateFilter"
          placeholder="全部状态"
          clearable
          style="width: 140px"
          @change="resetPaging"
        >
          <el-option label="排队中" value="pending" />
          <el-option label="执行中" value="running" />
          <el-option label="全部成功" value="succeeded" />
          <el-option label="部分成功" value="partial" />
          <el-option label="失败" value="failed" />
          <el-option label="已取消" value="canceled" />
        </el-select>
        <el-button type="primary" :icon="Search" @click="resetPaging">应用</el-button>
      </div>
    </el-card>

    <el-card shadow="never">
      <el-table
        v-loading="query.isFetching.value"
        :data="rows"
        :row-style="{ cursor: 'pointer' }"
        @row-click="open"
      >
        <el-table-column label="任务 ID" width="180">
          <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column label="类型" width="80">
          <template #default="{ row }">{{ JOB_TYPE_LABEL[row.type] ?? row.type }}</template>
        </el-table-column>
        <el-table-column label="状态" width="105">
          <template #default="{ row }"><StateBadge kind="job" :state="row.state" /></template>
        </el-table-column>
        <el-table-column label="进度" min-width="260">
          <template #default="{ row }">
            <JobSummaryBar :summary="row.summary" compact />
          </template>
        </el-table-column>
        <el-table-column label="目标" width="70">
          <template #default="{ row }">{{ row.summary.total }}</template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="165">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="结束时间" min-width="165">
          <template #default="{ row }">{{ formatTime(row.finished_at) }}</template>
        </el-table-column>
        <template #empty>
          <el-empty description="还没有任务记录" :image-size="80" />
        </template>
      </el-table>

      <div class="pager">
        <span class="text-muted" style="font-size: 13px">游标分页：仅支持前后翻页</span>
        <div>
          <el-button size="small" :disabled="cursorStack.length === 0" @click="prevPage">上一页</el-button>
          <el-button size="small" :disabled="!nextCursor" @click="nextPage">下一页</el-button>
        </div>
      </div>
      <el-alert
        v-if="query.error.value"
        :title="errorMessage(query.error.value)"
        type="error"
        :closable="false"
        show-icon
        class="mt"
      />
    </el-card>
  </div>
</template>

<style scoped>
.toolbar {
  margin-bottom: 14px;
}
.filters {
  display: flex;
  gap: 10px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}
.mt {
  margin-top: 10px;
}
</style>
