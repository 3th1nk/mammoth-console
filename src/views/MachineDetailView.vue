<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
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

// 分区快照：磁盘健康徽章数据源（ramdisk 探针 smartctl/nvme 读数）
const layoutQuery = useQuery({
  queryKey: computed(() => ['machine-layout', props.id]),
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/machines/{id}/layout', { params: { path: { id: props.id } } })),
})
const diskHealthBySerial = computed(() => {
  const map = new Map<string, string>()
  for (const d of layoutQuery.data.value?.disks ?? []) {
    const serial = d.match?.serial
    if (serial && d.health) map.set(serial, d.health)
  }
  return map
})

// BMC 实时健康与 SEL（同步活读；IPMI/不支持 → 422 降级提示）。
// 两者都是引擎同步走 BMC 的多请求遍历，慢控制器下可能远超预期——前端 60s
// 强制中止（engine 自身预算 30s，正常会先返回 BMC_UNREACHABLE；超时兜底
// 针对旧引擎/代理卡死），retry 关掉让错误立即可见而不是静默翻倍等待。
const LIVE_READ_TIMEOUT_MS = 60_000
const healthQuery = useQuery({
  queryKey: computed(() => ['machine-health', props.id]),
  retry: 0,
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/machines/{id}/health', {
        params: { path: { id: props.id } },
        signal: AbortSignal.timeout(LIVE_READ_TIMEOUT_MS),
      }),
    ),
})
const selQuery = useQuery({
  queryKey: computed(() => ['machine-sel', props.id]),
  retry: 0,
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/machines/{id}/sel', {
        params: { path: { id: props.id } },
        signal: AbortSignal.timeout(LIVE_READ_TIMEOUT_MS),
      }),
    ),
})

// 装后验收报告（roadmap 下一阶段 12）：持久化读——无报告 = null（不 404）。
const acceptanceQuery = useQuery({
  queryKey: computed(() => ['machine-acceptance', props.id]),
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/machines/{id}/acceptance', { params: { path: { id: props.id } } })),
})
const acceptance = computed(() => acceptanceQuery.data.value?.report ?? null)
const VERDICT_META: Record<string, { label: string; type: 'success' | 'warning' | 'danger' }> = {
  pass: { label: '通过', type: 'success' },
  degraded: { label: '降级', type: 'warning' },
  fail: { label: '不符', type: 'danger' },
}
const CHECK_LABEL: Record<string, string> = {
  system_facts: '系统事实',
  hostname: '主机名',
  storage_mounts: '存储挂载',
  boot_cmdline: '引导行',
}

// 退役证据（roadmap 下一阶段 18）：退役时落档（擦除记录/固件/SEL/BIOS 快照）。
const dcQuery = useQuery({
  queryKey: computed(() => ['machine-decommission', props.id]),
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/machines/{id}/decommission', { params: { path: { id: props.id } } })),
})
const dcReport = computed(() => dcQuery.data.value?.report ?? null)

// BIOS 基线 + 漂移（roadmap 下一阶段 13）：drift 读 = 按钮触发的活 BMC 读。
const biosBaseline = computed(() => machine.value?.bios_profile_id ?? null)
const profilesQuery = useQuery({
  queryKey: ['bios-profiles-list'],
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/bios-profiles')).then((d) => d?.items ?? []),
})
const profileName = computed(() => {
  const pid = biosBaseline.value
  if (!pid) return ''
  return profilesQuery.data.value?.find((p) => p.id === pid)?.name ?? pid
})
const driftEnabled = computed(() => !!biosBaseline.value)
const driftReading = ref(false)
const driftData = ref<components['schemas']['BiosDriftView'] | null>(null)
const driftedEntries = computed(() => Object.entries(driftData.value?.drift?.drifted ?? {}))

