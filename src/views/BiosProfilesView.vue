<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ChevronDown, ChevronRight, LoaderCircle, Plus, RefreshCcw, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { biosProfilesKey } from '@/api/queryKeys'
import { confirm } from '@/composables/confirm'
import type { components } from '@/api/types.gen'
import { formatTime } from '@/utils/format'
import { uuid } from '@/utils/uuid'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
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
 * BIOS 基线模板(docs/07-bmc.md §6.2,roadmap 下一阶段 13):命名式声明
 * 属性集——漂移巡检的参照与批量下发的载荷源。属性名用厂商自己的名字与
 * JSON 类型;基线的 unknown/漂移判定在机器详情的漂移卡片上读。
 */
type BiosProfile = components['schemas']['BiosProfile']

// ── 属性行编辑器 ────────────────────────────────────────────────────────────
// 值类型是契约的一部分(attributes 为带类型 JSON,形状同 set_bios_attributes
// 载荷),纯文本 K=V 会把一切退化成字符串,所以每行带类型:默认「自动」按值
// 推断,可手动指定;JSON 类型承接嵌套值,表格/JSON 双模式无损互转。
type AttrType = 'auto' | 'string' | 'number' | 'boolean' | 'json'
interface AttrRow {
  key: string
  value: string
  type: AttrType
}

function emptyRow(): AttrRow {
  return { key: '', value: '', type: 'auto' }
}

function jsonToRows(attrs: Record<string, unknown>): AttrRow[] {
  const rows = Object.entries(attrs).map(([k, v]) => {
    if (typeof v === 'boolean') return { key: k, value: v ? 'true' : 'false', type: 'boolean' as const }
    if (typeof v === 'number') return { key: k, value: String(v), type: 'number' as const }
    if (typeof v === 'string') return { key: k, value: v, type: 'string' as const }
    return { key: k, value: JSON.stringify(v, null, 2), type: 'json' as const }
  })
  return rows.length ? rows : [emptyRow()]
}

function rowsToAttrs(rows: AttrRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    const key = row.key.trim()
    const raw = row.value.trim()
    if (key === '' && raw === '') continue // 整行为空视为未填写,静默丢弃
    switch (row.type) {
      case 'string':
        out[key] = raw
        break
      case 'number':
        out[key] = Number(raw)
        break
      case 'boolean':
        out[key] = raw.toLowerCase() === 'true'
        break
      case 'json':
        out[key] = JSON.parse(row.value)
        break
      default: // auto:true/false → 布尔、有限数字 → 数字、其余 → 字符串
        if (/^(true|false)$/i.test(raw)) out[key] = raw.toLowerCase() === 'true'
        else if (raw !== '' && Number.isFinite(Number(raw))) out[key] = Number(raw)
        else out[key] = raw
    }
  }
  return out
}

const qc = useQueryClient()

const listQuery = useQuery({
  queryKey: biosProfilesKey,
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/bios-profiles')).then((d) => d?.items ?? []),
})

const profiles = computed(() => listQuery.data.value ?? [])

const createVisible = ref(false)
const creating = ref(false)
const newName = ref('')
const attrMode = ref<'table' | 'json'>('table')
const attrRows = ref<AttrRow[]>([emptyRow()])
const newAttrsText = ref('{\n  \n}')
const copyFrom = ref('')

function resetForm() {
  newName.value = ''
  attrMode.value = 'table'
  attrRows.value = [emptyRow()]
  newAttrsText.value = '{\n  \n}'
  copyFrom.value = ''
}

function openCreate() {
  resetForm()
  createVisible.value = true
}

// 校验函数与模式解耦:radio 的 v-model 先于 @change 更新,切换瞬间读
// attrsError 会走错分支(拿旧数据源套新模式),所以这里按数据源直接校验。
function jsonTextError(text: string): string {
  if (!text.trim()) return '属性不能为空'
  try {
    const v = JSON.parse(text)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return '属性必须是 JSON 对象'
    if (Object.keys(v).length === 0) return '至少声明一个属性'
    return ''
  } catch (e) {
    return `JSON 解析失败：${(e as Error).message}`
  }
}

function tableRowsError(rows: AttrRow[]): string {
  const filled = rows.filter((r) => r.key.trim() !== '' || r.value.trim() !== '')
  if (filled.length === 0) return '至少声明一个属性'
  const seen = new Set<string>()
  for (const [i, row] of filled.entries()) {
    const key = row.key.trim()
    const raw = row.value.trim()
    if (!key) return `第 ${i + 1} 行属性名为空`
    if (!raw && row.type !== 'string') return `属性 ${key} 的值为空`
    if (seen.has(key)) return `属性名重复：${key}`
    seen.add(key)
    if (row.type === 'number' && !Number.isFinite(Number(raw))) return `属性 ${key} 的值不是数字`
    if (row.type === 'boolean' && !/^(true|false)$/i.test(raw)) return `属性 ${key} 的值必须是 true/false`
    if (row.type === 'json') {
      try {
        JSON.parse(row.value)
      } catch {
        return `属性 ${key} 的 JSON 值解析失败`
      }
    }
  }
  return ''
}

