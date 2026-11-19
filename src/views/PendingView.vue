<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, ChevronRight, RefreshCcw } from 'lucide-vue-next'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { pendingListKey, pendingDomain } from '@/api/queryKeys'
import { confirm } from '@/composables/confirm'
import { toneBadgeStyle } from '@/utils/stateColors'
import type { components } from '@/api/types.gen'
import RegisterMachineDialog from '@/components/RegisterMachineDialog.vue'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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

type PendingMachine = components['schemas']['PendingMachine']
type Machine = components['schemas']['Machine']

const router = useRouter()
const qc = useQueryClient()
const claimTarget = ref<PendingMachine | null>(null)
const dialogVisible = ref(false)

// 零注册台账无分页、量小。key 与侧栏徽标/Dashboard 共享（pendingListKey），
//  sighting/认领/移除由全局事件总线即时失效；15s 轮询仅作 SSE 兜底
const query = useQuery({
  queryKey: pendingListKey,
  queryFn: async () => unwrap(await getClient().GET('/api/v1/pending-machines')),
  refetchInterval: 15000,
})

const rows = computed(() => query.data.value?.items ?? [])

// 手写 expand（shadcn Table 无内建）：报告 JSON 原样展示
const expanded = ref<Set<string>>(new Set())
function toggleExpand(mac: string) {
  const next = new Set(expanded.value)
  if (next.has(mac)) next.delete(mac)
  else next.add(mac)
  expanded.value = next
}

function openClaim(m: PendingMachine) {
  claimTarget.value = m
  dialogVisible.value = true
}

// 一次性移除：给「机器已手动注册、记录先于注册落库」的遗留行用。已在
// 各入库路径做 MAC 归属比对的引擎不会为已注册机器重建台账，未注册机器
// 再次 PXE 上报仍会重新出现（台账记录机房的现在，不是历史）。
async function dismiss(m: PendingMachine) {
  const ok = await confirm({
    title: '移除待认领记录',
    description:
      '移除这条待认领记录？适用于机器已手动注册、记录遗留的情况。未注册的机器再次 PXE 上报会重新出现。',
    confirmText: '移除',
    destructive: true,
  })
  if (!ok) return
  try {
    await unwrap(await getClient().DELETE('/api/v1/pending-machines/{mac}', {
      params: { path: { mac: m.mac } },
    }))
    toast.success('已移除')
    void qc.invalidateQueries({ queryKey: pendingDomain })
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

function onRegistered(machine: Machine) {
  router.push({ name: 'machine-detail', params: { id: machine.id } })
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">待认领</h2>
        <p class="text-sm text-muted-foreground">零注册机器台账 · 共 {{ rows.length }} 台</p>
      </div>
      <Button variant="outline" size="sm" @click="query.refetch()">
        <RefreshCcw class="size-4" /> 刷新
      </Button>
    </div>

    <Alert v-if="query.error.value" variant="destructive">
      <AlertTitle>{{ errorMessage(query.error.value) }}</AlertTitle>
    </Alert>

    <Card>
      <CardContent>
        <Skeleton v-if="query.isPending.value" class="h-56 w-full" />
        <div v-else class="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="w-10" />
                <TableHead class="w-44">MAC</TableHead>
                <TableHead class="min-w-[170px]">固件（option 93）</TableHead>
                <TableHead class="min-w-[120px]">探针报告</TableHead>
                <TableHead class="w-44">首次出现</TableHead>
                <TableHead class="w-44">最近出现</TableHead>
                <TableHead class="w-40 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-for="row in rows" :key="row.mac">
                <TableRow>
                  <TableCell>
                    <button
                      class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      @click.stop="toggleExpand(row.mac)"
                    >
                      <ChevronRight v-if="!expanded.has(row.mac)" class="size-4" />
                      <ChevronDown v-else class="size-4" />
                    </button>
                  </TableCell>
                  <TableCell><span class="font-mono text-xs">{{ row.mac }}</span></TableCell>
                  <TableCell>
                    <span v-if="row.firmware" class="font-mono text-xs">{{ row.firmware }}</span>
                    <span v-else class="text-muted-foreground">—</span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      v-if="row.report"
                      variant="outline"
                      class="rounded-md font-medium"
                      :style="toneBadgeStyle('success')"
                    >
                      已上报
                    </Badge>
                    <Badge v-else variant="outline" class="rounded-md font-medium" :style="toneBadgeStyle('neutral')">
                      未上报
                    </Badge>
                  </TableCell>
                  <TableCell class="text-muted-foreground">{{ formatTime(row.first_seen_at) }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ formatTime(row.last_seen_at) }}</TableCell>
                  <TableCell class="text-right">
                    <div class="inline-flex justify-end gap-1">
                      <Button size="sm" class="h-8" @click.stop="openClaim(row)">认领</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        class="h-8 text-destructive hover:text-destructive"
                        @click.stop="dismiss(row)"
                      >
                        移除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                <TableRow v-if="expanded.has(row.mac)" class="hover:bg-transparent">
                  <TableCell :colspan="7" class="bg-muted/30 p-0">
                    <div class="px-10 py-3">
                      <template v-if="row.report">
                        <p class="mb-1.5 text-xs text-muted-foreground">探针 /sys 扫描报告（原样落库）</p>
                        <pre class="max-h-64 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed">{{ JSON.stringify(row.report, null, 2) }}</pre>
                      </template>
                      <p v-else class="text-xs leading-relaxed text-muted-foreground">
                        尚未收到探针报告——机器可能只 PXE 留痕了一次，没有进入内存盘探针。
                        让它再次引导（或等待租期重试）即可补齐。
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              </template>
            </TableBody>
          </Table>
          <EmptyState v-if="rows.length === 0" description="登记簿是空的">
            <p class="max-w-[420px] text-xs leading-relaxed text-muted-foreground">
              开启引擎零注册（MAMMOTH_PXE_ENABLED + MAMMOTH_PXE_ENROLL）后，
              插电自举的未知机器会在这里留下 MAC、固件与盘查报告——
              拿着序列号去机房认出它，补上 BMC 凭证即可收编。
            </p>
          </EmptyState>
        </div>
      </CardContent>
    </Card>

    <RegisterMachineDialog
      v-model="dialogVisible"
      :claim-mac="claimTarget?.mac"
      @registered="onRegistered"
    />
  </div>
</template>
