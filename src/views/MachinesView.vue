<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { ElMessage } from 'element-plus'
import { Refresh, Search } from '@element-plus/icons-vue'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import StateBadge from '@/components/StateBadge.vue'
import PowerBadge from '@/components/PowerBadge.vue'
import MachineActions from '@/components/MachineActions.vue'
import RegisterMachineDialog from '@/components/RegisterMachineDialog.vue'
import { formatBytes, formatTime } from '@/utils/format'

type Machine = components['schemas']['Machine']
type MachineState = components['schemas']['MachineState']

const PAGE_SIZE = 50

const router = useRouter()
const stateFilter = ref<MachineState | ''>('')
const q = ref('')
const qInput = ref('')
const labelChips = ref<string[]>([])
const labelInput = ref('')
const registerVisible = ref(false)

/** 游标分页：只有“下一页”（next_cursor），用栈记住来路实现“上一页”。 */
const cursor = ref<string | undefined>(undefined)
const cursorStack = ref<(string | undefined)[]>([])

const query = useQuery({
  queryKey: computed(() => ['machines', stateFilter.value, q.value, labelChips.value, cursor.value]),
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/machines', {
        params: {
          query: {
            state: stateFilter.value || undefined,
            q: q.value || undefined,
            labels: labelChips.value.length > 0 ? labelChips.value : undefined,
            page_size: PAGE_SIZE,
            cursor: cursor.value,
          },
        },
      }),
    ),
})

const rows = computed(() => query.data.value?.items ?? [])
const nextCursor = computed(() => query.data.value?.next_cursor ?? null)

function applySearch() {
  q.value = qInput.value.trim()
  cursor.value = undefined
  cursorStack.value = []
}

function addLabel() {
  const v = labelInput.value.trim()
  if (!v) return
  if (!/^[^=]+=[^=]*$/.test(v)) {
    ElMessage.warning('标签过滤格式为 k=v，例如 env=prod')
    return
  }
  if (!labelChips.value.includes(v)) labelChips.value = [...labelChips.value, v]
  labelInput.value = ''
  cursor.value = undefined
  cursorStack.value = []
}

function removeLabel(chip: string) {
  labelChips.value = labelChips.value.filter((c) => c !== chip)
  cursor.value = undefined
  cursorStack.value = []
}

function nextPage() {
  if (!nextCursor.value) return
  cursorStack.value = [...cursorStack.value, cursor.value]
  cursor.value = nextCursor.value
}

function prevPage() {
  const prev = cursorStack.value[cursorStack.value.length - 1]
  cursorStack.value = cursorStack.value.slice(0, -1)
  cursor.value = prev
}

function openDetail(m: Machine, _col: unknown, event: Event) {
  if ((event.target as HTMLElement)?.closest('.sel-col')) return
  router.push({ name: 'machine-detail', params: { id: m.id } })
}

const selected = ref<Machine[]>([])

function startInstall() {
  const ids = selected.value.map((m) => m.id).join(',')
  router.push({ name: 'install-wizard', query: { machines: ids } })
}

// 批量打标签：引擎 A5 批量端点（单事务全有或全无）——添加 upsert + 按 key 删除
const batchLabelVisible = ref(false)
const batchChips = ref<string[]>([])
const batchInput = ref('')
const batchRemoveKeys = ref<string[]>([])
const batchApplying = ref(false)

// 所选机器标签 key 的并集——可删除项从这里勾选。
const removableKeys = computed(() => {
  const set = new Set<string>()
  for (const m of selected.value) for (const k of Object.keys(m.labels ?? {})) set.add(k)
  return [...set].sort()
})

function openBatchLabels() {
  batchChips.value = []
  batchInput.value = ''
  batchRemoveKeys.value = []
  batchLabelVisible.value = true
}

function addBatchChip() {
  const v = batchInput.value.trim()
  if (!v) return
  if (!/^[^=]+=[^=]*$/.test(v)) {
    ElMessage.warning('标签格式为 k=v')
    return
  }
  if (!batchChips.value.includes(v)) batchChips.value = [...batchChips.value, v]
  batchInput.value = ''
}

