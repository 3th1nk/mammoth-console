<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { Refresh } from '@element-plus/icons-vue'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import RegisterMachineDialog from '@/components/RegisterMachineDialog.vue'
import { formatTime } from '@/utils/format'

type PendingMachine = components['schemas']['PendingMachine']
type Machine = components['schemas']['Machine']

const router = useRouter()
const claimTarget = ref<PendingMachine | null>(null)
const dialogVisible = ref(false)

// 零注册台账无分页、量小，15s 轮询兜底（引擎 pending 事件落地后切 SSE）
const query = useQuery({
  queryKey: ['pending-machines'],
  queryFn: async () => unwrap(await getClient().GET('/api/v1/pending-machines')),
  refetchInterval: 15000,
})

const rows = computed(() => query.data.value?.items ?? [])

function openClaim(m: PendingMachine) {
  claimTarget.value = m
  dialogVisible.value = true
}

function onRegistered(machine: Machine) {
  router.push({ name: 'machine-detail', params: { id: machine.id } })
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">待认领</h1>
      <el-button :icon="Refresh" @click="query.refetch()">刷新</el-button>
    </div>

    <el-alert
      v-if="query.error.value"
      :title="errorMessage(query.error.value)"
      type="error"
      :closable="false"
      show-icon
      class="mb"
    />

    <el-card shadow="never">
      <el-table v-loading="query.isFetching.value" :data="rows" size="default">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="report">
              <template v-if="row.report">
                <div class="text-muted" style="margin-bottom: 6px">
                  探针 /sys 扫描报告（原样落库）
                </div>
                <pre class="mono report-json">{{ JSON.stringify(row.report, null, 2) }}</pre>
              </template>
              <div v-else class="text-muted">
                尚未收到探针报告——机器可能只 PXE 留痕了一次，没有进入内存盘探针。
                让它再次引导（或等待租期重试）即可补齐。
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="MAC" width="180">
          <template #default="{ row }"><span class="mono">{{ row.mac }}</span></template>
        </el-table-column>
        <el-table-column label="固件（option 93）" min-width="170">
          <template #default="{ row }">
            <span v-if="row.firmware" class="mono">{{ row.firmware }}</span>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="探针报告" min-width="140">
          <template #default="{ row }">
            <el-tag v-if="row.report" type="success" size="small">已上报</el-tag>
            <el-tag v-else type="info" size="small">未上报</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="首次出现" width="170">
          <template #default="{ row }">{{ formatTime(row.first_seen_at) }}</template>
        </el-table-column>
        <el-table-column label="最近出现" width="170">
          <template #default="{ row }">{{ formatTime(row.last_seen_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" plain @click.stop="openClaim(row)">认领</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :image-size="80" description="登记本是空的">
            <div class="text-muted" style="font-size: 13px; max-width: 420px; line-height: 1.7">
              开启引擎零注册（MAMMOTH_PXE_ENABLED + MAMMOTH_PXE_ENROLL）后，
              插电自举的未知机器会在这里留下 MAC、固件与盘查报告——
              拿着序列号去机房认出它，补上 BMC 凭证即可收编。
            </div>
          </el-empty>
        </template>
      </el-table>
    </el-card>

    <RegisterMachineDialog
      v-model="dialogVisible"
      :claim-mac="claimTarget?.mac"
      @registered="onRegistered"
    />
  </div>
</template>

<style scoped>
.mb {
  margin-bottom: 14px;
}
.report {
  padding: 8px 16px;
}
.report-json {
  margin: 0;
  font-size: 12px;
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 10px;
  max-height: 320px;
  overflow: auto;
}
</style>
