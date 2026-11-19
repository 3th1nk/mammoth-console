<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LoaderCircle, TriangleAlert } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { machineDomain, jobDomain } from '@/api/queryKeys'
import type { components } from '@/api/types.gen'
import { formatBytes } from '@/utils/format'
import { uuid } from '@/utils/uuid'
import { useConnectionStore } from '@/stores/connection'
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
 * 擦盘两段式向导（契约同构）：第一段 = 读活表 + 选择目标 + 显式确认（本组件，
 * confirm:true）；第二段 = 引擎 runner 执行前重读活表，serial 不在表上即拒。
 * 数据按设计不可恢复（NIST 800-88 控制器级 sanitize）。
 */
const props = defineProps<{ machineId: string; modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const router = useRouter()
const { t } = useI18n()
const conn = useConnectionStore()
const qc = useQueryClient()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const drivesQuery = useQuery({
  queryKey: ['erase-drives', props.machineId],
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/machines/{id}/drives', { params: { path: { id: props.machineId } } })),
  enabled: visible,
  // 活表不缓存：每次打开都重读
  refetchOnWindowFocus: false,
  gcTime: 0,
})

const drives = computed(() => drivesQuery.data.value?.drives ?? [])
// 无 serial 的盘无法被 erase_drives 定位（DRIVE_SERIAL_UNKNOWN）
const erasable = computed(() => drives.value.filter((d) => d.serial))
const selected = ref<string[]>([])
const confirmChecked = ref(false)
const submitting = ref(false)

watch(visible, (v) => {
  if (v) {
    selected.value = []
    confirmChecked.value = false
  }
})

const selectedCount = computed(() => selected.value.length)
const allSelected = computed(() => erasable.value.length > 0 && selected.value.length === erasable.value.length)

function toggleAll() {
  selected.value = allSelected.value ? [] : erasable.value.map((d) => d.serial as string)
}

function toggleDrive(serial?: string) {
  if (!serial) return
  selected.value = selected.value.includes(serial)
    ? selected.value.filter((s) => s !== serial)
    : [...selected.value, serial]
}

async function submit() {
  if (selectedCount.value === 0) {
    toast.warning(t('erase.selectFirst'))
    return
  }
  if (!confirmChecked.value) {
    toast.warning(t('erase.confirmFirst'))
    return
  }
  submitting.value = true
  try {
    const data = await unwrap(await getClient().POST('/api/v1/machines/{id}/actions', {
      params: {
        path: { id: props.machineId },
        header: { 'Idempotency-Key': uuid() },
      },
      body: { type: 'erase_drives', serials: selected.value, confirm: true } as never,
    }))
    const jobId = (data as components['schemas']['Job'] | undefined)?.id
    // 异步 job 受理后机器视角（power_state 等）与任务列表都会变,即时失效
    void qc.invalidateQueries({ queryKey: machineDomain })
    void qc.invalidateQueries({ queryKey: jobDomain })
    toast.success(t('erase.accepted'), {
      description: jobId ? t('actions.acceptedWithJob', { id: jobId }) : undefined,
      duration: 6000,
      action: jobId
        ? { label: t('actions.viewProgress'), onClick: () => router.push({ name: 'job-detail', params: { id: jobId } }) }
        : undefined,
    })
    visible.value = false
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="visible">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[680px]">
      <DialogHeader>
        <DialogTitle>{{ t('erase.title') }}</DialogTitle>
        <DialogDescription class="sr-only">{{ t('erase.destructive') }}</DialogDescription>
      </DialogHeader>

      <Alert variant="destructive">
        <TriangleAlert class="size-4" />
        <AlertTitle>{{ t('erase.destructive') }}</AlertTitle>
        <AlertDescription>
          {{ t('erase.twoPhase', { policy: conn.capabilities?.drive_erase_confirm ?? '—' }) }}
        </AlertDescription>
      </Alert>

      <Skeleton v-if="drivesQuery.isFetching.value" class="h-40 w-full" />
      <div v-else class="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow class="bg-muted/50 hover:bg-muted/50">
              <TableHead class="w-10">
                <Checkbox
                  :model-value="allSelected"
                  :disabled="drivesQuery.isFetching.value"
                  :aria-label="t('erase.selectAll')"
                  @update:model-value="() => toggleAll()"
                />
              </TableHead>
              <TableHead class="w-28">{{ t('erase.colName') }}</TableHead>
              <TableHead class="min-w-[150px]">{{ t('erase.colSerial') }}</TableHead>
              <TableHead class="w-28">{{ t('erase.colSize') }}</TableHead>
              <TableHead class="w-20">{{ t('erase.colMedium') }}</TableHead>
              <TableHead class="w-24">{{ t('erase.colProtocol') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in drives" :key="row.name" class="cursor-pointer" @click="toggleDrive(row.serial)">
              <TableCell @click.stop>
                <Checkbox
                  :model-value="!!row.serial && selected.includes(row.serial)"
                  :disabled="!row.serial"
                  :aria-label="t('erase.selectRow', { name: row.name })"
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
        <EmptyState v-if="drives.length === 0" :description="t('erase.noDrives')" />
      </div>

      <label class="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox v-model="confirmChecked" />
        {{ t('erase.confirmBox', { n: selectedCount }) }}
      </label>

      <DialogFooter>
        <Button variant="outline" @click="visible = false">{{ t('common.cancel') }}</Button>
        <Button
          variant="destructive"
          :disabled="selectedCount === 0 || !confirmChecked"
          :loading="submitting"
          @click="submit"
        >
          <LoaderCircle v-if="submitting" class="size-4 animate-spin" />
          {{ t('erase.eraseN', { n: selectedCount }) }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