/** 当前模式下的校验错误(空字符串 = 通过)。 */
const attrsError = computed(() =>
  attrMode.value === 'json' ? jsonTextError(newAttrsText.value) : tableRowsError(attrRows.value),
)

function addRow() {
  attrRows.value.push(emptyRow())
}

function onModeChange(m: 'table' | 'json') {
  if (m === 'json') {
    const err = tableRowsError(attrRows.value)
    if (err) {
      toast.warning(`表格校验未通过（${err}），修正后再切换`)
      attrMode.value = 'table'
      return
    }
    newAttrsText.value = JSON.stringify(rowsToAttrs(attrRows.value), null, 2)
  } else if (m === 'table') {
    try {
      const v = JSON.parse(newAttrsText.value)
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('属性必须是 JSON 对象')
      attrRows.value = jsonToRows(v as Record<string, unknown>)
    } catch (e) {
      toast.warning(`JSON 无效（${(e as Error).message}），修正后再切换`)
      attrMode.value = 'json'
    }
  }
}

/** 从现有基线复制属性到当前编辑器,缓解「改基线只能删了重建」的重建成本。 */
function applyCopy(id: string) {
  if (!id) return
  const p = profiles.value.find((x) => x.id === id)
  if (!p) return
  const attrs = (p.attributes ?? {}) as Record<string, unknown>
  if (attrMode.value === 'json') newAttrsText.value = JSON.stringify(attrs, null, 2)
  else attrRows.value = jsonToRows(attrs)
  copyFrom.value = ''
  toast.success(`已载入「${p.name}」的属性`)
}

async function createProfile() {
  if (attrsError.value) {
    toast.warning(attrsError.value)
    return
  }
  creating.value = true
  try {
    const attrs =
      attrMode.value === 'json' ? (JSON.parse(newAttrsText.value) as Record<string, unknown>) : rowsToAttrs(attrRows.value)
    await unwrap(await getClient().POST('/api/v1/bios-profiles', {
      header: { 'Idempotency-Key': uuid() },
      body: { name: newName.value, attributes: attrs as never },
    }))
    toast.success('基线已创建')
    createVisible.value = false
    resetForm()
    void qc.invalidateQueries({ queryKey: biosProfilesKey })
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    creating.value = false
  }
}

