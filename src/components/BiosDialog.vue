<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { ElMessage, ElNotification } from 'element-plus'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import { useConnectionStore } from '@/stores/connection'

/**
 * BIOS 属性两段式修改（契约同构）：读活表 → 修改 → 显式确认（confirm:true）→
 * 引擎 runner 执行前重读活属性表，未知名称即拒。属性值是 pending——BMC 在
 * 下次引导时应用。
 */
const props = defineProps<{ machineId: string; modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const router = useRouter()
const conn = useConnectionStore()

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
    ElMessage.warning('没有修改任何属性')
    return
  }
  if (!confirmChecked.value) {
    ElMessage.warning('请先勾选确认框')
    return
  }
  submitting.value = true
  try {
    const { data } = await getClient().POST('/api/v1/machines/{id}/actions', {
      params: {
        path: { id: props.machineId },
        header: { 'Idempotency-Key': crypto.randomUUID() },
      },
      body: { type: 'set_bios_attributes', attributes, confirm: true } as never,
    })
    const jobId = (data as components['schemas']['Job'] | undefined)?.id
    ElNotification.success({
      title: 'BIOS 修改已受理',
      message: jobId ? `任务 ${jobId} 已创建（属性在下次引导时生效）` : '已受理',
      onClick: () => {
        if (jobId) router.push({ name: 'job-detail', params: { id: jobId } })
      },
      duration: 6000,
    })
    visible.value = false
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="修改 BIOS 属性（下次引导生效）" width="680px" destroy-on-close>
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="属性为 pending 值：提交后由 BMC 在下次引导时应用。引擎执行前会重读活属性表，未知属性名即拒。"
    />
    <div class="policy-line">
      <span>部署 BIOS 确认策略：{{ conn.capabilities?.bios_set_confirm ?? '—' }}</span>
    </div>

    <el-table
      v-loading="biosQuery.isFetching.value"
      :data="rows"
      size="small"
      class="attr-table"
    >
      <el-table-column label="属性名" min-width="200">
        <template #default="{ row }"><span class="mono">{{ row.name }}</span></template>
      </el-table-column>
      <el-table-column label="当前值" min-width="140">
        <template #default="{ row }"><span class="mono">{{ row.current }}</span></template>
      </el-table-column>
      <el-table-column label="新值（留空=清空）" min-width="180">
        <template #default="{ row }">
          <el-input v-model="row.draft" size="small" class="mono" />
        </template>
      </el-table-column>
      <el-table-column label="恢复" width="70">
        <template #default="{ row }">
          <el-button
            v-if="row.draft !== row.current"
            size="small"
            text
            @click="row.draft = row.current"
          >
            还原
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :image-size="60" description="控制器未上报 BIOS 属性表" />
      </template>
    </el-table>

    <el-checkbox v-model="confirmChecked" class="confirm-box" :disabled="changedRows.length === 0">
      我确认提交 {{ changedRows.length }} 项属性修改。
    </el-checkbox>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :disabled="changedRows.length === 0 || !confirmChecked"
        :loading="submitting"
        @click="submit"
      >
        提交 {{ changedRows.length }} 项修改
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.policy-line {
  margin: 10px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.attr-table {
  margin: 6px 0 10px;
}
.confirm-box {
  margin-top: 4px;
}
</style>
