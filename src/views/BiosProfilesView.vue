<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Delete } from '@element-plus/icons-vue'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import { formatTime } from '@/utils/format'
import { uuid } from '@/utils/uuid'

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
  queryKey: ['bios-profiles'],
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

function onModeChange(m: string | number | boolean | undefined) {
  if (m === 'json') {
    const err = tableRowsError(attrRows.value)
    if (err) {
      ElMessage.warning(`表格校验未通过（${err}），修正后再切换`)
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
      ElMessage.warning(`JSON 无效（${(e as Error).message}），修正后再切换`)
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
  ElMessage.success(`已载入「${p.name}」的属性`)
}

async function createProfile() {
  if (attrsError.value) {
    ElMessage.warning(attrsError.value)
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
    ElMessage.success('基线已创建')
    createVisible.value = false
    resetForm()
    void qc.invalidateQueries({ queryKey: ['bios-profiles'] })
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    creating.value = false
  }
}

async function deleteProfile(p: BiosProfile) {
  try {
    await ElMessageBox.confirm(
      `删除基线「${p.name}」？机器赋值将自动清除（不影响机器本身）。`,
      '删除基线',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await unwrap(await getClient().DELETE('/api/v1/bios-profiles/{id}', { params: { path: { id: p.id } } }))
    ElMessage.success('基线已删除')
    void qc.invalidateQueries({ queryKey: ['bios-profiles'] })
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}


function fmtAttrs(p: BiosProfile): string {
  return Object.entries(p.attributes ?? {})
    .map(([k, v]) => `${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">BIOS 基线模板</h1>
      <div>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建基线</el-button>
        <el-button :icon="Refresh" @click="listQuery.refetch()">刷新</el-button>
      </div>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="mb"
      title="命名式 BIOS 属性集：漂移巡检的参照与批量下发的载荷源。属性名用厂商自己的名字与 JSON 类型；机器赋值在机器详情的「BIOS 基线」卡片。"
    />
    <el-card shadow="never">
      <el-table :data="profiles" v-loading="listQuery.isFetching.value">
        <el-table-column type="expand">
          <template #default="{ row }">
            <pre class="attrs-pre">{{ fmtAttrs(row) }}</pre>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="200">
          <template #default="{ row }"><span class="mono">{{ row.name }}</span></template>
        </el-table-column>
        <el-table-column label="属性数" width="90">
          <template #default="{ row }">{{ Object.keys(row.attributes ?? {}).length }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="danger" plain @click.stop="deleteProfile(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :image-size="80" description="尚无基线模板">
            <div class="text-muted" style="font-size: 13px; max-width: 440px; line-height: 1.7">
              基线是命名式的 BIOS 属性集合，漂移巡检以它为参照、批量下发以它为载荷源；
              创建后可在机器详情的「BIOS 基线」卡片赋给机器。
            </div>
            <el-button type="primary" :icon="Plus" @click="openCreate">新建第一个基线</el-button>
          </el-empty>
        </template>
      </el-table>
      <el-alert
        v-if="listQuery.error.value"
        :title="errorMessage(listQuery.error.value)"
        type="error"
        :closable="false"
        show-icon
        class="mt"
      />
    </el-card>

    <el-dialog v-model="createVisible" title="新建 BIOS 基线" width="640px">
      <el-form label-position="top" @submit.prevent="createProfile">
        <el-form-item label="名称" required>
          <el-input v-model="newName" placeholder="如 baseline-2288H-prod" />
        </el-form-item>
        <el-form-item v-if="profiles.length" label="从现有基线复制（可选）">
          <el-select
            v-model="copyFrom"
            placeholder="选择基线，载入其属性后微调"
            style="width: 100%"
            @change="applyCopy"
          >
            <el-option v-for="p in profiles" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="属性编辑方式">
          <el-radio-group v-model="attrMode" @change="onModeChange">
            <el-radio-button value="table">表格</el-radio-button>
            <el-radio-button value="json">JSON</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item
          :label="attrMode === 'table' ? '属性（厂商属性名 + 带类型值）' : '属性 JSON'"
          required
        >
          <div v-if="attrMode === 'table'" class="attrs-editor">
            <div v-for="(row, i) in attrRows" :key="i" class="attr-row">
              <el-input v-model="row.key" placeholder="属性名" class="mono attr-key" />
              <el-input
                v-if="row.type === 'json'"
                v-model="row.value"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 6 }"
                placeholder="嵌套 JSON 值"
                class="mono attr-value"
              />
              <el-input v-else v-model="row.value" placeholder="值" class="mono attr-value" />
              <el-select v-model="row.type" class="attr-type">
                <el-option label="自动" value="auto" />
                <el-option label="字符串" value="string" />
                <el-option label="数字" value="number" />
                <el-option label="布尔" value="boolean" />
                <el-option label="JSON" value="json" />
              </el-select>
              <el-button
                :icon="Delete"
                text
                :disabled="attrRows.length === 1"
                @click="attrRows.splice(i, 1)"
              />
            </div>
            <el-button text type="primary" :icon="Plus" @click="addRow">添加属性</el-button>
          </div>
          <el-input v-else v-model="newAttrsText" type="textarea" :rows="10" class="mono" />
          <div v-if="attrsError" class="attrs-error">{{ attrsError }}</div>
          <div v-else-if="attrMode === 'table'" class="attrs-hint">
            自动类型按值推断：true/false → 布尔、纯数字 → 数字、其余 → 字符串；嵌套值选 JSON 类型。
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="!!attrsError || !newName" @click="createProfile">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mb {
  margin-bottom: 14px;
}
.mt {
  margin-top: 10px;
}
.attrs-pre {
  margin: 4px 0;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.attrs-error {
  color: var(--el-color-danger);
  font-size: 12px;
  margin-top: 4px;
}
.attrs-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-top: 4px;
}
.attrs-editor {
  width: 100%;
}
.attr-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-bottom: 8px;
}
.attr-key {
  flex: 1.2;
}
.attr-value {
  flex: 2;
}
.attr-type {
  width: 96px;
  flex: none;
}
.mono :deep(input),
.mono :deep(textarea) {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12.5px;
}
</style>