async function deleteProfile(p: BiosProfile) {
  const ok = await confirm({
    title: '删除基线',
    description: `删除基线「${p.name}」？机器赋值将自动清除（不影响机器本身）。`,
    confirmText: '删除',
    destructive: true,
  })
  if (!ok) return
  try {
    await unwrap(await getClient().DELETE('/api/v1/bios-profiles/{id}', { params: { path: { id: p.id } } }))
    toast.success('基线已删除')
    void qc.invalidateQueries({ queryKey: biosProfilesKey })
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

// expand 行
const expanded = ref<Set<string>>(new Set())
function toggleExpand(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function fmtAttrs(p: BiosProfile): string {
  return Object.entries(p.attributes ?? {})
    .map(([k, v]) => `${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
}

const ATTR_TYPE_OPTIONS: { value: AttrType; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'string', label: '字符串' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
  { value: 'json', label: 'JSON' },
]
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">BIOS 基线模板</h2>
        <p class="text-sm text-muted-foreground">命名式属性集 · 共 {{ profiles.length }} 条</p>
      </div>
      <div class="flex items-center gap-2">
        <Button size="sm" @click="openCreate"><Plus class="size-4" /> 新建基线</Button>
        <Button variant="outline" size="sm" @click="listQuery.refetch()">
          <RefreshCcw class="size-4" /> 刷新
        </Button>
      </div>
    </div>

    <Alert class="border-blue-500/30 bg-blue-500/5">
      <AlertDescription>
        命名式 BIOS 属性集：漂移巡检的参照与批量下发的载荷源。属性名用厂商自己的名字与 JSON
        类型；机器赋值在机器详情的「BIOS 基线」卡片。
      </AlertDescription>
    </Alert>

    <Alert v-if="listQuery.error.value" variant="destructive">
      <AlertTitle>{{ errorMessage(listQuery.error.value) }}</AlertTitle>
    </Alert>

    <Card>
      <CardContent>
        <Skeleton v-if="listQuery.isPending.value" class="h-56 w-full" />
        <div v-else class="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="w-10" />
                <TableHead class="min-w-[200px]">名称</TableHead>
                <TableHead class="w-24">属性数</TableHead>
                <TableHead class="w-44">创建时间</TableHead>
                <TableHead class="w-24 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-for="row in profiles" :key="row.id">
                <TableRow>
                  <TableCell>
                    <button
                      class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      @click.stop="toggleExpand(row.id)"
                    >
                      <ChevronRight v-if="!expanded.has(row.id)" class="size-4" />
                      <ChevronDown v-else class="size-4" />
                    </button>
                  </TableCell>
                  <TableCell><span class="font-mono text-sm">{{ row.name }}</span></TableCell>
                  <TableCell class="text-muted-foreground">{{ Object.keys(row.attributes ?? {}).length }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ formatTime(row.created_at) }}</TableCell>
                  <TableCell class="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 text-destructive hover:text-destructive"
                      @click.stop="deleteProfile(row)"
                    >
                      <Trash2 class="size-4" /> 删除
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow v-if="expanded.has(row.id)" class="hover:bg-transparent">
                  <TableCell :colspan="5" class="bg-muted/30 p-0">
                    <pre class="mx-6 my-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed">{{ fmtAttrs(row) }}</pre>
                  </TableCell>
                </TableRow>
              </template>
            </TableBody>
          </Table>
          <EmptyState v-if="profiles.length === 0" description="尚无基线模板">
            <p class="max-w-[440px] text-xs leading-relaxed text-muted-foreground">
              基线是命名式的 BIOS 属性集合，漂移巡检以它为参照、批量下发以它为载荷源；
              创建后可在机器详情的「BIOS 基线」卡片赋给机器。
            </p>
            <Button size="sm" class="mt-1" @click="openCreate"><Plus class="size-4" /> 新建第一个基线</Button>
          </EmptyState>
        </div>
      </CardContent>
    </Card>

    <Dialog :open="createVisible" @update:open="(v: boolean) => (createVisible = v)">
      <DialogContent class="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>新建 BIOS 基线</DialogTitle>
          <DialogDescription>属性名用厂商自己的名字与 JSON 类型。</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="createProfile">
          <div class="grid gap-1.5">
            <Label for="bp-name">名称</Label>
            <Input id="bp-name" v-model="newName" placeholder="如 baseline-2288H-prod" />
          </div>
          <div v-if="profiles.length" class="grid gap-1.5">
            <Label>从现有基线复制（可选）</Label>
            <Select
              :model-value="copyFrom || 'none'"
              @update:model-value="(v: unknown) => applyCopy(String(v))"
            >
              <SelectTrigger>
                <SelectValue placeholder="选择基线，载入其属性后微调" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不复制</SelectItem>
                <SelectItem v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid gap-1.5">
            <Label>属性编辑方式</Label>
            <div class="flex w-fit rounded-md border p-0.5">
              <button
                v-for="m in ['table', 'json'] as const"
                :key="m"
                type="button"
                class="rounded-sm px-3 py-1 text-sm transition-colors"
                :class="attrMode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
                @click="onModeChange(m)"
              >
                {{ m === 'table' ? '表格' : 'JSON' }}
              </button>
            </div>
          </div>
          <div class="grid gap-1.5">
            <Label>{{ attrMode === 'table' ? '属性（厂商属性名 + 带类型值）' : '属性 JSON' }}</Label>
            <div v-if="attrMode === 'table'" class="grid gap-2">
              <div v-for="(row, i) in attrRows" :key="i" class="flex items-start gap-2">
                <Input v-model="row.key" placeholder="属性名" class="flex-1 font-mono" />
                <Textarea
                  v-if="row.type === 'json'"
                  v-model="row.value"
                  :rows="2"
                  placeholder="嵌套 JSON 值"
                  class="flex-1 font-mono"
                />
                <Input v-else v-model="row.value" placeholder="值" class="flex-1 font-mono" />
                <Select v-model="row.type" class="w-24 shrink-0">
                  <SelectTrigger class="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="t in ATTR_TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                  :disabled="attrRows.length === 1"
                  @click="attrRows.splice(i, 1)"
                >
                  <Trash2 class="size-4" />
                </Button>
              </div>
              <Button variant="ghost" size="sm" class="w-fit text-primary" @click="addRow">
                <Plus class="size-4" /> 添加属性
              </Button>
            </div>
            <Textarea v-else v-model="newAttrsText" :rows="10" class="font-mono" />
            <p v-if="attrsError" class="text-xs text-destructive">{{ attrsError }}</p>
            <p v-else-if="attrMode === 'table'" class="text-xs text-muted-foreground">
              自动类型按值推断：true/false → 布尔、纯数字 → 数字、其余 → 字符串；嵌套值选 JSON 类型。
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="createVisible = false">取消</Button>
            <Button type="submit" :disabled="creating || !!attrsError || !newName">
              <LoaderCircle v-if="creating" class="size-4 animate-spin" /> 创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
