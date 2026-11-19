<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LoaderCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
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
    toast.warning('没有修改任何属性')
    return
  }
  if (!confirmChecked.value) {
    toast.warning('请先勾选确认框')
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
    toast.success('BIOS 修改已受理', {
      description: jobId ? `任务 ${jobId} 已创建（属性在下次引导时生效）` : undefined,
      duration: 6000,
      action: jobId
        ? { label: '查看进度', onClick: () => router.push({ name: 'job-detail', params: { id: jobId } }) }
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
        <DialogTitle>修改 BIOS 属性（下次引导生效）</DialogTitle>
        <DialogDescription>
          属性为 pending 值：提交后由 BMC 在下次引导时应用。引擎执行前会重读活属性表，未知属性名即拒。
          部署 BIOS 确认策略：{{ conn.capabilities?.bios_set_confirm ?? '—' }}
        </DialogDescription>
      </DialogHeader>

      <Skeleton v-if="biosQuery.isFetching.value" class="h-48 w-full" />
      <div v-else class="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow class="bg-muted/50 hover:bg-muted/50">
              <TableHead class="min-w-[200px]">属性名</TableHead>
              <TableHead class="min-w-[140px]">当前值</TableHead>
              <TableHead class="min-w-[180px]">新值（留空=清空）</TableHead>
              <TableHead class="w-16">恢复</TableHead>
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
                  还原
                </button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <EmptyState v-if="rows.length === 0" description="控制器未上报 BIOS 属性表" />
      </div>

      <label
        class="flex items-center gap-2 text-sm"
        :class="changedRows.length === 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'"
      >
        <Checkbox v-model="confirmChecked" :disabled="changedRows.length === 0" />
        我确认提交 {{ changedRows.length }} 项属性修改。
      </label>

      <DialogFooter>
        <Button variant="outline" @click="visible = false">取消</Button>
        <Button
          :disabled="changedRows.length === 0 || !confirmChecked"
          :loading="submitting"
          @click="submit"
        >
          <LoaderCircle v-if="submitting" class="size-4 animate-spin" />
          提交 {{ changedRows.length }} 项修改
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
