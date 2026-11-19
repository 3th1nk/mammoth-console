<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ArrowLeft, RefreshCcw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import {
  machineKey,
  machineLayoutKey,
  machineHealthKey,
  machineSelKey,
  machineAcceptanceKey,
  machineDecommissionKey,
  biosProfilesKey,
} from '@/api/queryKeys'
import { confirm } from '@/composables/confirm'
import { toneBadgeStyle, type StateTone } from '@/utils/stateColors'
import type { components } from '@/api/types.gen'
import StateBadge from '@/components/StateBadge.vue'
import PowerBadge from '@/components/PowerBadge.vue'
import MachineActions from '@/components/MachineActions.vue'
import DescriptionList from '@/components/DescriptionList.vue'
import DescriptionItem from '@/components/DescriptionItem.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import EmptyState from '@/components/EmptyState.vue'
import { formatBytes, formatTime } from '@/utils/format'

type Machine = components['schemas']['Machine']

const props = defineProps<{ id: string }>()
const router = useRouter()
const queryClient = useQueryClient()

const query = useQuery({
  queryKey: computed(() => machineKey(props.id)),
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/machines/{id}', { params: { path: { id: props.id } } })),
})

const machine = computed(() => query.data.value as Machine | undefined)
const hardware = computed(() => machine.value?.hardware)
// headless(protocol=none,docs/13):无带外控制器——健康/SEL/固件清单/BIOS 漂移
// 四卡的数据源全是 BMC 活读或 Redfish 盘查产出,整组隐藏;基础信息的带外
// 字段以占位符呈现。
const headless = computed(() => machine.value?.bmc.protocol === 'none')

// 分区快照：磁盘健康徽章数据源（ramdisk 探针 smartctl/nvme 读数）
const layoutQuery = useQuery({
  queryKey: computed(() => machineLayoutKey(props.id)),
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
  queryKey: computed(() => machineHealthKey(props.id)),
  retry: 0,
  // headless 无 BMC 活读面,引擎门即 422——不发请求
  enabled: computed(() => !headless.value),
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/machines/{id}/health', {
        params: { path: { id: props.id } },
        signal: AbortSignal.timeout(LIVE_READ_TIMEOUT_MS),
      }),
    ),
})
const selQuery = useQuery({
  queryKey: computed(() => machineSelKey(props.id)),
  retry: 0,
  enabled: computed(() => !headless.value),
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
  queryKey: computed(() => machineAcceptanceKey(props.id)),
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/machines/{id}/acceptance', { params: { path: { id: props.id } } })),
})
const acceptance = computed(() => acceptanceQuery.data.value?.report ?? null)

// 退役证据（roadmap 下一阶段 18）：退役时落档（擦除记录/固件/SEL/BIOS 快照）。
const dcQuery = useQuery({
  queryKey: computed(() => machineDecommissionKey(props.id)),
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/machines/{id}/decommission', { params: { path: { id: props.id } } })),
})
const dcReport = computed(() => dcQuery.data.value?.report ?? null)