async function applyBatchLabels() {
  const newLabels = Object.fromEntries(
    batchChips.value.map((c) => {
      const i = c.indexOf('=')
      return [c.slice(0, i), c.slice(i + 1)] as [string, string]
    }),
  )
  const clash = batchRemoveKeys.value.filter((k) => k in newLabels)
  if (clash.length > 0) {
    ElMessage.warning(`标签 ${clash.join('、')} 同时在添加与删除里，请二选一`)
    return
  }
  if (Object.keys(newLabels).length === 0 && batchRemoveKeys.value.length === 0) {
    ElMessage.warning('请先添加或勾选要删除的标签')
    return
  }
  batchApplying.value = true
  try {
    await unwrap(
      await getClient().POST('/api/v1/machines/batch-labels', {
        body: {
          machine_ids: selected.value.map((m) => m.id),
          add: Object.keys(newLabels).length > 0 ? newLabels : undefined,
          remove: batchRemoveKeys.value.length > 0 ? batchRemoveKeys.value : undefined,
        },
      }),
    )
    ElMessage.success(`已为 ${selected.value.length} 台机器更新标签`)
    batchLabelVisible.value = false
    void query.refetch()
  } catch (e) {
    // 引擎全有或全无：失败即整体未生效，直接报错
    ElMessage.error(errorMessage(e))
  } finally {
    batchApplying.value = false
  }
}

function onRegistered(m: Machine) {
  void query.refetch()
  router.push({ name: 'machine-detail', params: { id: m.id } })
}

