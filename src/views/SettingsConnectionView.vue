<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useQuery } from '@tanstack/vue-query'
import { useConnectionStore } from '@/stores/connection'
import { getClient } from '@/api/client'
import { errorMessage, unwrap } from '@/api/problem'
import DistroBadge from '@/components/DistroBadge.vue'
import { resolveDistroKey, familyLabel, type DistroFamilyKey } from '@/utils/distro'

/** capabilities distros 按"族"聚合（引擎按 distro+版本注册，UI 按族呈现）。 */
const conn = useConnectionStore()
const router = useRouter()

const BOOT_LABEL: Record<string, string> = { virtual_media: '虚拟介质', pxe: 'PXE 网络引导' }
const CONFIRM_LABEL: Record<string, string> = { required: '必须确认', optional: '可选确认' }

const distroGroups = computed(() => {
  const map = new Map<DistroFamilyKey, { name: string; family?: string; pxe_support?: string }[]>()
  for (const d of conn.capabilities?.distros ?? []) {
    const key = resolveDistroKey(d.name, d.family)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push({ name: d.name, family: d.family, pxe_support: d.pxe_support })
  }
  return [...map.entries()]
    .map(([key, items]) => ({
      key,
      label: familyLabel(key),
      items: [...items].sort((a, b) => (a.name < b.name ? -1 : 1)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
})

const editing = ref(false)
const baseUrl = ref('')
const token = ref('')
const probing = ref(false)

const maskedToken = computed(() => {
  if (!conn.token) return '—'
  return conn.token.length <= 8 ? '****' : `${conn.token.slice(0, 4)}****${conn.token.slice(-4)}`
})

function startEdit() {
  baseUrl.value = conn.baseUrl
  token.value = ''
  editing.value = true
}

async function save() {
  probing.value = true
  try {
    const caps = await conn.connect(baseUrl.value.trim(), token.value.trim() || conn.token)
    ElMessage.success(`已连接引擎 v${caps.version}`)
    editing.value = false
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    probing.value = false
  }
}

function disconnect() {
  conn.disconnect()
  router.push({ name: 'welcome' })
}

// ── 当前生效配置（引擎 A6，只读脱敏快照） ───────────────────────────────────
// 配置是进程生命周期的：拉一次就够（staleTime Infinity），手动刷新兜底。
const cfgQuery = useQuery({
  queryKey: ['config'],
  queryFn: async () => unwrap(await getClient().GET('/api/v1/config')),
  staleTime: Infinity,
  refetchOnWindowFocus: false,
})

type ConfigRow = { key: string; value: unknown; redacted: boolean }
const configRows = computed<ConfigRow[]>(() => {
  const cfg = cfgQuery.data.value
  if (!cfg) return []
  const redacted = new Set(cfg.redacted ?? [])
  return Object.entries(cfg.config ?? {})
    .map(([key, value]) => ({ key, value, redacted: redacted.has(key) }))
    .sort((a, b) => a.key.localeCompare(b.key))
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">设置</h1>
    </div>

    <el-card shadow="never" header="连接" class="mb">
      <template v-if="!editing">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="引擎地址">
            <span class="mono">{{ conn.baseUrl || '同源（随控制台访问）' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="API Token">
            <span class="mono">{{ maskedToken }}</span>（仅本机 localStorage 保存）
          </el-descriptions-item>
          <el-descriptions-item label="引擎版本">{{ conn.capabilities?.version ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="连接状态">
            <el-tag :type="conn.unauthorized ? 'danger' : 'success'" size="small">
              {{ conn.unauthorized ? 'Token 已失效' : '正常' }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>
        <div class="actions">
          <el-button @click="startEdit">更换引擎 / Token</el-button>
          <el-button type="danger" plain @click="disconnect">断开连接</el-button>
        </div>
      </template>

      <template v-else>
        <el-form label-position="top" @submit.prevent="save">
          <el-form-item label="引擎地址">
            <el-input v-model="baseUrl" class="mono" />
          </el-form-item>
          <el-form-item label="API Token（留空沿用当前）">
            <el-input v-model="token" type="password" show-password />
          </el-form-item>
          <el-button type="primary" :loading="probing" native-type="submit">保存并探测</el-button>
          <el-button @click="editing = false">取消</el-button>
        </el-form>
      </template>
    </el-card>

    <el-card shadow="never" header="引擎能力（GET /api/v1，只读事实源）">
      <el-descriptions :column="3" border size="small" class="mb-inner">
        <el-descriptions-item label="契约版本">{{ conn.capabilities?.version ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="缺省引导方式">{{ BOOT_LABEL[conn.capabilities?.boot_strategy_default ?? ''] ?? conn.capabilities?.boot_strategy_default ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="资源注册">{{ conn.capabilities?.resources?.join('、') || '—' }}</el-descriptions-item>
        <el-descriptions-item label="PXE / 零注册">
          {{ conn.capabilities?.netboot_enabled ? '已启用' : '未启用' }}
        </el-descriptions-item>
        <el-descriptions-item label="Windows SMB 导出">
          {{ conn.capabilities?.windows_smb_share ? '已配置' : '未配置' }}
        </el-descriptions-item>
        <el-descriptions-item label="Windows agent 通路">
          {{ conn.capabilities?.windows_agent_installer ? '可用' : '不可用' }}
        </el-descriptions-item>
        <el-descriptions-item label="BIOS 修改确认">{{ CONFIRM_LABEL[conn.capabilities?.bios_set_confirm ?? ''] ?? conn.capabilities?.bios_set_confirm ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="擦盘确认">{{ CONFIRM_LABEL[conn.capabilities?.drive_erase_confirm ?? ''] ?? conn.capabilities?.drive_erase_confirm ?? '—' }}</el-descriptions-item>
      </el-descriptions>

      <div class="distro-grid">
        <div v-for="g in distroGroups" :key="g.key" class="distro-card">
          <div class="head">
            <DistroBadge :badge-key="g.key" />
            <span class="fname">{{ g.label }}</span>
          </div>
          <div class="vers">
            <div v-for="v in g.items" :key="v.name" class="ver">
              <span class="mono ver-name">{{ v.name }}</span>
              <span class="carriers">
                <el-tag size="small" type="primary" effect="light">虚拟介质</el-tag>
                <el-tag
                  v-if="v.pxe_support && v.pxe_support !== 'none'"
                  size="small"
                  :type="v.pxe_support === 'full' ? 'success' : 'warning'"
                  effect="light"
                >
                  PXE{{ v.pxe_support === 'partial' ? '（部分）' : '' }}
                </el-tag>
                <el-tag v-else size="small" type="info" effect="plain">无 PXE</el-tag>
              </span>
            </div>
          </div>
        </div>
        <div v-if="(conn.capabilities?.distros ?? []).length === 0" class="text-muted">
          未注册任何发行版驱动
        </div>
      </div>
    </el-card>

    <el-card shadow="never" class="mb">
      <template #header>
        <div class="cfg-header">
          <span>当前生效配置（引擎只读快照，敏感项已脱敏）</span>
          <el-button size="small" :loading="cfgQuery.isFetching.value" @click="() => cfgQuery.refetch()">
            刷新
          </el-button>
        </div>
      </template>
      <el-collapse>
        <el-collapse-item :title="`展开查看 ${configRows.length} 项（env 名为键，与部署环境文件一致）`">
          <el-table :data="configRows" size="small" border max-height="420">
            <el-table-column label="环境变量" width="380">
              <template #default="{ row }">
                <span class="mono cfg-key">{{ row.key }}</span>
                <el-tag v-if="row.redacted" size="small" type="warning" effect="plain" class="cfg-tag">脱敏</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="生效值" min-width="220">
              <template #default="{ row }">
                <template v-if="row.redacted">
                  <template v-if="row.value !== null && row.value !== undefined">
                    <span class="mono">***</span><span class="text-muted">（已配置）</span>
                  </template>
                  <span v-else class="text-muted">未配置</span>
                </template>
                <span v-else-if="row.value === null || row.value === undefined" class="text-muted">未设置</span>
                <span v-else class="mono">{{ String(row.value) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
      <div class="text-muted cfg-note">
        修改配置请走部署层（编辑 env 文件或 compose 环境段后重启引擎）——引擎有意不提供运行时写路径，
        Token / 密钥 / 数据库地址 / SMB 与 relay 凭据等敏感项只显示已配置状态，不显示值。
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.mb {
  margin-bottom: 14px;
}
.mb-inner {
  margin-bottom: 12px;
}
.actions {
  margin-top: 12px;
}
.mono :deep(input) {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.distro-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
}
.distro-card {
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: var(--el-fill-color-extra-light);
}
.distro-card .head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.distro-card .fname {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.distro-card .ver {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
}
.distro-card .ver-name {
  font-size: 12.5px;
  color: var(--el-text-color-regular);
}
.distro-card .carriers {
  display: inline-flex;
  gap: 4px;
}
.cfg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cfg-key {
  font-size: 12.5px;
}
.cfg-tag {
  margin-left: 8px;
}
.cfg-note {
  margin-top: 10px;
  font-size: 12.5px;
}
</style>
