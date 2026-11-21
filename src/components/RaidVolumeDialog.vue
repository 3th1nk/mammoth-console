<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LoaderCircle, RefreshCw, Trash2, TriangleAlert } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { machineDomain, jobDomain } from '@/api/queryKeys'
import type { components } from '@/api/types.gen'
import { formatBytes } from '@/utils/format'
import { uuid } from '@/utils/uuid'
import { confirm } from '@/composables/confirm'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

/**
 * 机器面存储管理（docs/07-bmc.md §6.7）：RAID 卷是一次性生命周期动作——
 * 建一次、之后重复装系统都只选盘。逻辑盘区 = 控制器已建卷（含成员占用）；
 * 可用物理盘区 = 未被任何卷占用的成员候选。建/删都是两段式：此处显式
 * confirm，执行时 runner 重读活表、serial 不在表上即拒。控制器命名权威
 * （华为 iBMC 改名 LogicDrive0）——事件里记实际卷名。
 */
const props = defineProps<{ machineId: string; modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; submitted: [] }>()
const router = useRouter()
const { t } = useI18n()
const qc = useQueryClient()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const raidQuery = useQuery({
  queryKey: ['raid-topology', props.machineId],
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/machines/{id}/raid', { params: { path: { id: props.machineId } } })),
  enabled: visible,
  // 活表不缓存：每次打开都重读
  refetchOnWindowFocus: false,
  gcTime: 0,
  retry: false,
})

// 控制器无 Volumes 集合（无 RAID 卡）或驱动无此能力 → 诚实空态而非报错页
const unsupported = computed(() => {
  const msg = raidQuery.error.value ? String((raidQuery.error.value as { message?: string }).message ?? '') : ''
  return msg.includes('BMC_UNSUPPORTED')
})

const volumes = computed(() => raidQuery.data.value?.volumes ?? [])
const freeDrives = computed(() => raidQuery.data.value?.free_drives ?? [])

// ── 创建卷 ──
const LEVELS = ['0', '1', '5', '10'] as const
const level = ref<'0' | '1' | '5' | '10'>('1')
const volumeName = ref('')
const selected = ref<string[]>([])
const confirmChecked = ref(false)
const submitting = ref(false)

watch(visible, (v) => {
  if (v) {
    selected.value = []
    confirmChecked.value = false
    volumeName.value = ''
    level.value = '1'
  }
})

function toggleDrive(serial?: string) {
  if (!serial) return
  selected.value = selected.value.includes(serial)
    ? selected.value.filter((s) => s !== serial)
    : [...selected.value, serial]
}

// 与引擎 validateRaidConfirm 同口径的级别成员数规则
function levelRule(l: string): { min: number; max?: number; even?: boolean } {
  switch (l) {
    case '0': return { min: 2 }
    case '1': return { min: 2, max: 4 }
    case '5': return { min: 3 }
    default: return { min: 4, even: true }
  }
}

const ruleText = computed(() => {
  const r = levelRule(level.value)
  if (level.value === '0') return t('raid.ruleMin', { n: r.min })
  if (level.value === '1') return t('raid.ruleRange', { min: r.min, max: r.max })
  if (level.value === '5') return t('raid.ruleMin', { n: r.min })
  return t('raid.ruleEven', { n: r.min })
})

const shapeOk = computed(() => {
  const r = levelRule(level.value)
  const n = selected.value.length
  if (n < r.min) return false
  if (r.max !== undefined && n > r.max) return false
  if (r.even && n % 2 !== 0) return false
  return true
})

async function refetchTopology() {
  await raidQuery.refetch()
  void qc.invalidateQueries({ queryKey: machineDomain })
  void qc.invalidateQueries({ queryKey: jobDomain })
}

async function acceptAction(body: Record<string, unknown>, acceptedText: string) {
  const data = await unwrap(await getClient().POST('/api/v1/machines/{id}/actions', {
    params: {
      path: { id: props.machineId },
      header: { 'Idempotency-Key': uuid() },
    },
    body: body as never,
  }))
  const jobId = (data as components['schemas']['Job'] | undefined)?.id
  toast.success(acceptedText, {
    description: jobId ? t('actions.acceptedWithJob', { id: jobId }) : undefined,
    duration: 6000,
    action: jobId
      ? { label: t('actions.viewProgress'), onClick: () => router.push({ name: 'job-detail', params: { id: jobId } }) }
      : undefined,
  })
  emit('submitted')
  void refetchTopology()
}

