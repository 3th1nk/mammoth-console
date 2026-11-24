<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, RefreshCcw, Search, Tag, X, Zap } from 'lucide-vue-next'
import { useQuery } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { machineListKey } from '@/api/queryKeys'
import { actionCommandRecent } from '@/utils/actionNavGuard'
import type { components } from '@/api/types.gen'
import StateBadge from '@/components/StateBadge.vue'
import PowerBadge from '@/components/PowerBadge.vue'
import MachineActions from '@/components/MachineActions.vue'
import RegisterMachineDialog from '@/components/RegisterMachineDialog.vue'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import ClearableInput from '@/components/ClearableInput.vue'
import { formatBytes, formatTime } from '@/utils/format'

type Machine = components['schemas']['Machine']
type MachineState = components['schemas']['MachineState']

const PAGE_SIZE = 50

const { t } = useI18n()
const router = useRouter()
const stateFilter = ref<MachineState | ''>('')
const q = ref('')
const qInput = ref('')
const labelChips = ref<string[]>([])
const labelInput = ref('')
const registerVisible = ref(false)

/** 游标分页：只有「下一页」（next_cursor），用栈记住来路实现「上一页」。 */
const cursor = ref<string | undefined>(undefined)
const cursorStack = ref<(string | undefined)[]>([])

const query = useQuery({
  queryKey: computed(() => machineListKey(stateFilter.value, q.value, labelChips.value, cursor.value)),
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/machines', {
        params: {
          query: {
            state: stateFilter.value || undefined,
            q: q.value || undefined,
            labels: labelChips.value.length > 0 ? labelChips.value : undefined,
            page_size: PAGE_SIZE,
            cursor: cursor.value,
          },
        },
      }),
    ),
})

const rows = computed(() => query.data.value?.items ?? [])
const nextCursor = computed(() => query.data.value?.next_cursor ?? null)

const stateModel = computed({
  get: () => stateFilter.value || 'all',
  set: (v: string) => {
    stateFilter.value = (v === 'all' ? '' : v) as MachineState | ''
    cursor.value = undefined
    cursorStack.value = []
  },
})

function applySearch() {
  q.value = qInput.value.trim()
  cursor.value = undefined
  cursorStack.value = []
}

function addLabel() {
  const v = labelInput.value.trim()
  if (!v) return
  if (!/^[^=]+=[^=]*$/.test(v)) {
    toast.warning(t('machines.labelFormatError'))
    return
  }
  if (!labelChips.value.includes(v)) labelChips.value = [...labelChips.value, v]
  labelInput.value = ''
  cursor.value = undefined
  cursorStack.value = []
}

