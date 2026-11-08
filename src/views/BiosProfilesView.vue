<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import { uuid } from '@/utils/uuid'

/**
 * BIOS 基线模板(docs/07-bmc.md §6.2,roadmap 下一阶段 13):命名式声明
 * 属性集——漂移巡检的参照与批量下发的载荷源。属性名用厂商自己的名字与
 * JSON 类型;基线的 unknown/漂移判定在机器详情的漂移卡片上读。
 */
type BiosProfile = components['schemas']['BiosProfile']

const qc = useQueryClient()

const listQuery = useQuery({
  queryKey: ['bios-profiles'],
  queryFn: async () =>
    unwrap(await getClient().GET('/api/v1/bios-profiles')).then((d) => d?.items ?? []),
})

const profiles = computed(() => listQuery.data.value ?? [])

const createVisible = ref(false)
const newName = ref('')
const newAttrsText = ref('{\n  \n}')

const attrsParseError = computed(() => {
  if (!newAttrsText.value.trim()) return '属性不能为空'
  try {
    const v = JSON.parse(newAttrsText.value)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return '属性必须是 JSON 对象'
    if (Object.keys(v).length === 0) return '至少声明一个属性'
    return ''
  } catch (e) {
    return `JSON 解析失败：${(e as Error).message}`
  }
})

async function createProfile() {
  if (attrsParseError.value) {
    ElMessage.warning(attrsParseError.value)
    return
  }
  try {
    const attrs = JSON.parse(newAttrsText.value) as Record<string, unknown>
    await unwrap(await getClient().POST('/api/v1/bios-profiles', {
      header: { 'Idempotency-Key': uuid() },
      body: { name: newName.value, attributes: attrs as never },
    }))
    ElMessage.success('基线已创建')
    createVisible.value = false
    newName.value = ''
    newAttrsText.value = '{\n  \n}'
    void qc.invalidateQueries({ queryKey: ['bios-profiles'] })
  } catch (e) {
    ElMessage.error(errorMessage(e))
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
  <div>
    <div class="page-head">
      <h2>BIOS 基线模板</h2>
      <el-button type="primary" :icon="Plus" @click="createVisible = true">新建基线</el-button>
    </div>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="mb"
      title="命名式 BIOS 属性集：漂移巡检的参照与批量下发的载荷源。属性名用厂商自己的名字与 JSON 类型；机器赋值在机器详情的「BIOS 基线」卡片。"
    />
    <el-card shadow="never">
      <el-table :data="profiles" size="small" v-loading="listQuery.isLoading.value">
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
        <el-table-column prop="created_at" label="创建时间" min-width="160" />
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button size="small" type="danger" plain :icon="Delete" @click="deleteProfile(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="尚无基线模板" :image-size="60">
            <el-button type="primary" :icon="Plus" @click="createVisible = true">新建第一个基线</el-button>
          </el-empty>
        </template>
      </el-table>
    </el-card>

    <el-dialog v-model="createVisible" title="新建 BIOS 基线" width="560px">
      <el-form label-width="80px" label-position="left">
        <el-form-item label="名称">
          <el-input v-model="newName" placeholder="如 baseline-2288H-prod" />
        </el-form-item>
        <el-form-item label="属性 JSON">
          <el-input v-model="newAttrsText" type="textarea" :rows="10" class="mono" />
          <div v-if="attrsParseError" class="attrs-error">{{ attrsParseError }}</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!!attrsParseError || !newName" @click="createProfile">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.mb {
  margin-bottom: 14px;
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
.mono {
  font-family: monospace;
}
</style>