// BIOS 基线 + 漂移（roadmap 下一阶段 13）：drift 读 = 按钮触发的活 BMC 读。
const biosBaseline = computed(() => machine.value?.bios_profile_id ?? null)
const profilesQuery = useQuery({
  queryKey: biosProfilesKey,
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
    toast.success(`基线已赋值：${profilesQuery.data.value?.find((p) => p.id === selectedProfileId.value)?.name ?? selectedProfileId.value}`)
    selectedProfileId.value = ''
    void profilesQuery.refetch()
    // 「当前基线」标签来自 machine.bios_profile_id：不失效 machine 查询
    // 页面会一直显示旧值（事件总线的 bios_profile 前缀不覆盖这台机器的
    // 即时反馈，这里补上）
    void queryClient.invalidateQueries({ queryKey: machineKey(props.id) })
  } catch (e) {
    toast.error(errorMessage(e))
  }
}
async function clearBaseline() {
  const ok = await confirm({
    title: '解除基线绑定',
    description: '解除后这台机器不再有漂移比对参照（不会改动机器的 BIOS 设置）。',
    confirmText: '解除',
  })
  if (!ok) return
  try {
    await unwrap(await getClient().PUT('/api/v1/machines/{id}/bios/baseline', {
      params: { path: { id: props.id } },
      body: { profile_id: null },
    }))
    toast.success('基线绑定已解除')
    driftData.value = null
    // 同 assignBaseline：解除后「当前基线」标签要即时归零
    void queryClient.invalidateQueries({ queryKey: machineKey(props.id) })
  } catch (e) {
    toast.error(errorMessage(e))
  }
}
async function driftRead() {
  driftReading.value = true
  try {
    driftData.value = await unwrap(
      await getClient().GET('/api/v1/machines/{id}/bios/drift', { params: { path: { id: props.id } } }),
    )
  } catch (e) {
    toast.error(errorMessage(e))
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
    toast.warning(`${errorMessage(e)}（KVM 依赖控制器能力，多数机型暂不支持）`)
  } finally {
    kvmLoading.value = false
  }
}

const HEALTH_TONE: Record<string, StateTone> = {
  ok: 'success',
  warning: 'warning',
  critical: 'danger',
  unknown: 'neutral',
}
const HEALTH_LABEL: Record<string, string> = {
  ok: '正常',
  warning: '警告',
  critical: '严重',
  unknown: '未知',
}

function healthBadge(state?: string) {
  const tone = HEALTH_TONE[state ?? ''] ?? 'neutral'
  return { label: HEALTH_LABEL[state ?? ''] ?? state, style: toneBadgeStyle(tone) }
}

const VERDICT_TONE: Record<string, StateTone> = { pass: 'success', degraded: 'warning', fail: 'danger' }
const VERDICT_LABEL: Record<string, string> = { pass: '通过', degraded: '降级', fail: '不符' }
const CHECK_LABEL: Record<string, string> = {
  system_facts: '系统事实',
  hostname: '主机名',
  storage_mounts: '存储挂载',
  boot_cmdline: '引导行',
}

function verdictBadge(verdict: string) {
  const tone = VERDICT_TONE[verdict] ?? 'neutral'
  return { label: VERDICT_LABEL[verdict] ?? verdict, style: toneBadgeStyle(tone) }
}