function removeLabel(chip: string) {
  labelChips.value = labelChips.value.filter((c) => c !== chip)
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

function openDetail(m: Machine, event: Event) {
  if ((event.target as HTMLElement)?.closest('[data-sel-col]')) return
  // 行内「更多」菜单刚交互过：菜单关闭瞬间的落穿点击会到这里，误跳详情。
  if (actionCommandRecent()) return
  router.push({ name: 'machine-detail', params: { id: m.id } })
}

// ── 多选（手写 selection 列） ───────────────────────────────────────────────
const selected = ref<Machine[]>([])
const selectedIds = computed(() => new Set(selected.value.map((m) => m.id)))
const allSelected = computed(
  () => rows.value.length > 0 && rows.value.every((r) => selectedIds.value.has(r.id)),
)

function toggleRow(m: Machine) {
  const next = new Set(selectedIds.value)
  if (next.has(m.id)) next.delete(m.id)
  else next.add(m.id)
  selected.value = rows.value.filter((r) => next.has(r.id))
}

function toggleAll() {
  selected.value = allSelected.value ? [] : [...rows.value]
}

function clearSelection() {
  selected.value = []
}

function startInstall() {
  const ids = selected.value.map((m) => m.id).join(',')
  router.push({ name: 'install-wizard', query: { machines: ids } })
}

// 批量打标签：引擎 A5 批量端点（单事务全有或全无）——添加 upsert + 按 key 删除
const batchLabelVisible = ref(false)
const batchChips = ref<string[]>([])
const batchInput = ref('')
const batchRemoveKeys = ref<string[]>([])
const batchApplying = ref(false)

// 所选机器标签 key 的并集——可删除项从这里勾选。
const removableKeys = computed(() => {
  const set = new Set<string>()
  for (const m of selected.value) for (const k of Object.keys(m.labels ?? {})) set.add(k)
  return [...set].sort()
})

function openBatchLabels() {
  batchChips.value = []
  batchInput.value = ''
  batchRemoveKeys.value = []
  batchLabelVisible.value = true
}

function addBatchChip() {
  const v = batchInput.value.trim()
  if (!v) return
  if (!/^[^=]+=[^=]*$/.test(v)) {
    toast.warning(t('machines.batchFormatError'))
    return
  }
  if (!batchChips.value.includes(v)) batchChips.value = [...batchChips.value, v]
  batchInput.value = ''
}

async function applyBatchLabels() {
  const newLabels = Object.fromEntries(
    batchChips.value.map((c) => {
      const i = c.indexOf('=')
      return [c.slice(0, i), c.slice(i + 1)] as [string, string]
    }),
  )
  const clash = batchRemoveKeys.value.filter((k) => k in newLabels)
  if (clash.length > 0) {
    toast.warning(t('machines.batchClash', { keys: clash.join('、') }))
    return
  }
  if (Object.keys(newLabels).length === 0 && batchRemoveKeys.value.length === 0) {
    toast.warning(t('machines.batchEmpty'))
    return
  }
  batchApplying.value = true
  try {
    await unwrap(
      await getClient().POST('/api/v1/machines/batch-labels', {
        body: {
          machine_ids: selected.value.map((m) => m.id),
          add: Object.keys(newLabels).length > 0 ? newLabels : undefined,
          remove: batchRemoveKeys.value.length > 0 ? batchRemoveKeys.value : undefined,
        },
      }),
    )
    toast.success(t('machines.batchDone', { n: selected.value.length }))
    batchLabelVisible.value = false
    void query.refetch()
  } catch (e) {
    // 引擎全有或全无：失败即整体未生效，直接报错
    toast.error(errorMessage(e))
  } finally {
    batchApplying.value = false
  }
}

function onRegistered(m: Machine) {
  void query.refetch()
  router.push({ name: 'machine-detail', params: { id: m.id } })
}

function onActionSubmitted() {
  void query.refetch()
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">{{ t('machines.title') }}</h2>
        <p class="text-sm text-muted-foreground">
          {{ t('machines.subtitle') }}
          <template v-if="selected.length > 0">{{ t('machines.selected', { n: selected.length }) }}</template>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" :disabled="selected.length === 0" @click="startInstall">
          <Zap class="size-4" /> {{ selected.length > 0 ? t('machines.installN', { n: selected.length }) : t('machines.install') }}
        </Button>
        <Button variant="outline" size="sm" :disabled="selected.length === 0" @click="openBatchLabels">
          <Tag class="size-4" /> {{ selected.length > 0 ? t('machines.batchLabelN', { n: selected.length }) : t('machines.batchLabel') }}
        </Button>
        <Button variant="outline" size="sm" @click="registerVisible = true">
          <Plus class="size-4" /> {{ t('machines.register') }}
        </Button>
        <Button variant="outline" size="sm" @click="query.refetch()">
          <RefreshCcw class="size-4" /> {{ t('common.refresh') }}
        </Button>
      </div>
    </div>

    <Alert v-if="query.error.value" variant="destructive">
      <AlertTitle>{{ errorMessage(query.error.value) }}</AlertTitle>
    </Alert>

    <Card>
      <CardContent class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <Select v-model="stateModel">
            <SelectTrigger class="w-[130px]">
              <SelectValue :placeholder="t('machines.filterAllStates')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{{ t('machines.filterAllStates') }}</SelectItem>
              <SelectItem value="registering">{{ t('states.machineRegistering') }}</SelectItem>
              <SelectItem value="discovering">{{ t('states.machineDiscovering') }}</SelectItem>
              <SelectItem value="ready">{{ t('states.machineReady') }}</SelectItem>
              <SelectItem value="error">{{ t('states.machineError') }}</SelectItem>
            </SelectContent>
          </Select>
          <ClearableInput
            v-model="qInput"
            :placeholder="t('machines.searchPlaceholder')"
            class="w-[320px]"
            @keyup.enter="applySearch"
            @clear="applySearch"
          />
          <Input
            v-model="labelInput"
            :placeholder="t('machines.labelPlaceholder')"
            class="w-[220px]"
            @keyup.enter="addLabel"
          />
          <Button size="sm" @click="applySearch"><Search class="size-4" /> {{ t('common.search') }}</Button>
        </div>
        <div v-if="labelChips.length > 0" class="flex flex-wrap gap-1.5">
          <span
            v-for="chip in labelChips"
            :key="chip"
            class="inline-flex items-center gap-1 rounded-md border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
          >
            {{ chip }}
            <button class="transition-opacity hover:opacity-70" @click="removeLabel(chip)">
              <X class="size-3" />
            </button>
          </span>
        </div>

        <Skeleton v-if="query.isPending.value" class="h-56 w-full" />
        <div v-else class="overflow-x-auto overflow-y-hidden rounded-lg border">
          <Table class="min-w-[1080px]">
            <TableHeader>
              <TableRow class="bg-muted hover:bg-muted">
                <TableHead data-sel-col class="sticky left-0 z-10 w-10 bg-inherit" @click.stop>
                  <Checkbox
                    :model-value="allSelected"
                    :aria-label="t('machines.selectAll')"
                    @update:model-value="toggleAll"
                  />
                </TableHead>
                <TableHead class="w-24">{{ t('machines.colState') }}</TableHead>
                <TableHead class="w-36">{{ t('machines.colId') }}</TableHead>
                <TableHead class="min-w-[130px]">{{ t('machines.colBmc') }}</TableHead>
                <TableHead class="w-20">{{ t('machines.colProtocol') }}</TableHead>
                <TableHead class="min-w-[130px]">{{ t('machines.colVendor') }}</TableHead>
                <TableHead class="min-w-[110px]">{{ t('machines.colSerial') }}</TableHead>
                <TableHead class="min-w-[130px]">{{ t('machines.colCpu') }}</TableHead>
                <TableHead class="w-24">{{ t('machines.colPower') }}</TableHead>
                <TableHead class="min-w-[110px]">{{ t('machines.colLabels') }}</TableHead>
                <TableHead class="w-40">{{ t('machines.colCreatedAt') }}</TableHead>
                <!-- 操作列整列左对齐(与镜像/凭证/事件同一规则):宽按钮组右对齐时
                     短标题贴右缘只对上末位按钮尾,视觉重心偏右;左对齐 = 表头与
                     按钮组起点一条垂直线。有边框按钮,表头对按钮左缘即可 -->
                <TableHead class="sticky right-0 z-10 w-32 bg-inherit">{{ t('machines.colActions') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <!-- 行背景不透明(bg-card/hover:bg-muted):sticky 列 bg-inherit 才能
                   盖住横向滚过的其他列内容——半透明背景会透出下层 -->
              <TableRow v-for="row in rows" :key="row.id" class="group cursor-pointer bg-card hover:bg-muted" @click="openDetail(row, $event)">
                <TableCell data-sel-col class="sticky left-0 z-10 bg-inherit pr-0" @click.stop>
                  <Checkbox
                    :model-value="selectedIds.has(row.id)"
                    :aria-label="t('machines.selectRow', { id: row.id })"
                    @update:model-value="() => toggleRow(row)"
                  />
                </TableCell>
                <TableCell><StateBadge kind="machine" :state="row.state" /></TableCell>
                <TableCell><span class="font-mono text-xs">{{ row.id }}</span></TableCell>
                <TableCell><span class="font-mono text-xs">{{ row.bmc.address }}</span></TableCell>
                <TableCell class="text-muted-foreground">{{ row.bmc.protocol }}</TableCell>
                <TableCell>
                  <span v-if="row.bmc.vendor || row.bmc.model">
                    {{ row.bmc.vendor || '—' }} · {{ row.bmc.model || '—' }}
                  </span>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell>
                  <span class="font-mono text-xs">{{ row.hardware?.serial_number || '—' }}</span>
                </TableCell>
                <TableCell>
                  <template v-if="row.hardware?.cpu?.cores">
                    {{ row.hardware.cpu.cores }}C · {{ formatBytes(row.hardware.memory_bytes) }}
                    <div class="max-w-[240px] truncate text-xs text-muted-foreground" :title="row.hardware.cpu.model">
                      {{ row.hardware.cpu.model }}
                    </div>
                  </template>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell><PowerBadge :state="row.power_state" /></TableCell>
                <TableCell>
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="(v, k) in row.labels"
                      :key="k"
                      class="inline-flex rounded-md border bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground"
                    >
                      {{ k }}={{ v }}
                    </span>
                    <span v-if="Object.keys(row.labels).length === 0" class="text-muted-foreground">—</span>
                  </div>
                </TableCell>
                <TableCell class="text-muted-foreground">{{ formatTime(row.created_at) }}</TableCell>
                <TableCell class="sticky right-0 z-10 bg-inherit">
                  <div class="inline-flex" @click.stop>
                    <MachineActions
                      :machine-id="row.id"
                      :power-state="row.power_state"
                      :bmc="row.bmc"
                      flat
                      @submitted="onActionSubmitted"
                    />
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <EmptyState v-if="rows.length === 0" :description="t('machines.empty')">
            <p class="text-xs text-muted-foreground">{{ t('machines.emptyHint') }}</p>
          </EmptyState>
        </div>

        <div class="flex items-center justify-between">
          <button
            v-if="selected.length > 0"
            class="mt-3 shrink-0 whitespace-nowrap text-xs text-muted-foreground underline-offset-2 hover:underline"
            @click="clearSelection"
          >
            {{ t('machines.clearSelection', { n: selected.length }) }}
          </button>
          <span v-else />
          <Pager
            :has-prev="cursorStack.length > 0"
            :has-next="!!nextCursor"
            @prev="prevPage"
            @next="nextPage"
          />
        </div>
      </CardContent>
    </Card>

    <RegisterMachineDialog v-model="registerVisible" @registered="onRegistered" />

    <Dialog :open="batchLabelVisible" @update:open="(v: boolean) => (batchLabelVisible = v)">
      <DialogContent class="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{{ t('machines.batchTitle', { n: selected.length }) }}</DialogTitle>
          <DialogDescription>{{ t('machines.batchDesc') }}</DialogDescription>
        </DialogHeader>
        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <Label>{{ t('machines.batchAddLabel') }}</Label>
            <Input v-model="batchInput" placeholder="env=prod" @keyup.enter="addBatchChip" />
            <div v-if="batchChips.length > 0" class="flex flex-wrap gap-1.5">
              <span
                v-for="chip in batchChips"
                :key="chip"
                class="inline-flex items-center gap-1 rounded-md border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
              >
                {{ chip }}
                <button class="transition-opacity hover:opacity-70" @click="batchChips = batchChips.filter((c) => c !== chip)">
                  <X class="size-3" />
                </button>
              </span>
            </div>
          </div>
          <div v-if="removableKeys.length > 0" class="grid gap-1.5">
            <Label>{{ t('machines.batchRemoveLabel') }}</Label>
            <div class="flex flex-wrap gap-x-4 gap-y-2">
              <label
                v-for="k in removableKeys"
                :key="k"
                class="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  :model-value="batchRemoveKeys.includes(k)"
                  @update:model-value="(v: boolean | 'indeterminate') => {
                    if (v === 'indeterminate') return
                    batchRemoveKeys = v ? [...batchRemoveKeys, k] : batchRemoveKeys.filter((x) => x !== k)
                  }"
                />
                {{ k }}
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="batchLabelVisible = false">{{ t('common.cancel') }}</Button>
          <Button :disabled="batchApplying" @click="applyBatchLabels">
            {{ t('machines.batchApply') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
