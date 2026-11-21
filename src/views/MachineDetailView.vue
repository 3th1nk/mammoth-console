<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ArrowLeft, RefreshCcw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
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
const { t } = useI18n()
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
// BMC 活读改为手动触发:活读是引擎同步走 BMC 的多请求遍历,与装机 boot
// 窗口共享 iBMC 的会话预算——打开详情页就自动轮询会在关键窗口挤占会话
// (2026-11-21 实录:KVM + 详情页与装机 boot 并发,boot 阶段 412/SEL 超时)。
// 卡片打开呈提示态,点「重新读取」才发起。
const liveReadArmed = ref(false)
async function armLiveRead(q: { refetch: () => Promise<unknown> }) {
  liveReadArmed.value = true
  await q.refetch()
}
const healthQuery = useQuery({
  queryKey: computed(() => machineHealthKey(props.id)),
  retry: 0,
  // headless 无 BMC 活读面,引擎门即 422——不发请求
  enabled: computed(() => liveReadArmed.value && !headless.value),
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
  enabled: computed(() => liveReadArmed.value && !headless.value),
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
    toast.success(t('machineDetail.assigned', { name: profilesQuery.data.value?.find((p) => p.id === selectedProfileId.value)?.name ?? selectedProfileId.value }))
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
    title: t('machineDetail.assignConfirmTitle'),
    description: t('machineDetail.assignConfirmDesc'),
    confirmText: t('machineDetail.assignConfirmText'),
  })
  if (!ok) return
  try {
    await unwrap(await getClient().PUT('/api/v1/machines/{id}/bios/baseline', {
      params: { path: { id: props.id } },
      body: { profile_id: null },
    }))
    toast.success(t('machineDetail.unbound'))
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
    toast.warning(t('machineDetail.kvmTip', { msg: errorMessage(e) }))
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
  ok: 'machineDetail.healthOk',
  warning: 'machineDetail.healthWarning',
  critical: 'machineDetail.healthCritical',
  unknown: 'machineDetail.healthUnknown',
}

function healthBadge(state?: string) {
  const tone = HEALTH_TONE[state ?? ''] ?? 'neutral'
  const key = HEALTH_LABEL[state ?? ''] ?? 'machineDetail.healthUnknown'
  return { label: t(key), style: toneBadgeStyle(tone) }
}

const VERDICT_TONE: Record<string, StateTone> = { pass: 'success', degraded: 'warning', fail: 'danger' }
const VERDICT_LABEL: Record<string, string> = { pass: 'machineDetail.verdictPass', degraded: 'machineDetail.verdictDegraded', fail: 'machineDetail.verdictFail' }
const CHECK_LABEL: Record<string, string> = {
  system_facts: 'machineDetail.checkSystemFacts',
  hostname: 'machineDetail.checkHostname',
  storage_mounts: 'machineDetail.checkStorageMounts',
  boot_cmdline: 'machineDetail.checkBootCmdline',
}

