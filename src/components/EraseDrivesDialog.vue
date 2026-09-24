<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { ElMessage, ElNotification } from 'element-plus'
import { WarningFilled } from '@element-plus/icons-vue'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import { formatBytes } from '@/utils/format'
import { useConnectionStore } from '@/stores/connection'

/**
 * 擦盘两段式向导（契约同构）：第一段 = 读活表 + 选择目标 + 显式确认（本组件，
 * confirm:true）；第二段 = 引擎 runner 执行前重读活表，serial 不在表上即拒。
 * 数据按设计不可恢复（NIST 800-88 控制器级 sanitize）。
 */
const props = defineProps<{ machineId: string; modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const router = useRouter()
const conn = useConnectionStore()

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

async function submit() {
  if (selectedCount.value === 0) {
    ElMessage.warning('请先选择要擦除的盘')
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
      body: { type: 'erase_drives', serials: selected.value, confirm: true } as never,
    })
    const jobId = (data as components['schemas']['Job'] | undefined)?.id
    ElNotification.success({
      title: '擦盘已受理',
      message: jobId ? `任务 ${jobId} 已创建，点击查看进度` : '擦盘动作已受理',
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
  <el-dialog v-model="visible" title="擦盘（NIST 800-88 控制器级清除）" width="680px" destroy-on-close>
    <el-alert
      type="error"
      :closable="false"
      show-icon
      title="数据将不可恢复。这是引擎里破坏性最高的操作。"
      description="两段防护：此处显式确认后提交；执行时 runner 还会重读控制器活表，serial 不在表上即拒。"
    />

    <div class="policy-line">
      <el-icon><WarningFilled /></el-icon>
      <span>部署擦盘确认策略：{{ conn.capabilities?.drive_erase_confirm ?? '—' }}</span>
    </div>

    <el-table
      v-loading="drivesQuery.isFetching.value"
      :data="drives"
      size="small"
      class="drive-table"
    >
      <el-table-column width="46">
        <template #header>
          <el-checkbox
            :model-value="allSelected"
            :disabled="drivesQuery.isFetching.value"
            @change="toggleAll"
          />
        </template>
        <template #default="{ row }">
          <el-checkbox
            :model-value="row.serial && selected.includes(row.serial)"
            :disabled="!row.serial"
            @change="(v: boolean) => {
              if (!row.serial) return
              selected = v ? [...selected, row.serial] : selected.filter((s) => s !== row.serial)
            }"
          />
        </template>
      </el-table-column>
      <el-table-column label="名称" width="110">
        <template #default="{ row }"><span class="mono">{{ row.name }}</span></template>
      </el-table-column>
      <el-table-column label="serial" min-width="150">
        <template #default="{ row }">
          <span v-if="row.serial" class="mono">{{ row.serial }}</span>
          <span v-else class="text-muted">无（不可定位，跳过）</span>
        </template>
      </el-table-column>
      <el-table-column label="容量" width="110">
        <template #default="{ row }">{{ row.size_bytes ? formatBytes(row.size_bytes) : '—' }}</template>
      </el-table-column>
      <el-table-column prop="medium" label="介质" width="80" />
      <el-table-column prop="protocol" label="协议" width="100" />
      <template #empty>
        <el-empty :image-size="60" description="控制器未上报物理盘" />
      </template>
    </el-table>

    <el-checkbox v-model="confirmChecked" class="confirm-box">
      我确认擦除所选 {{ selectedCount }} 块盘的全部数据，此操作不可恢复。
    </el-checkbox>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="danger"
        :disabled="selectedCount === 0 || !confirmChecked"
        :loading="submitting"
        @click="submit"
      >
        擦除 {{ selectedCount }} 块盘
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.policy-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.drive-table {
  margin: 6px 0 10px;
}
.confirm-box {
  margin-top: 4px;
}
</style>