async function submitCreate() {
  if (selected.value.length === 0) {
    toast.warning(t('raid.selectFirst'))
    return
  }
  if (!shapeOk.value) {
    toast.warning(t('raid.shapeError', { level: level.value, rule: ruleText.value, n: selected.value.length }))
    return
  }
  if (!confirmChecked.value) {
    toast.warning(t('raid.confirmFirst'))
    return
  }
  submitting.value = true
  try {
    await acceptAction(
      { type: 'create_raid_volume', name: volumeName.value.trim() || undefined, level: level.value, serials: selected.value, confirm: true },
      t('raid.createAccepted'),
    )
    selected.value = []
    confirmChecked.value = false
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}

async function deleteVolume(name: string) {
  const ok = await confirm({
    title: t('raid.deleteTitle', { name }),
    description: t('raid.deleteConfirm'),
    confirmText: t('raid.deleteExec'),
    destructive: true,
  })
  if (!ok) return
  try {
    await acceptAction({ type: 'delete_raid_volume', name, confirm: true }, t('raid.deleteAccepted'))
  } catch (e) {
    toast.error(errorMessage(e))
  }
}
</script>

<template>
  <Dialog v-model:open="visible">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[760px]">
      <DialogHeader>
        <DialogTitle>{{ t('raid.title') }}</DialogTitle>
        <DialogDescription class="sr-only">{{ t('raid.desc') }}</DialogDescription>
      </DialogHeader>

      <Skeleton v-if="raidQuery.isFetching.value && !raidQuery.data.value" class="h-40 w-full" />
      <Alert v-else-if="unsupported" class="border-amber-500/40 bg-amber-500/5">
        <TriangleAlert class="size-4" />
        <AlertTitle>{{ t('raid.unsupportedTitle') }}</AlertTitle>
        <AlertDescription>{{ t('raid.unsupported') }}</AlertDescription>
      </Alert>

      <template v-else>
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium">{{ t('raid.desc') }}</p>
          <Button variant="ghost" size="icon" class="size-8" :aria-label="t('raid.refresh')" @click="refetchTopology">
            <RefreshCw class="size-4" :class="{ 'animate-spin': raidQuery.isFetching.value }" />
          </Button>
        </div>

        <!-- 已建逻辑盘：成员占用一目了然；删卷 = 成员回池 -->
        <div class="grid gap-1.5">
          <Label class="text-muted-foreground">{{ t('raid.volumesTitle') }}</Label>
          <div class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="min-w-[140px]">{{ t('erase.colName') }}</TableHead>
                  <TableHead class="w-24">{{ t('raid.colLevel') }}</TableHead>
                  <TableHead class="w-28">{{ t('erase.colSize') }}</TableHead>
                  <TableHead class="min-w-[180px]">{{ t('raid.colMembers') }}</TableHead>
                  <TableHead class="w-14"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in volumes" :key="row.name">
                  <TableCell><span class="font-mono text-xs">{{ row.name }}</span></TableCell>
                  <TableCell class="text-muted-foreground">{{ row.raid_level || '—' }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ row.size_bytes ? formatBytes(row.size_bytes) : '—' }}</TableCell>
                  <TableCell>
                    <span v-if="row.member_serials?.length" class="font-mono text-[11px]">{{ row.member_serials.join(', ') }}</span>
                    <span v-else class="text-xs text-muted-foreground">{{ t('raid.noMembership') }}</span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8 text-destructive hover:text-destructive"
                      :aria-label="t('raid.deleteRow', { name: row.name })"
                      @click="deleteVolume(row.name)"
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="volumes.length === 0" :description="t('raid.volumesEmpty')" />
          </div>
        </div>

        <!-- 可用物理盘：排除已被卷占用的盘，勾选即建卷成员 -->
        <div class="grid gap-1.5">
          <Label class="text-muted-foreground">{{ t('raid.freeTitle') }}</Label>
          <div class="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="w-10"></TableHead>
                  <TableHead class="w-28">{{ t('erase.colName') }}</TableHead>
                  <TableHead class="min-w-[150px]">{{ t('erase.colSerial') }}</TableHead>
                  <TableHead class="w-28">{{ t('erase.colSize') }}</TableHead>
                  <TableHead class="w-20">{{ t('erase.colMedium') }}</TableHead>
                  <TableHead class="w-24">{{ t('erase.colProtocol') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in freeDrives" :key="row.name" class="cursor-pointer" @click="toggleDrive(row.serial)">
                  <TableCell @click.stop>
                    <Checkbox
                      :model-value="!!row.serial && selected.includes(row.serial)"
                      :disabled="!row.serial"
                      :aria-label="t('raid.selectRow', { name: row.name })"
                      @update:model-value="() => toggleDrive(row.serial)"
                    />
                  </TableCell>
                  <TableCell><span class="font-mono text-xs">{{ row.name }}</span></TableCell>
                  <TableCell>
                    <span v-if="row.serial" class="font-mono text-xs">{{ row.serial }}</span>
                    <span v-else class="text-xs text-muted-foreground">{{ t('erase.noSerial') }}</span>
                  </TableCell>
                  <TableCell class="text-muted-foreground">{{ row.size_bytes ? formatBytes(row.size_bytes) : '—' }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ row.medium }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ row.protocol }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-if="freeDrives.length === 0" :description="t('raid.freeEmpty')" />
          </div>
        </div>

        <!-- 创建表单：级别 + 名字（声明名只是 label，控制器命名权威）+ 成员数规则 -->
        <div class="grid gap-2 rounded-lg border p-3">
          <div class="flex flex-wrap items-center gap-2">
            <Label class="text-sm">{{ t('raid.createTitle') }}</Label>
            <span v-if="selected.length > 0" class="text-xs text-muted-foreground">{{ t('raid.memberCount', { n: selected.length }) }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Select v-model="level">
              <SelectTrigger class="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="l in LEVELS" :key="l" :value="l">RAID{{ l }}</SelectItem>
              </SelectContent>
            </Select>
            <Input v-model="volumeName" :placeholder="t('raid.namePlaceholder')" class="w-[220px] font-mono" />
          </div>
          <p class="text-xs text-muted-foreground">RAID{{ level }} {{ ruleText }}</p>
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox v-model="confirmChecked" />
            {{ t('raid.confirmBox', { n: selected.length }) }}
          </label>
          <Alert variant="destructive" class="border-destructive/40 py-2">
            <TriangleAlert class="size-4" />
            <AlertDescription class="text-xs">{{ t('raid.destructive') }}</AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="visible = false">{{ t('common.cancel') }}</Button>
          <Button
            :disabled="selected.length === 0 || !shapeOk || !confirmChecked"
            @click="submitCreate"
          >
            <LoaderCircle v-if="submitting" class="size-4 animate-spin" />
            {{ t('raid.createBtn') }}
          </Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
