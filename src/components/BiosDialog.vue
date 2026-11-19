<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LoaderCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { machineDomain, jobDomain } from '@/api/queryKeys'
import type { components } from '@/api/types.gen'
import { uuid } from '@/utils/uuid'
import { useConnectionStore } from '@/stores/connection'
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
 * BIOS 属性两段式修改（契约同构）：读活表 → 修改 → 显式确认（confirm:true）→
 * 引擎 runner 执行前重读活属性表，未知名称即拒。属性值是 pending——BMC 在
 * 下次引导时应用。
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

const biosQuery = useQuery({
  queryKey: ['machine-bios', props.machineId],
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/machines/{id}/bios', { params: { path: { id: props.machineId } } })),
  enabled: visible,
  refetchOnWindowFocus: false,
  gcTime: 0,
})

// 属性编辑行：原始值 + 用户输入（提交时按 JSON 类型还原：数字/布尔/其余字符串）
interface AttrRow {
  name: string
  current: string
  draft: string
}
const rows = ref<AttrRow[]>([])
const confirmChecked = ref(false)
const submitting = ref(false)

watch([visible, () => biosQuery.data.value], ([v, data]) => {
  if (!v || !data) return
  rows.value = Object.entries(data.attributes ?? {}).map(([name, value]) => ({
    name,
    current: String(value),
    draft: String(value),
  }))
  confirmChecked.value = false
})

const changedRows = computed(() => rows.value.filter((r) => r.draft !== r.current))

function parseValue(input: string): unknown {
  const t = input.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  return input
}

async function submit() {
  const attributes: Record<string, unknown> = {}
  for (const r of changedRows.value) {
    attributes[r.name] = parseValue(r.draft)
  }
  if (Object.keys(attributes).length === 0) {
    toast.warning(t('bios.noChanges'))
    return
  }
  if (!confirmChecked.value) {
    toast.warning(t('bios.confirmFirst'))
    return
  }
  submitting.value = true
  try {
    const data = await unwrap(await getClient().POST('/api/v1/machines/{id}/actions', {
      params: {
        path: { id: props.machineId },
        header: { 'Idempotency-Key': uuid() },
      },
      body: { type: 'set_bios_attributes', attributes, confirm: true } as never,
    }))
    const jobId = (data as components['schemas']['Job'] | undefined)?.id
    // 异步 job 受理后机器视角与任务列表都会变,即时失效
    void qc.invalidateQueries({ queryKey: machineDomain })
    void qc.invalidateQueries({ queryKey: jobDomain })
    toast.success(t('bios.accepted'), {
      description: jobId ? t('bios.acceptedDesc', { id: jobId }) : undefined,
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
        <DialogTitle>{{ t('bios.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('bios.desc', { policy: conn.capabilities?.bios_set_confirm ?? '—' }) }}
        </DialogDescription>
      </DialogHeader>

      <Skeleton v-if="biosQuery.isFetching.value" class="h-48 w-full" />
      <div v-else class="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow class="bg-muted/50 hover:bg-muted/50">
              <TableHead class="min-w-[200px]">{{ t('bios.colName') }}</TableHead>
              <TableHead class="min-w-[140px]">{{ t('bios.colCurrent') }}</TableHead>
              <TableHead class="min-w-[180px]">{{ t('bios.colNew') }}</TableHead>
              <TableHead class="w-16">{{ t('bios.restore') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in rows" :key="row.name">
              <TableCell><span class="font-mono text-xs">{{ row.name }}</span></TableCell>
              <TableCell><span class="font-mono text-xs text-muted-foreground">{{ row.current }}</span></TableCell>
              <TableCell>
                <Input v-model="row.draft" class="h-8 font-mono text-xs" />
              </TableCell>
              <TableCell>
                <button
                  v-if="row.draft !== row.current"
                  class="text-xs text-primary underline-offset-2 hover:underline"
                  @click="row.draft = row.current"
                >
                  {{ t('bios.restore') }}
                </button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <EmptyState v-if="rows.length === 0" :description="t('bios.noAttrs')" />
      </div>

      <label
        class="flex items-center gap-2 text-sm"
        :class="changedRows.length === 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'"
      >
        <Checkbox v-model="confirmChecked" :disabled="changedRows.length === 0" />
        {{ t('bios.confirmBox', { n: changedRows.length }) }}
      </label>

      <DialogFooter>
        <Button variant="outline" @click="visible = false">{{ t('common.cancel') }}</Button>
        <Button
          :disabled="changedRows.length === 0 || !confirmChecked"
          :loading="submitting"
          @click="submit"
        >
          <LoaderCircle v-if="submitting" class="size-4 animate-spin" />
          {{ t('bios.submitN', { n: changedRows.length }) }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