const selectedProfileId = ref('')
async function assignBaseline() {
  if (!selectedProfileId.value) return
  try {
    await unwrap(await getClient().PUT('/api/v1/machines/{id}/bios/baseline', {
      params: { path: { id: props.id } },
      body: { profile_id: selectedProfileId.value },
    }))
    ElMessage.success(`基线已赋值：${profilesQuery.data.value?.find((p) => p.id === selectedProfileId.value)?.name ?? selectedProfileId.value}`)
    selectedProfileId.value = ''
    void profilesQuery.refetch()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}
async function clearBaseline() {
  try {
    await ElMessageBox.confirm(
      '解除后这台机器不再有漂移比对参照（不会改动机器的 BIOS 设置）。',
      '解除基线绑定',
      { type: 'warning', confirmButtonText: '解除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await unwrap(await getClient().PUT('/api/v1/machines/{id}/bios/baseline', {
      params: { path: { id: props.id } },
      body: { profile_id: null },
    }))
    ElMessage.success('基线绑定已解除')
    driftData.value = null
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}
async function driftRead() {
  driftReading.value = true
  try {
    driftData.value = await unwrap(
      await getClient().GET('/api/v1/machines/{id}/bios/drift', { params: { path: { id: props.id } } }),
    )
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    driftReading.value = false
  }
}

// KVM：一次性 URL 端点；真机多数控制器不支持（502 BMC_UNSUPPORTED），按能力降级提示
const kvmLoading = ref(false)
async function openKvm() {
  kvmLoading.value = true
  try {
    const res = await unwrap(
      await getClient().GET('/api/v1/machines/{id}/console', { params: { path: { id: props.id } } }),
    )
    window.open(res.url, '_blank', 'noopener')
  } catch (e) {
    ElMessage.warning(`${errorMessage(e)}（KVM 依赖控制器能力，多数机型暂不支持）`)
  } finally {
    kvmLoading.value = false
  }
}

const HEALTH_META: Record<string, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  ok: { label: '正常', type: 'success' },
  warning: { label: '警告', type: 'warning' },
  critical: { label: '严重', type: 'danger' },
  unknown: { label: '未知', type: 'info' },
}

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
        <el-button :loading="kvmLoading" @click="openKvm">控制台</el-button>
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

      <el-card shadow="never" header="基础信息" class="mb">
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="机器 ID"><span class="mono">{{ machine.id }}</span></el-descriptions-item>
          <el-descriptions-item label="BMC 地址"><span class="mono">{{ machine.bmc.address }}</span></el-descriptions-item>
          <el-descriptions-item label="协议">{{ machine.bmc.protocol ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="厂商">{{ machine.bmc.vendor || '—' }}</el-descriptions-item>
          <el-descriptions-item label="型号">{{ machine.bmc.model || '—' }}</el-descriptions-item>
          <el-descriptions-item label="控制器固件">{{ machine.bmc.firmware_version || '—' }}</el-descriptions-item>
          <el-descriptions-item label="BMC 凭证"><span class="mono">{{ machine.bmc.credential_id }}</span></el-descriptions-item>
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
          <el-table-column label="健康" width="90">
            <template #default="{ row }">
              <el-tag
                v-if="row.serial && diskHealthBySerial.get(row.serial)"
                :type="diskHealthBySerial.get(row.serial) === 'pass' ? 'success' : 'danger'"
                size="small"
                effect="light"
              >
                {{ diskHealthBySerial.get(row.serial) }}
              </el-tag>
              <span v-else class="text-muted" title="无盘查健康数据（不代表不健康）">—</span>
            </template>
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

      <el-card shadow="never" class="mb">
        <template #header>
          <div class="card-head">
            <span>硬件健康（BMC 实时读）</span>
            <el-button size="small" :icon="Refresh" :loading="healthQuery.isFetching.value" @click="healthQuery.refetch()">
              重新读取
            </el-button>
          </div>
        </template>
        <el-alert
          v-if="healthQuery.error.value"
          :title="errorMessage(healthQuery.error.value)"
          type="warning"
          :closable="false"
          show-icon
        />
        <template v-else-if="healthQuery.data.value">
          <div class="health-overall">
            <span class="text-muted" style="font-size: 13px">整体结论（worst-of）</span>
            <el-tag :type="HEALTH_META[healthQuery.data.value.health]?.type ?? 'info'" effect="dark">
              {{ HEALTH_META[healthQuery.data.value.health]?.label ?? healthQuery.data.value.health }}
            </el-tag>
          </div>
          <el-table :data="healthQuery.data.value.sensors ?? []" size="small">
            <el-table-column prop="name" label="传感器" min-width="200" />
            <el-table-column label="读数" width="140">
              <template #default="{ row }">
                {{ row.reading !== undefined && row.reading !== null ? `${row.reading} ${row.unit ?? ''}` : '—' }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="HEALTH_META[row.state]?.type ?? 'info'" size="small" effect="light">
                  {{ HEALTH_META[row.state]?.label ?? row.state }}
                </el-tag>
              </template>
            </el-table-column>
            <template #empty>控制器未上报传感器</template>
          </el-table>
        </template>
        <div v-else class="text-muted">正在读取…</div>
      </el-card>

      <el-card shadow="never" class="mb">
        <template #header>
          <div class="card-head">
            <span>SEL 硬件日志（最近 500 条）</span>
            <el-button size="small" :icon="Refresh" :loading="selQuery.isFetching.value" @click="selQuery.refetch()">
              重新读取
            </el-button>
          </div>
        </template>
        <el-alert
          v-if="selQuery.error.value"
          :title="errorMessage(selQuery.error.value)"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-table v-else-if="selQuery.data.value" :data="selQuery.data.value.entries ?? []" size="small">
          <el-table-column label="级别" width="100">
            <template #default="{ row }">
              <el-tag :type="HEALTH_META[row.severity]?.type ?? 'info'" size="small" effect="light">
                {{ HEALTH_META[row.severity]?.label ?? row.severity }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="时间" width="190">
            <template #default="{ row }">{{ row.timestamp || '—' }}</template>
          </el-table-column>
          <el-table-column label="事件" min-width="320">
            <template #default="{ row }"><span class="mono" style="font-size: 12px">{{ row.message }}</span></template>
          </el-table-column>
          <template #empty>SEL 无记录</template>
        </el-table>
        <div v-else class="text-muted">正在读取…</div>
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

      <!-- BIOS 基线与漂移（roadmap 下一阶段 13）：赋值在操作下拉「BIOS 基线…」 -->
      <el-card shadow="never" class="mb">
        <template #header>
          <div class="card-head">
            <span>BIOS 基线与漂移</span>
            <el-tooltip content="实时读取 BMC 属性表并逐项比对基线，可能需要数十秒" placement="top">
              <el-button size="small" :icon="Refresh" :disabled="!driftEnabled" :loading="driftReading" @click="driftRead()">
                读取漂移
              </el-button>
            </el-tooltip>
          </div>
        </template>
        <div class="text-muted" style="font-size: 13px; margin-bottom: 10px">
          赋值只设定漂移比对的参照，不会写入机器 BIOS。
        </div>
        <div v-if="!driftEnabled" class="text-muted" style="font-size: 13px">
          未赋值基线——在操作下拉「BIOS 基线…」赋值后，这里对照基线读出漂移（matched / drifted / unknown）。
        </div>
        <template v-else>
          <div class="bios-baseline-line">
            <span class="text-muted" style="font-size: 13px">当前基线</span>
            <el-tag effect="plain">{{ profileName }}</el-tag>
            <el-select
              v-model="selectedProfileId"
              size="small"
              placeholder="换一个基线（选中后点赋值）"
              style="width: 240px"
            >
              <el-option
                v-for="p in profilesQuery.data.value ?? []"
                :key="p.id"
                :label="p.name"
                :value="p.id"
              />
            </el-select>
            <el-button size="small" @click="assignBaseline" :disabled="!selectedProfileId">赋值</el-button>
            <el-button size="small" text type="danger" @click="clearBaseline">解除绑定</el-button>
          </div>
          <template v-if="driftData?.drift">
            <div class="drift-summary">
              <el-tag type="success" effect="plain">匹配 {{ driftData.drift.matched }}</el-tag>
              <el-tag v-if="driftData.drift.drifted" type="warning" effect="plain">
                漂移 {{ Object.keys(driftData.drift.drifted).length }}
              </el-tag>
              <el-tag v-if="driftData.drift.unknown?.length" type="danger" effect="plain">
                未知 {{ driftData.drift.unknown.length }}
              </el-tag>
            </div>
            <el-table v-if="driftedEntries.length" :data="driftedEntries" size="small" class="mb-inner">
              <el-table-column prop="0" label="属性" min-width="180">
                <template #default="{ row }"><span class="mono">{{ row[0] }}</span></template>
              </el-table-column>
              <el-table-column label="基线值" min-width="140">
                <template #default="{ row }"><span class="mono">{{ JSON.stringify(row[1][0]) }}</span></template>
              </el-table-column>
              <el-table-column label="活值" min-width="140">
                <template #default="{ row }"><span class="mono">{{ JSON.stringify(row[1][1]) }}</span></template>
              </el-table-column>
            </el-table>
            <div v-if="driftData.drift.unknown?.length" class="drift-unknown">
              活表没有的基线属性：{{ driftData.drift.unknown.join('、') }}（基线先于 BIOS 升级，或属性名笔误）
            </div>
          </template>
          <div v-else-if="driftReading" class="text-muted" style="font-size: 13px">BMC 活读中…</div>
        </template>
      </el-card>

      <!-- 装后验收报告（roadmap 下一阶段 12）：有报告才显示 -->
      <el-card v-if="acceptance" shadow="never" class="mb">
        <template #header>
          <div class="card-head">
            <span>装后验收报告</span>
            <el-tag :type="VERDICT_META[acceptance.verdict]?.type ?? 'info'" effect="dark">
              {{ VERDICT_META[acceptance.verdict]?.label ?? acceptance.verdict }}
            </el-tag>
          </div>
        </template>
        <el-table :data="acceptance.checks ?? []" size="small" class="mb-inner">
          <el-table-column label="检查项" width="140">
            <template #default="{ row }">{{ CHECK_LABEL[row.name] ?? row.name }}</template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag
                :type="row.status === 'ok' ? 'success' : row.status === 'mismatch' ? 'danger' : 'warning'"
                effect="plain"
              >
                {{ row.status === 'ok' ? '符合' : row.status === 'mismatch' ? '不符' : '无数据' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="详情" min-width="260">
            <template #default="{ row }"><span class="mono" style="font-size: 12px">{{ row.detail || '—' }}</span></template>
          </el-table-column>
        </el-table>
        <div v-if="acceptance.system" class="system-facts">
          <span class="text-muted" style="font-size: 13px">
            {{ acceptance.system.os }} · 内核 {{ acceptance.system.kernel }} · 主机名 {{ acceptance.system.hostname }}
          </span>
        </div>
      </el-card>

      <!-- 退役证据（roadmap 下一阶段 18）：有报告才显示 -->
      <el-card v-if="dcReport" shadow="never" class="mb">
        <template #header>
          <div class="card-head">
            <span>退役证据</span>
            <el-tag effect="plain">已退役资产</el-tag>
          </div>
        </template>
        <pre class="dc-pre">{{ JSON.stringify(dcReport, null, 2) }}</pre>
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
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.health-overall {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.bios-baseline-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.drift-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.drift-unknown {
  font-size: 12px;
  color: var(--el-color-danger);
  margin-top: 8px;
}
.system-facts {
  margin-top: 10px;
}
.dc-pre {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
