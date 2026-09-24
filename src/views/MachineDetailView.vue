<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import StateBadge from '@/components/StateBadge.vue'
import PowerBadge from '@/components/PowerBadge.vue'
import MachineActions from '@/components/MachineActions.vue'
import { formatBytes, formatTime } from '@/utils/format'

type Machine = components['schemas']['Machine']

const props = defineProps<{ id: string }>()
const router = useRouter()

const query = useQuery({
  queryKey: computed(() => ['machine', props.id]),
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/machines/{id}', { params: { path: { id: props.id } } })),
})

const machine = computed(() => query.data.value as Machine | undefined)
const hardware = computed(() => machine.value?.hardware)

const title = computed(() => {
  const m = machine.value
  if (!m) return props.id
  return m.hardware?.serial_number || m.bmc.address
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" text @click="router.push({ name: 'machines' })">返回列表</el-button>
        <h1 class="page-title mono">{{ title }}</h1>
        <StateBadge v-if="machine" kind="machine" :state="machine.state" />
        <PowerBadge v-if="machine" :state="machine.power_state" />
      </div>
      <div class="header-right">
        <MachineActions v-if="machine" :machine-id="machine.id" @submitted="query.refetch()" />
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
    <el-skeleton v-else-if="query.isPending.value" :rows="6" animated />

    <template v-else-if="machine">
      <el-alert
        v-if="machine.last_error"
        :title="`上一次错误：${machine.last_error.code ?? ''}`"
        :description="machine.last_error.message"
        type="error"
        :closable="false"
        show-icon
        class="mb"
      />

      <el-card shadow="never" header="带外（BMC）与带内寻址" class="mb">
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="机器 ID"><span class="mono">{{ machine.id }}</span></el-descriptions-item>
          <el-descriptions-item label="BMC 地址"><span class="mono">{{ machine.bmc.address }}</span></el-descriptions-item>
          <el-descriptions-item label="协议">{{ machine.bmc.protocol ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="厂商">{{ machine.bmc.vendor || '—' }}</el-descriptions-item>
          <el-descriptions-item label="型号">{{ machine.bmc.model || '—' }}</el-descriptions-item>
          <el-descriptions-item label="控制器固件">{{ machine.bmc.firmware_version || '—' }}</el-descriptions-item>
          <el-descriptions-item label="BMC 凭证"><span class="mono">{{ machine.bmc.credential_id }}</span>（secret 不回显）</el-descriptions-item>
          <el-descriptions-item label="SSH 凭证"><span class="mono">{{ machine.ssh_credential_id || '—' }}</span></el-descriptions-item>
          <el-descriptions-item label="带内地址"><span class="mono">{{ machine.ssh?.address || '—' }}</span></el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ formatTime(machine.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ formatTime(machine.updated_at) }}</el-descriptions-item>
          <el-descriptions-item label="标签">
            <el-tag v-for="(v, k) in machine.labels" :key="k" size="small" effect="plain" class="label-tag">
              {{ k }}={{ v }}
            </el-tag>
            <span v-if="Object.keys(machine.labels).length === 0" class="text-muted">—</span>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never" header="硬件规格（探针采集）" class="mb">
        <el-alert
          v-if="hardware?.coverage === 'partial'"
          type="warning"
          :closable="false"
          show-icon
          class="mb-inner"
          title="本次盘查存在盲区（coverage=partial）"
          :description="hardware.coverage_notes?.join('；') || '厂商能力矩阵命中已知盲区'"
        />
        <el-descriptions :column="3" border size="small" class="mb-inner">
          <el-descriptions-item label="整机序列号">
            <span class="mono">{{ hardware?.serial_number || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="CPU">{{ hardware?.cpu?.model || '—' }}</el-descriptions-item>
          <el-descriptions-item label="核数 / 内存">
            {{ hardware?.cpu?.cores ?? '—' }}C · {{ formatBytes(hardware?.memory_bytes) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-table :data="hardware?.disks ?? []" size="small" class="mb-inner">
          <el-table-column prop="name" label="磁盘" width="110" />
          <el-table-column label="序列号" min-width="160">
            <template #default="{ row }"><span class="mono">{{ row.serial || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="容量" width="120">
            <template #default="{ row }">{{ formatBytes(row.size_bytes) }}</template>
          </el-table-column>
          <el-table-column prop="medium" label="介质" width="90" />
          <el-table-column prop="protocol" label="协议" width="110" />
          <el-table-column label="可拔除" width="90">
            <template #default="{ row }">{{ row.removable ? '是' : '否' }}</template>
          </el-table-column>
          <template #empty>尚无磁盘信息（盘查完成后回填）</template>
        </el-table>

        <el-table :data="hardware?.nics ?? []" size="small">
          <el-table-column prop="name" label="网卡" width="110" />
          <el-table-column label="MAC" min-width="160">
            <template #default="{ row }"><span class="mono">{{ row.mac }}</span></template>
          </el-table-column>
          <el-table-column label="速率" width="120">
            <template #default="{ row }">{{ row.speed_mbps ? `${row.speed_mbps} Mbps` : '—' }}</template>
          </el-table-column>
          <el-table-column label="链路" width="90">
            <template #default="{ row }">
              <el-tag :type="row.link_up ? 'success' : 'info'" size="small">
                {{ row.link_up ? 'Up' : 'Down' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="PCI 地址">
            <template #default="{ row }"><span class="mono">{{ row.pci_address || '—' }}</span></template>
          </el-table-column>
          <template #empty>尚无网卡信息（盘查完成后回填）</template>
        </el-table>
      </el-card>

      <el-card shadow="never" header="控制器固件清单（仅 Redfish 盘查产出）">
        <el-table :data="machine.firmware ?? []" size="small">
          <el-table-column prop="id" label="组件 ID" min-width="200">
            <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
          </el-table-column>
          <el-table-column prop="name" label="名称" min-width="200" />
          <el-table-column label="版本" min-width="160">
            <template #default="{ row }"><span class="mono">{{ row.version || '—' }}</span></template>
          </el-table-column>
          <template #empty>无固件清单（IPMI 协议或尚未盘查）</template>
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
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mb {
  margin-bottom: 14px;
}
.mb-inner {
  margin-bottom: 12px;
}
.label-tag {
  margin-right: 4px;
}
</style>