function verdictBadge(verdict: string) {
  const tone = VERDICT_TONE[verdict] ?? 'neutral'
  const key = VERDICT_LABEL[verdict] ?? 'machineDetail.verdictFail'
  return { label: t(key), style: toneBadgeStyle(tone) }
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
          <span class="sr-only">{{ t('machineDetail.backToList') }}</span>
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
          {{ t('machines.console') }}
        </Button>
        <MachineActions v-if="machine" :machine-id="machine.id" :bmc="machine.bmc" @submitted="query.refetch()" />
        <Button variant="outline" size="sm" @click="query.refetch()">
          <RefreshCcw class="size-4" /> {{ t('common.refresh') }}
        </Button>
      </div>
    </div>

    <Alert v-if="query.error.value" variant="destructive">
      <AlertTitle>{{ errorMessage(query.error.value) }}</AlertTitle>
    </Alert>
    <Skeleton v-else-if="query.isPending.value" class="h-64 w-full" />

    <template v-else-if="machine">
      <Alert v-if="machine.last_error" variant="destructive">
        <AlertTitle>{{ t('machineDetail.lastError', { code: machine.last_error.code ?? '' }) }}</AlertTitle>
        <AlertDescription>{{ machine.last_error.message }}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader><CardTitle class="text-base">{{ t('machineDetail.basic') }}</CardTitle></CardHeader>
        <CardContent>
          <DescriptionList :columns="3">
            <DescriptionItem :label="t('machineDetail.machineId')" mono>{{ machine.id }}</DescriptionItem>
            <DescriptionItem :label="t('machineDetail.bmcAddress')" mono>{{ machine.bmc.address }}</DescriptionItem>
            <DescriptionItem :label="t('machineDetail.protocol')">{{ machine.bmc.protocol ?? '—' }}</DescriptionItem>
            <!-- headless:带外字段无值可填,以「无带外」占位;BMC 地址是 none://<MAC> 机器身份,照实显示 -->
            <DescriptionItem :label="t('machineDetail.vendor')">
              <span v-if="headless" class="text-muted-foreground">{{ t('machineDetail.headless') }}</span>
              <template v-else>{{ machine.bmc.vendor || '—' }}</template>
            </DescriptionItem>
            <DescriptionItem :label="t('machineDetail.model')">
              <span v-if="headless" class="text-muted-foreground">{{ t('machineDetail.headless') }}</span>
              <template v-else>{{ machine.bmc.model || '—' }}</template>
            </DescriptionItem>
            <DescriptionItem :label="t('machineDetail.firmware')">
              <span v-if="headless" class="text-muted-foreground">{{ t('machineDetail.headless') }}</span>
              <template v-else>{{ machine.bmc.firmware_version || '—' }}</template>
            </DescriptionItem>
            <DescriptionItem :label="t('machineDetail.bmcCredential')" mono>
              <span v-if="headless" class="text-muted-foreground">{{ t('machineDetail.headless') }}</span>
              <template v-else>{{ machine.bmc.credential_id }}</template>
            </DescriptionItem>
            <DescriptionItem :label="t('machineDetail.sshCredential')" mono>{{ machine.ssh_credential_id || '—' }}</DescriptionItem>
            <DescriptionItem :label="t('machineDetail.sshAddress')" mono>{{ machine.ssh?.address || '—' }}</DescriptionItem>
            <DescriptionItem :label="t('machineDetail.createdAt')">{{ formatTime(machine.created_at) }}</DescriptionItem>
            <DescriptionItem :label="t('machineDetail.updatedAt')">{{ formatTime(machine.updated_at) }}</DescriptionItem>
            <DescriptionItem :label="t('machineDetail.labels')">
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
        <CardHeader><CardTitle class="text-base">{{ t('machineDetail.hardware') }}</CardTitle></CardHeader>
        <CardContent class="flex flex-col gap-3">
          <Alert v-if="hardware?.coverage === 'partial'" class="border-amber-500/40 bg-amber-500/5">
            <AlertTitle class="text-amber-700 dark:text-amber-400">{{ t('machineDetail.coveragePartial') }}</AlertTitle>
            <AlertDescription>{{ hardware.coverage_notes?.join('；') || t('machineDetail.coverageNotes') }}</AlertDescription>
          </Alert>
          <DescriptionList :columns="3">
            <DescriptionItem :label="t('machineDetail.serial')" mono>{{ hardware?.serial_number || '—' }}</DescriptionItem>
            <DescriptionItem :label="t('machineDetail.cpu')">{{ hardware?.cpu?.model || '—' }}</DescriptionItem>
            <DescriptionItem :label="t('machineDetail.coresMemory')">
              {{ hardware?.cpu?.cores ?? '—' }}C · {{ formatBytes(hardware?.memory_bytes) }}
            </DescriptionItem>
          </DescriptionList>

          <div class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="w-28">{{ t('machineDetail.colDisk') }}</TableHead>
                  <TableHead class="min-w-[150px]">{{ t('machineDetail.colDiskSerial') }}</TableHead>
                  <TableHead class="w-28">{{ t('machineDetail.colSize') }}</TableHead>
                  <TableHead class="w-20">{{ t('machineDetail.colHealth') }}</TableHead>
                  <TableHead class="w-20">{{ t('machineDetail.colMedium') }}</TableHead>
                  <TableHead class="w-28">{{ t('machineDetail.colDiskProtocol') }}</TableHead>
                  <TableHead class="w-20">{{ t('machineDetail.colRemovable') }}</TableHead>
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
                    <span v-else class="text-xs text-muted-foreground" :title="t('machineDetail.noSerial')">—</span>
                  </TableCell>
                  <TableCell class="text-muted-foreground">{{ row.medium }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ row.protocol }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ row.removable ? '✓' : '—' }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="(hardware?.disks ?? []).length === 0" :description="t('machineDetail.disksEmpty')" />
          </div>

          <div class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="w-28">{{ t('machineDetail.colNic') }}</TableHead>
                  <TableHead class="min-w-[150px]">{{ t('machineDetail.colMac') }}</TableHead>
                  <TableHead class="w-32">{{ t('machineDetail.colSpeed') }}</TableHead>
                  <TableHead class="w-20">{{ t('machineDetail.colLink') }}</TableHead>
                  <TableHead class="min-w-[160px]">{{ t('machineDetail.colPci') }}</TableHead>
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
            <EmptyState v-if="(hardware?.nics ?? []).length === 0" :description="t('machineDetail.nicsEmpty')" />
          </div>
        </CardContent>
      </Card>

      <Card v-if="!headless">
        <CardHeader>
          <CardTitle class="text-base">{{ t('machineDetail.health') }}</CardTitle>
          <CardAction>
            <Button variant="outline" size="sm" :disabled="healthQuery.isFetching.value" @click="armLiveRead(healthQuery)">
              <RefreshCcw class="size-4" /> {{ t('machineDetail.reread') }}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <Alert v-if="healthQuery.error.value" class="border-amber-500/40 bg-amber-500/5">
            <AlertTitle>{{ errorMessage(healthQuery.error.value) }}</AlertTitle>
          </Alert>
          <template v-else-if="healthQuery.data.value">
            <div class="flex items-center gap-2.5 text-sm">
              <span class="text-muted-foreground">{{ t('machineDetail.overall') }}</span>
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
                    <TableHead class="min-w-[200px]">{{ t('machineDetail.colName') }}</TableHead>
                    <TableHead class="w-36">{{ t('machineDetail.reading') }}</TableHead>
                    <TableHead class="w-28">{{ t('machineDetail.colStatus') }}</TableHead>
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
              <EmptyState v-if="(healthQuery.data.value.sensors ?? []).length === 0" :description="t('machineDetail.sensorsEmpty')" />
            </div>
          </template>
          <p v-else class="text-sm text-muted-foreground">{{ t('machineDetail.reading') }}</p>
        </CardContent>
      </Card>

      <Card v-if="!headless">
        <CardHeader>
          <CardTitle class="text-base">{{ t('machineDetail.sel') }}</CardTitle>
          <CardAction>
            <Button variant="outline" size="sm" :disabled="selQuery.isFetching.value" @click="armLiveRead(selQuery)">
              <RefreshCcw class="size-4" /> {{ t('machineDetail.reread') }}
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
                  <TableHead class="w-24">{{ t('machineDetail.colLevel') }}</TableHead>
                  <TableHead class="w-48">{{ t('machineDetail.colTime') }}</TableHead>
                  <TableHead class="min-w-[300px]">{{ t('machineDetail.colEvent') }}</TableHead>
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
            <EmptyState v-if="(selQuery.data.value.entries ?? []).length === 0" :description="t('machineDetail.selEmpty')" />
          </div>
          <p v-else class="text-sm text-muted-foreground">
            {{ t('machineDetail.liveReadHint') }}
          </p>
        </CardContent>
      </Card>

      <!-- 固件清单仅 Redfish 盘查产出,headless 机器永远为空——整卡隐藏 -->
      <Card v-if="!headless">
        <CardHeader><CardTitle class="text-base">{{ t('machineDetail.firmwareInventory') }}</CardTitle></CardHeader>
        <CardContent>
          <div class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="min-w-[200px]">{{ t('machineDetail.colComponent') }}</TableHead>
                  <TableHead class="min-w-[200px]">{{ t('machineDetail.colName') }}</TableHead>
                  <TableHead class="min-w-[160px]">{{ t('machineDetail.colVersion') }}</TableHead>
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
            <EmptyState v-if="(machine.firmware ?? []).length === 0" :description="t('machineDetail.firmwareEmpty')" />
          </div>
        </CardContent>
      </Card>

      <!-- BIOS 基线与漂移(roadmap 下一阶段 13):赋值入口就在本卡片。
           headless 无 BMC 活读,漂移比对无从谈起——整卡隐藏 -->
      <Card v-if="!headless">
        <CardHeader>
          <CardTitle class="text-base">{{ t('machineDetail.bios') }}</CardTitle>
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
                    <RefreshCcw class="size-4" /> {{ t('machineDetail.readDrift') }}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ t('machineDetail.readDriftTip') }}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardAction>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-2.5">
            <span class="text-sm text-muted-foreground">{{ t('machineDetail.currentBaseline') }}</span>
            <Badge v-if="profileName" variant="outline" class="rounded-md font-medium">{{ profileName }}</Badge>
            <Badge v-else variant="outline" class="rounded-md font-medium text-muted-foreground">{{ t('machineDetail.baselineUnset') }}</Badge>
            <Select v-model="selectedProfileId">
              <SelectTrigger class="w-[240px]">
                <SelectValue :placeholder="t('machineDetail.baselinePlaceholder')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in profilesQuery.data.value ?? []" :key="p.id" :value="p.id">
                  {{ p.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" :disabled="!selectedProfileId" @click="assignBaseline">{{ t('machineDetail.assign') }}</Button>
            <Button
              variant="ghost"
              size="sm"
              class="text-destructive hover:text-destructive"
              :disabled="!driftEnabled"
              @click="clearBaseline"
            >
              {{ t('machineDetail.unbind') }}
            </Button>
          </div>
          <p class="text-xs leading-relaxed text-muted-foreground">
            {{ t('machineDetail.baselineHint') }}
            <template v-if="!driftEnabled">{{ t('machineDetail.baselineHintPost') }}</template>
          </p>
          <template v-if="driftData?.drift">
            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="outline" class="rounded-md font-medium" :style="toneBadgeStyle('success')">
                {{ t('machineDetail.driftMatched', { n: driftData.drift.matched }) }}
              </Badge>
              <Badge v-if="driftData.drift.drifted" variant="outline" class="rounded-md font-medium" :style="toneBadgeStyle('warning')">
                {{ t('machineDetail.driftDrifted', { n: Object.keys(driftData.drift.drifted).length }) }}
              </Badge>
              <Badge v-if="driftData.drift.unknown?.length" variant="outline" class="rounded-md font-medium" :style="toneBadgeStyle('danger')">
                {{ t('machineDetail.driftUnknown', { n: driftData.drift.unknown.length }) }}
              </Badge>
            </div>
            <div v-if="driftedEntries.length" class="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/50 hover:bg-muted/50">
                    <TableHead class="min-w-[180px]">{{ t('machineDetail.colAttr') }}</TableHead>
                    <TableHead class="min-w-[140px]">{{ t('machineDetail.colBaselineValue') }}</TableHead>
                    <TableHead class="min-w-[140px]">{{ t('machineDetail.colLiveValue') }}</TableHead>
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
              {{ t('machineDetail.driftUnknownNote', { names: driftData.drift.unknown.join('、') }) }}
            </p>
          </template>
          <p v-else-if="driftReading" class="text-sm text-muted-foreground">{{ t('machineDetail.driftReading') }}</p>
        </CardContent>
      </Card>

      <!-- 装后验收报告（roadmap 下一阶段 12）：有报告才显示 -->
      <Card v-if="acceptance">
        <CardHeader>
          <CardTitle class="text-base">{{ t('machineDetail.acceptance') }}</CardTitle>
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
                  <TableHead class="w-36">{{ t('machineDetail.colCheck') }}</TableHead>
                  <TableHead class="w-28">{{ t('machineDetail.colStatus') }}</TableHead>
                  <TableHead class="min-w-[260px]">{{ t('machineDetail.colDetail') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in acceptance.checks ?? []" :key="row.name">
                  <TableCell>{{ CHECK_LABEL[row.name] ? t(CHECK_LABEL[row.name]!) : row.name }}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      class="rounded-md font-medium"
                      :style="toneBadgeStyle(row.status === 'ok' ? 'success' : row.status === 'mismatch' ? 'danger' : 'warning')"
                    >
                      {{ row.status === 'ok' ? t('machineDetail.checkOk') : row.status === 'mismatch' ? t('machineDetail.checkMismatch') : t('machineDetail.checkNoData') }}
                    </Badge>
                  </TableCell>
                  <TableCell><span class="font-mono text-xs">{{ row.detail || '—' }}</span></TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="(acceptance.checks ?? []).length === 0" :description="t('machineDetail.acceptanceEmpty')" />
          </div>
          <p v-if="acceptance.system" class="text-sm text-muted-foreground">
            {{ acceptance.system.os }} · kernel {{ acceptance.system.kernel }} · {{ acceptance.system.hostname }}
          </p>
        </CardContent>
      </Card>

      <!-- 退役证据（roadmap 下一阶段 18）：有报告才显示 -->
      <Card v-if="dcReport">
        <CardHeader>
          <CardTitle class="text-base">{{ t('machineDetail.dcEvidence') }}</CardTitle>
          <CardAction>
            <Badge variant="outline" class="rounded-md font-medium">{{ t('machineDetail.dcBadge') }}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <pre class="max-h-[420px] overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed">{{ JSON.stringify(dcReport, null, 2) }}</pre>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