const title = computed(() => {
  const m = machine.value
  if (!m) return props.id
  return m.hardware?.serial_number || m.bmc.address
})
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon" class="size-8 shrink-0" @click="router.push({ name: 'machines' })">
          <ArrowLeft class="size-4" />
          <span class="sr-only">返回列表</span>
        </Button>
        <h2 class="truncate font-mono text-xl font-bold tracking-tight">{{ title }}</h2>
        <StateBadge v-if="machine" kind="machine" :state="machine.state" />
        <PowerBadge v-if="machine" :state="machine.power_state" />
      </div>
      <div class="flex items-center gap-2">
        <!-- headless(protocol=none) 无带外,KVM 依赖 BMC 控制器——直接隐藏 -->
        <Button
          v-if="machine && machine.bmc.protocol !== 'none'"
          variant="outline"
          size="sm"
          :disabled="kvmLoading"
          @click="openKvm"
        >
          控制台
        </Button>
        <MachineActions v-if="machine" :machine-id="machine.id" :bmc="machine.bmc" @submitted="query.refetch()" />
        <Button variant="outline" size="sm" @click="query.refetch()">
          <RefreshCcw class="size-4" /> 刷新
        </Button>
      </div>
    </div>

    <Alert v-if="query.error.value" variant="destructive">
      <AlertTitle>{{ errorMessage(query.error.value) }}</AlertTitle>
    </Alert>
    <Skeleton v-else-if="query.isPending.value" class="h-64 w-full" />

    <template v-else-if="machine">
      <Alert v-if="machine.last_error" variant="destructive">
        <AlertTitle>上一次错误：{{ machine.last_error.code ?? '' }}</AlertTitle>
        <AlertDescription>{{ machine.last_error.message }}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader><CardTitle class="text-base">基础信息</CardTitle></CardHeader>
        <CardContent>
          <DescriptionList :columns="3">
            <DescriptionItem label="机器 ID" mono>{{ machine.id }}</DescriptionItem>
            <DescriptionItem label="BMC 地址" mono>{{ machine.bmc.address }}</DescriptionItem>
            <DescriptionItem label="协议">{{ machine.bmc.protocol ?? '—' }}</DescriptionItem>
            <!-- headless:带外字段无值可填,以「无带外」占位;BMC 地址是 none://<MAC> 机器身份,照实显示 -->
            <DescriptionItem label="厂商">
              <span v-if="headless" class="text-muted-foreground">无带外</span>
              <template v-else>{{ machine.bmc.vendor || '—' }}</template>
            </DescriptionItem>
            <DescriptionItem label="型号">
              <span v-if="headless" class="text-muted-foreground">无带外</span>
              <template v-else>{{ machine.bmc.model || '—' }}</template>
            </DescriptionItem>
            <DescriptionItem label="控制器固件">
              <span v-if="headless" class="text-muted-foreground">无带外</span>
              <template v-else>{{ machine.bmc.firmware_version || '—' }}</template>
            </DescriptionItem>
            <DescriptionItem label="BMC 凭证" mono>
              <span v-if="headless" class="text-muted-foreground">无带外</span>
              <template v-else>{{ machine.bmc.credential_id }}</template>
            </DescriptionItem>
            <DescriptionItem label="SSH 凭证" mono>{{ machine.ssh_credential_id || '—' }}</DescriptionItem>
            <DescriptionItem label="带内地址" mono>{{ machine.ssh?.address || '—' }}</DescriptionItem>
            <DescriptionItem label="注册时间">{{ formatTime(machine.created_at) }}</DescriptionItem>
            <DescriptionItem label="更新时间">{{ formatTime(machine.updated_at) }}</DescriptionItem>
            <DescriptionItem label="标签">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="(v, k) in machine.labels"
                  :key="k"
                  class="inline-flex rounded-md border bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground"
                >
                  {{ k }}={{ v }}
                </span>
                <span v-if="Object.keys(machine.labels).length === 0" class="text-muted-foreground">—</span>
              </div>
            </DescriptionItem>
          </DescriptionList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle class="text-base">硬件规格（探针采集）</CardTitle></CardHeader>
        <CardContent class="flex flex-col gap-3">
          <Alert v-if="hardware?.coverage === 'partial'" class="border-amber-500/40 bg-amber-500/5">
            <AlertTitle class="text-amber-700 dark:text-amber-400">本次盘查存在盲区（coverage=partial）</AlertTitle>
            <AlertDescription>{{ hardware.coverage_notes?.join('；') || '厂商能力矩阵命中已知盲区' }}</AlertDescription>
          </Alert>
          <DescriptionList :columns="3">
            <DescriptionItem label="整机序列号" mono>{{ hardware?.serial_number || '—' }}</DescriptionItem>
            <DescriptionItem label="CPU">{{ hardware?.cpu?.model || '—' }}</DescriptionItem>
            <DescriptionItem label="核数 / 内存">
              {{ hardware?.cpu?.cores ?? '—' }}C · {{ formatBytes(hardware?.memory_bytes) }}
            </DescriptionItem>
          </DescriptionList>

          <div class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="w-28">磁盘</TableHead>
                  <TableHead class="min-w-[150px]">序列号</TableHead>
                  <TableHead class="w-28">容量</TableHead>
                  <TableHead class="w-20">健康</TableHead>
                  <TableHead class="w-20">介质</TableHead>
                  <TableHead class="w-28">协议</TableHead>
                  <TableHead class="w-20">可拔除</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in hardware?.disks ?? []" :key="row.name">
                  <TableCell><span class="font-mono text-xs">{{ row.name }}</span></TableCell>
                  <TableCell><span class="font-mono text-xs">{{ row.serial || '—' }}</span></TableCell>
                  <TableCell class="text-muted-foreground">{{ formatBytes(row.size_bytes) }}</TableCell>
                  <TableCell>
                    <Badge
                      v-if="row.serial && diskHealthBySerial.get(row.serial)"
                      variant="outline"
                      class="rounded-md font-medium"
                      :style="toneBadgeStyle(diskHealthBySerial.get(row.serial) === 'pass' ? 'success' : 'danger')"
                    >
                      {{ diskHealthBySerial.get(row.serial) }}
                    </Badge>
                    <span v-else class="text-xs text-muted-foreground" title="无盘查健康数据（不代表不健康）">—</span>
                  </TableCell>
                  <TableCell class="text-muted-foreground">{{ row.medium }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ row.protocol }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ row.removable ? '是' : '否' }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="(hardware?.disks ?? []).length === 0" description="尚无磁盘信息（盘查完成后回填）" />
          </div>

          <div class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="w-28">网卡</TableHead>
                  <TableHead class="min-w-[150px]">MAC</TableHead>
                  <TableHead class="w-32">速率</TableHead>
                  <TableHead class="w-20">链路</TableHead>
                  <TableHead class="min-w-[160px]">PCI 地址</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in hardware?.nics ?? []" :key="row.name + row.mac">
                  <TableCell><span class="font-mono text-xs">{{ row.name }}</span></TableCell>
                  <TableCell><span class="font-mono text-xs">{{ row.mac }}</span></TableCell>
                  <TableCell class="text-muted-foreground">{{ row.speed_mbps ? `${row.speed_mbps} Mbps` : '—' }}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      class="rounded-md font-medium"
                      :style="toneBadgeStyle(row.link_up ? 'success' : 'neutral')"
                    >
                      {{ row.link_up ? 'Up' : 'Down' }}
                    </Badge>
                  </TableCell>
                  <TableCell><span class="font-mono text-xs">{{ row.pci_address || '—' }}</span></TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="(hardware?.nics ?? []).length === 0" description="尚无网卡信息（盘查完成后回填）" />
          </div>
        </CardContent>
      </Card>

      <Card v-if="!headless">
        <CardHeader>
          <CardTitle class="text-base">硬件健康（BMC 实时读）</CardTitle>
          <CardAction>
            <Button variant="outline" size="sm" :disabled="healthQuery.isFetching.value" @click="healthQuery.refetch()">
              <RefreshCcw class="size-4" /> 重新读取
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <Alert v-if="healthQuery.error.value" class="border-amber-500/40 bg-amber-500/5">
            <AlertTitle>{{ errorMessage(healthQuery.error.value) }}</AlertTitle>
          </Alert>
          <template v-else-if="healthQuery.data.value">
            <div class="flex items-center gap-2.5 text-sm">
              <span class="text-muted-foreground">整体结论（worst-of）</span>
              <Badge
                variant="outline"
                class="rounded-md font-medium"
                :style="healthBadge(healthQuery.data.value.health).style"
              >
                {{ healthBadge(healthQuery.data.value.health).label }}
              </Badge>
            </div>
            <div class="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/50 hover:bg-muted/50">
                    <TableHead class="min-w-[200px]">传感器</TableHead>
                    <TableHead class="w-36">读数</TableHead>
                    <TableHead class="w-28">状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="row in healthQuery.data.value.sensors ?? []" :key="row.name">
                    <TableCell>{{ row.name }}</TableCell>
                    <TableCell class="text-muted-foreground">
                      {{ row.reading !== undefined && row.reading !== null ? `${row.reading} ${row.unit ?? ''}` : '—' }}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" class="rounded-md font-medium" :style="healthBadge(row.state).style">
                        {{ healthBadge(row.state).label }}
                      </Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <EmptyState v-if="(healthQuery.data.value.sensors ?? []).length === 0" description="控制器未上报传感器" />
            </div>
          </template>
          <p v-else class="text-sm text-muted-foreground">正在读取…</p>
        </CardContent>
      </Card>

      <Card v-if="!headless">
        <CardHeader>
          <CardTitle class="text-base">SEL 硬件日志（最近 500 条）</CardTitle>
          <CardAction>
            <Button variant="outline" size="sm" :disabled="selQuery.isFetching.value" @click="selQuery.refetch()">
              <RefreshCcw class="size-4" /> 重新读取
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <Alert v-if="selQuery.error.value" class="border-amber-500/40 bg-amber-500/5">
            <AlertTitle>{{ errorMessage(selQuery.error.value) }}</AlertTitle>
          </Alert>
          <div v-else-if="selQuery.data.value" class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="w-24">级别</TableHead>
                  <TableHead class="w-48">时间</TableHead>
                  <TableHead class="min-w-[300px]">事件</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="(row, i) in selQuery.data.value.entries ?? []" :key="i">
                  <TableCell>
                    <Badge variant="outline" class="rounded-md font-medium" :style="healthBadge(row.severity).style">
                      {{ healthBadge(row.severity).label }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-muted-foreground">{{ row.timestamp || '—' }}</TableCell>
                  <TableCell><span class="font-mono text-xs">{{ row.message }}</span></TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="(selQuery.data.value.entries ?? []).length === 0" description="SEL 无记录" />
          </div>
          <p v-else class="text-sm text-muted-foreground">正在读取…</p>
        </CardContent>
      </Card>

      <!-- 固件清单仅 Redfish 盘查产出,headless 机器永远为空——整卡隐藏 -->
      <Card v-if="!headless">
        <CardHeader><CardTitle class="text-base">控制器固件清单（仅 Redfish 盘查产出）</CardTitle></CardHeader>
        <CardContent>
          <div class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="min-w-[200px]">组件 ID</TableHead>
                  <TableHead class="min-w-[200px]">名称</TableHead>
                  <TableHead class="min-w-[160px]">版本</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in machine.firmware ?? []" :key="row.id">
                  <TableCell><span class="font-mono text-xs">{{ row.id }}</span></TableCell>
                  <TableCell>{{ row.name }}</TableCell>
                  <TableCell><span class="font-mono text-xs">{{ row.version || '—' }}</span></TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="(machine.firmware ?? []).length === 0" description="无固件清单（IPMI 协议或尚未盘查）" />
          </div>
        </CardContent>
      </Card>

      <!-- BIOS 基线与漂移(roadmap 下一阶段 13):赋值入口就在本卡片。
           headless 无 BMC 活读,漂移比对无从谈起——整卡隐藏 -->
      <Card v-if="!headless">
        <CardHeader>
          <CardTitle class="text-base">BIOS 基线与漂移</CardTitle>
          <CardAction>
            <TooltipProvider :delay-duration="200">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="!driftEnabled"
                    :loading="driftReading"
                    @click="driftRead()"
                  >
                    <RefreshCcw class="size-4" /> 读取漂移
                  </Button>
                </TooltipTrigger>
                <TooltipContent>实时读取 BMC 属性表并逐项比对基线，可能需要数十秒</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardAction>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-2.5">
            <span class="text-sm text-muted-foreground">当前基线</span>
            <Badge v-if="profileName" variant="outline" class="rounded-md font-medium">{{ profileName }}</Badge>
            <Badge v-else variant="outline" class="rounded-md font-medium text-muted-foreground">未赋值</Badge>
            <Select v-model="selectedProfileId">
              <SelectTrigger class="w-[240px]">
                <SelectValue placeholder="选择基线（选中后点赋值）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in profilesQuery.data.value ?? []" :key="p.id" :value="p.id">
                  {{ p.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" :disabled="!selectedProfileId" @click="assignBaseline">赋值</Button>
            <Button
              variant="ghost"
              size="sm"
              class="text-destructive hover:text-destructive"
              :disabled="!driftEnabled"
              @click="clearBaseline"
            >
              解除绑定
            </Button>
          </div>
          <p class="text-xs leading-relaxed text-muted-foreground">
            赋值只设定漂移比对的参照，不会写入机器 BIOS。
            <template v-if="!driftEnabled">赋值后即可在这里对照基线读取漂移（匹配 / 漂移 / 未知）。</template>
          </p>
          <template v-if="driftData?.drift">
            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="outline" class="rounded-md font-medium" :style="toneBadgeStyle('success')">
                匹配 {{ driftData.drift.matched }}
              </Badge>
              <Badge v-if="driftData.drift.drifted" variant="outline" class="rounded-md font-medium" :style="toneBadgeStyle('warning')">
                漂移 {{ Object.keys(driftData.drift.drifted).length }}
              </Badge>
              <Badge v-if="driftData.drift.unknown?.length" variant="outline" class="rounded-md font-medium" :style="toneBadgeStyle('danger')">
                未知 {{ driftData.drift.unknown.length }}
              </Badge>
            </div>
            <div v-if="driftedEntries.length" class="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/50 hover:bg-muted/50">
                    <TableHead class="min-w-[180px]">属性</TableHead>
                    <TableHead class="min-w-[140px]">基线值</TableHead>
                    <TableHead class="min-w-[140px]">活值</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="[key, pair] in driftedEntries" :key="key">
                    <TableCell><span class="font-mono text-xs">{{ key }}</span></TableCell>
                    <TableCell><span class="font-mono text-xs">{{ JSON.stringify(pair[0]) }}</span></TableCell>
                    <TableCell><span class="font-mono text-xs">{{ JSON.stringify(pair[1]) }}</span></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <p v-if="driftData.drift.unknown?.length" class="text-xs text-destructive">
              活表没有的基线属性：{{ driftData.drift.unknown.join('、') }}（基线先于 BIOS 升级，或属性名笔误）
            </p>
          </template>
          <p v-else-if="driftReading" class="text-sm text-muted-foreground">BMC 活读中…</p>
        </CardContent>
      </Card>

      <!-- 装后验收报告（roadmap 下一阶段 12）：有报告才显示 -->
      <Card v-if="acceptance">
        <CardHeader>
          <CardTitle class="text-base">装后验收报告</CardTitle>
          <CardAction>
            <Badge variant="outline" class="rounded-md font-medium" :style="verdictBadge(acceptance.verdict).style">
              {{ verdictBadge(acceptance.verdict).label }}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <div class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="w-36">检查项</TableHead>
                  <TableHead class="w-28">状态</TableHead>
                  <TableHead class="min-w-[260px]">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in acceptance.checks ?? []" :key="row.name">
                  <TableCell>{{ CHECK_LABEL[row.name] ?? row.name }}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      class="rounded-md font-medium"
                      :style="toneBadgeStyle(row.status === 'ok' ? 'success' : row.status === 'mismatch' ? 'danger' : 'warning')"
                    >
                      {{ row.status === 'ok' ? '符合' : row.status === 'mismatch' ? '不符' : '无数据' }}
                    </Badge>
                  </TableCell>
                  <TableCell><span class="font-mono text-xs">{{ row.detail || '—' }}</span></TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="(acceptance.checks ?? []).length === 0" description="无验收检查记录" />
          </div>
          <p v-if="acceptance.system" class="text-sm text-muted-foreground">
            {{ acceptance.system.os }} · 内核 {{ acceptance.system.kernel }} · 主机名 {{ acceptance.system.hostname }}
          </p>
        </CardContent>
      </Card>

      <!-- 退役证据（roadmap 下一阶段 18）：有报告才显示 -->
      <Card v-if="dcReport">
        <CardHeader>
          <CardTitle class="text-base">退役证据</CardTitle>
          <CardAction>
            <Badge variant="outline" class="rounded-md font-medium">已退役资产</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <pre class="max-h-[420px] overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed">{{ JSON.stringify(dcReport, null, 2) }}</pre>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