function onActionSubmitted() {
  void query.refetch()
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">机器</h1>
      <div>
        <el-button type="primary" :disabled="selected.length === 0" @click="startInstall">
          装机{{ selected.length > 0 ? `（${selected.length} 台）` : '' }}
        </el-button>
        <el-button :disabled="selected.length === 0" @click="openBatchLabels">
          打标签{{ selected.length > 0 ? `（${selected.length} 台）` : '' }}
        </el-button>
        <el-button @click="registerVisible = true">注册机器</el-button>
        <el-button :icon="Refresh" @click="query.refetch()">刷新</el-button>
      </div>
    </div>

    <el-card shadow="never" class="toolbar">
      <div class="filters">
        <el-select
          v-model="stateFilter"
          placeholder="全部状态"
          clearable
          style="width: 130px"
          @change="cursor = undefined; cursorStack = []"
        >
          <el-option label="注册中" value="registering" />
          <el-option label="盘查中" value="discovering" />
          <el-option label="就绪" value="ready" />
          <el-option label="异常" value="error" />
        </el-select>
        <el-input
          v-model="qInput"
          placeholder="序列号 / BMC 地址 / 厂商 / 型号 / 标签 / ID"
          clearable
          style="width: 320px"
          @keyup.enter="applySearch"
          @clear="applySearch"
        />
        <el-input
          v-model="labelInput"
          placeholder="标签过滤 k=v，回车添加"
          style="width: 220px"
          @keyup.enter="addLabel"
        />
        <el-button type="primary" :icon="Search" @click="applySearch">搜索</el-button>
      </div>
      <div v-if="labelChips.length > 0" class="chips">
        <el-tag
          v-for="chip in labelChips"
          :key="chip"
          closable
          size="small"
          @close="removeLabel(chip)"
        >
          {{ chip }}
        </el-tag>
      </div>
    </el-card>

    <el-card shadow="never">
      <el-table
        v-loading="query.isFetching.value"
        :data="rows"
        size="default"
        :row-style="{ cursor: 'pointer' }"
        @row-click="openDetail"
        @selection-change="(rows: Machine[]) => (selected = rows)"
      >
        <el-table-column type="selection" width="42" class-name="sel-col" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><StateBadge kind="machine" :state="row.state" /></template>
        </el-table-column>
        <el-table-column label="ID" width="150">
          <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column label="BMC 地址" min-width="130">
          <template #default="{ row }"><span class="mono">{{ row.bmc.address }}</span></template>
        </el-table-column>
        <el-table-column prop="bmc.protocol" label="协议" width="80" />
        <el-table-column label="厂商 / 型号" min-width="130">
          <template #default="{ row }">
            <span v-if="row.bmc.vendor || row.bmc.model">
              {{ row.bmc.vendor || '—' }} · {{ row.bmc.model || '—' }}
            </span>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="序列号" min-width="120">
          <template #default="{ row }">
            <span class="mono">{{ row.hardware?.serial_number || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="CPU / 内存" min-width="130">
          <template #default="{ row }">
            <template v-if="row.hardware?.cpu?.cores">
              {{ row.hardware.cpu.cores }}C · {{ formatBytes(row.hardware.memory_bytes) }}
              <div v-if="row.hardware.cpu.model" class="text-muted cpu-model">{{ row.hardware.cpu.model }}</div>
            </template>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="电源" width="90">
          <template #default="{ row }"><PowerBadge :state="row.power_state" /></template>
        </el-table-column>
        <el-table-column label="标签" min-width="110">
          <template #default="{ row }">
            <el-tag
              v-for="(v, k) in row.labels"
              :key="k"
              size="small"
              effect="plain"
              class="label-tag"
            >
              {{ k }}={{ v }}
            </el-tag>
            <span v-if="Object.keys(row.labels).length === 0" class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="注册时间" width="160">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <MachineActions
              :machine-id="row.id"
              :power-state="row.power_state"
              flat
              @submitted="onActionSubmitted"
            />
          </template>
        </el-table-column>
        <template #empty>
          <el-empty
            description="还没有机器"
            :image-size="80"
          >
            <div class="text-muted" style="font-size: 13px">
              通过 API 注册（POST /api/v1/machines），或开启引擎零注册等机器自己出现。
            </div>
          </el-empty>
        </template>
      </el-table>

      <div class="pager">
        <span class="text-muted" style="font-size: 13px">游标分页：仅支持前后翻页</span>
        <div>
          <el-button size="small" :disabled="cursorStack.length === 0" @click="prevPage">上一页</el-button>
          <el-button size="small" :disabled="!nextCursor" @click="nextPage">下一页</el-button>
        </div>
      </div>
      <el-alert
        v-if="query.error.value"
        :title="errorMessage(query.error.value)"
        type="error"
        :closable="false"
        show-icon
        class="mt"
      />
    </el-card>

    <RegisterMachineDialog v-model="registerVisible" @registered="onRegistered" />

    <el-dialog v-model="batchLabelVisible" :title="`批量打标签（${selected.length} 台）`" width="480px">
      <el-form label-position="top" @submit.prevent="applyBatchLabels">
        <el-form-item label="添加标签（k=v，回车添加；已存在的同 key 会被覆盖）">
          <el-input v-model="batchInput" placeholder="env=prod" @keyup.enter="addBatchChip" />
          <el-tag
            v-for="chip in batchChips"
            :key="chip"
            closable
            size="small"
            style="margin: 6px 6px 0 0"
            @close="batchChips = batchChips.filter((c) => c !== chip)"
          >
            {{ chip }}
          </el-tag>
        </el-form-item>
        <el-form-item v-if="removableKeys.length > 0" label="删除标签（所选机器现有标签的并集）">
          <el-checkbox-group v-model="batchRemoveKeys">
            <el-checkbox v-for="k in removableKeys" :key="k" :value="k" style="margin-right: 14px">
              {{ k }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <div class="text-muted" style="font-size: 12.5px">
          引擎单事务提交：任一台失败则整批不生效。
        </div>
      </el-form>
      <template #footer>
        <el-button @click="batchLabelVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchApplying" @click="applyBatchLabels">应用到选中机器</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar {
  margin-bottom: 14px;
}
.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.chips {
  margin-top: 10px;
  display: flex;
  gap: 6px;
}
.label-tag {
  margin-right: 4px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}
.mt {
  margin-top: 10px;
}
.cpu-model {
  font-size: 12px;
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
