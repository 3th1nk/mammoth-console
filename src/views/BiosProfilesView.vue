<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ChevronDown, ChevronRight, LoaderCircle, Plus, RefreshCcw, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { biosProfilesKey } from '@/api/queryKeys'
import { confirm } from '@/composables/confirm'
import type { components } from '@/api/types.gen'
import { formatTime } from '@/utils/format'
import { uuid } from '@/utils/uuid'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import SegmentedControl from '@/components/SegmentedControl.vue'
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

const { t } = useI18n()

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
  if (!text.trim()) return t('biosProfiles.errEmptyAttrs')
  try {
    const v = JSON.parse(text)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return t('biosProfiles.errNotObject')
    if (Object.keys(v).length === 0) return t('biosProfiles.errNoAttrs')
    return ''
  } catch (e) {
    return t('biosProfiles.errParse', { msg: (e as Error).message })
  }
}

function tableRowsError(rows: AttrRow[]): string {
  const filled = rows.filter((r) => r.key.trim() !== '' || r.value.trim() !== '')
  if (filled.length === 0) return t('biosProfiles.errNoAttrs')
  const seen = new Set<string>()
  for (const [i, row] of filled.entries()) {
    const key = row.key.trim()
    const raw = row.value.trim()
    if (!key) return t('biosProfiles.errRowKeyEmpty', { i: i + 1 })
    if (!raw && row.type !== 'string') return t('biosProfiles.errRowValueEmpty', { key })
    if (seen.has(key)) return t('biosProfiles.errDupKey', { key })
    seen.add(key)
    if (row.type === 'number' && !Number.isFinite(Number(raw))) return t('biosProfiles.errNotNumber', { key })
    if (row.type === 'boolean' && !/^(true|false)$/i.test(raw)) return t('biosProfiles.errNotBool', { key })
    if (row.type === 'json') {
      try {
        JSON.parse(row.value)
      } catch {
        return t('biosProfiles.errJsonParse', { key })
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
  if (m === attrMode.value) return
  if (m === 'json') {
    // 表格 → JSON 无条件切换:空行/缺属性等回显在下方错误提示里引导修正,
    // 不再回弹(回弹会让用户以为切换坏了)
    newAttrsText.value = JSON.stringify(rowsToAttrs(attrRows.value), null, 2)
    attrMode.value = 'json'
  } else {
    try {
      const v = JSON.parse(newAttrsText.value)
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(t('biosProfiles.errNotObject'))
      attrRows.value = jsonToRows(v as Record<string, unknown>)
      attrMode.value = 'table'
    } catch (e) {
      toast.warning(t('biosProfiles.modeSwitchJsonBlocked', { err: (e as Error).message }))
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
  toast.success(t('biosProfiles.loadedFrom', { name: p.name }))
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
    toast.success(t('biosProfiles.created'))
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
    title: t('biosProfiles.deleteConfirmTitle'),
    description: t('biosProfiles.deleteConfirmDesc', { name: p.name }),
    confirmText: t('common.delete'),
    destructive: true,
  })
  if (!ok) return
  try {
    await unwrap(await getClient().DELETE('/api/v1/bios-profiles/{id}', { params: { path: { id: p.id } } }))
    toast.success(t('biosProfiles.deleted'))
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

const ATTR_TYPE_OPTIONS = computed<{ value: AttrType; label: string }[]>(() => [
  { value: 'auto', label: t('biosProfiles.typeAuto') },
  { value: 'string', label: t('biosProfiles.typeString') },
  { value: 'number', label: t('biosProfiles.typeNumber') },
  { value: 'boolean', label: t('biosProfiles.typeBoolean') },
  { value: 'json', label: t('biosProfiles.typeJson') },
])
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">{{ t('biosProfiles.title') }}</h2>
        <p class="text-sm text-muted-foreground">{{ t('biosProfiles.subtitle', { n: profiles.length }) }}</p>
      </div>
      <div class="flex items-center gap-2">
        <Button size="sm" @click="openCreate"><Plus class="size-4" /> {{ t('biosProfiles.create') }}</Button>
        <Button variant="outline" size="sm" @click="listQuery.refetch()">
          <RefreshCcw class="size-4" /> {{ t('common.refresh') }}
        </Button>
      </div>
    </div>

    <Alert class="border-blue-500/30 bg-blue-500/5">
      <AlertDescription>{{ t('biosProfiles.info') }}</AlertDescription>
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
                <TableHead class="min-w-[200px]">{{ t('biosProfiles.colName') }}</TableHead>
                <TableHead class="w-24">{{ t('biosProfiles.colAttrs') }}</TableHead>
                <TableHead class="w-44">{{ t('biosProfiles.colCreatedAt') }}</TableHead>
                <!-- pr 补偿按钮内边距(px-2.5):标题右缘对齐「删除」可见内容而非按钮边框 -->
                <TableHead class="w-24 pr-[18px] text-right">{{ t('machines.colActions') }}</TableHead>
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
                      <Trash2 class="size-4" /> {{ t('common.delete') }}
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
          <EmptyState v-if="profiles.length === 0" :description="t('biosProfiles.attrsEmpty')">
            <p class="max-w-[440px] text-xs leading-relaxed text-muted-foreground">
              {{ t('biosProfiles.attrsEmptyHint') }}
            </p>
            <Button size="sm" class="mt-1" @click="openCreate"><Plus class="size-4" /> {{ t('biosProfiles.createFirst') }}</Button>
          </EmptyState>
        </div>
      </CardContent>
    </Card>

    <Dialog :open="createVisible" @update:open="(v: boolean) => (createVisible = v)">
      <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{{ t('biosProfiles.createTitle') }}</DialogTitle>
          <DialogDescription>{{ t('biosProfiles.createDesc') }}</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="createProfile">
          <div class="grid gap-1.5">
            <Label for="bp-name">{{ t('biosProfiles.nameLabel') }}</Label>
            <Input id="bp-name" v-model="newName" :placeholder="t('biosProfiles.namePlaceholder')" />
          </div>
          <div v-if="profiles.length" class="grid gap-1.5">
            <Label>{{ t('biosProfiles.copyFrom') }}</Label>
            <Select
              :model-value="copyFrom || 'none'"
              @update:model-value="(v: unknown) => applyCopy(String(v))"
            >
              <SelectTrigger>
                <SelectValue :placeholder="t('biosProfiles.copyPlaceholder')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{{ t('biosProfiles.copyNone') }}</SelectItem>
                <SelectItem v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid gap-1.5">
            <Label>{{ t('biosProfiles.editMode') }}</Label>
            <SegmentedControl
              :model-value="attrMode"
              :options="[
                { value: 'table', label: t('biosProfiles.modeTable') },
                { value: 'json', label: t('biosProfiles.modeJson') },
              ]"
              @update:model-value="(v: string) => onModeChange(v as 'table' | 'json')"
            />
          </div>
          <div class="grid gap-1.5">
            <Label>{{ attrMode === 'table' ? t('biosProfiles.attrsTableLabel') : t('biosProfiles.attrsJsonLabel') }}</Label>
            <div v-if="attrMode === 'table'" class="grid gap-2">
              <div v-for="(row, i) in attrRows" :key="i" class="flex items-start gap-2">
                <Input v-model="row.key" :placeholder="t('biosProfiles.attrKeyPlaceholder')" class="flex-1 font-mono" />
                <Textarea
                  v-if="row.type === 'json'"
                  v-model="row.value"
                  :rows="2"
                  :placeholder="t('biosProfiles.attrJsonPlaceholder')"
                  class="flex-1 font-mono"
                />
                <Input v-else v-model="row.value" :placeholder="t('biosProfiles.attrValuePlaceholder')" class="flex-1 font-mono" />
                <Select v-model="row.type" class="w-24 shrink-0">
                  <SelectTrigger class="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="x in ATTR_TYPE_OPTIONS" :key="x.value" :value="x.value">{{ x.label }}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                  :disabled="attrRows.length === 1"
                  @click="attrRows.splice(i, 1)"
                >
                  <Trash2 class="size-4" />
                </Button>
              </div>
              <Button type="button" variant="ghost" size="sm" class="w-fit text-primary" @click="addRow">
                <Plus class="size-4" /> {{ t('biosProfiles.addAttr') }}
              </Button>
            </div>
            <Textarea v-else v-model="newAttrsText" :rows="10" class="font-mono" />
            <p v-if="attrsError" class="text-xs text-destructive">{{ attrsError }}</p>
            <p v-else-if="attrMode === 'table'" class="text-xs text-muted-foreground">{{ t('biosProfiles.autoHint') }}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="createVisible = false">{{ t('common.cancel') }}</Button>
            <Button type="submit" :disabled="creating || !!attrsError || !newName">
              <LoaderCircle v-if="creating" class="size-4 animate-spin" /> {{ t('common.create') }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
