<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { Refresh, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import { formatBytes, formatTime } from '@/utils/format'

type Image = components['schemas']['Image']

// 镜像有后台拉取（fetching→ready/failed），有 fetching 行时 3s 轮询跟进；
// 列表无分页（契约：newest first 全量返回）
const query = useQuery({
  queryKey: ['images'],
  queryFn: async () => unwrap(await getClient().GET('/api/v1/images')),
  refetchInterval: (q) =>
    (q.state.data?.items ?? []).some((i) => i.state === 'fetching') ? 3000 : false,
})

const rows = computed(() => query.data.value?.items ?? [])

// ── 注册对话框 ──────────────────────────────────────────────────────────────
const regVisible = ref(false)
const reg = ref({ name: '', source_url: '', sha256: '', distro: '', version: '' })
const registering = ref(false)

function openRegister() {
  reg.value = { name: '', source_url: '', sha256: '', distro: '', version: '' }
  regVisible.value = true
}

async function submitRegister() {
  const sha = reg.value.sha256.trim().toLowerCase()
  if (!reg.value.source_url.trim() || !/^[0-9a-f]{64}$/.test(sha)) {
    ElMessage.warning('请填写镜像 URL 与 64 位十六进制 sha256')
    return
  }
  registering.value = true
  try {
    await unwrap(
      await getClient().POST('/api/v1/images', {
        body: {
          name: reg.value.name.trim() || undefined,
          source_url: reg.value.source_url.trim(),
          sha256: sha,
          distro: reg.value.distro.trim() || undefined,
          version: reg.value.version.trim() || undefined,
        },
      }),
    )
    ElMessage.success('已注册，引擎正在拉取镜像（distro/version 留空时引擎会自动识别）')
    regVisible.value = false
    void query.refetch()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    registering.value = false
  }
}

async function remove(img: Image) {
  try {
    await ElMessageBox.confirm(
      '删除后已引用该镜像的既有任务不受影响（job spec 在提交时已快照），但后续装机不能再选择它。确定删除？',
      `删除镜像 ${img.name || img.id}`,
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await unwrap(await getClient().DELETE('/api/v1/images/{id}', { params: { path: { id: img.id } } }))
    ElMessage.success('已删除')
    void query.refetch()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

const STATE_META: Record<string, { label: string; type: 'primary' | 'success' | 'danger' }> = {
  fetching: { label: '拉取中', type: 'primary' },
  ready: { label: '就绪', type: 'success' },
  failed: { label: '失败', type: 'danger' },
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">镜像库</h1>
      <div>
        <el-button type="primary" :icon="Plus" @click="openRegister">注册镜像</el-button>
        <el-button :icon="Refresh" @click="query.refetch()">刷新</el-button>
      </div>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="mb"
      title="SHA256 是门禁不是元数据：拉取时边流边校验，不符即弃、不落缓存；相同摘要的镜像共享同一份缓存文件。"
    />

    <el-card shadow="never">
      <el-table v-loading="query.isFetching.value" :data="rows" size="default">
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="STATE_META[row.state]?.type ?? 'info'" size="small" effect="light">
              {{ STATE_META[row.state]?.label ?? row.state }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="名称" min-width="130">
          <template #default="{ row }">{{ row.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="发行版" width="110">
          <template #default="{ row }">
            <span v-if="row.distro || row.version" class="mono">
              {{ [row.distro, row.version].filter(Boolean).join(' ') }}
            </span>
            <span v-else class="text-muted" title="引擎识别后将自动展示">识别中</span>
          </template>
        </el-table-column>
        <el-table-column label="来源地址" min-width="240">
          <template #default="{ row }"><span class="mono url">{{ row.source_url }}</span></template>
        </el-table-column>
        <el-table-column label="SHA256" min-width="200">
          <template #default="{ row }">
            <span class="mono sha" :title="row.sha256">{{ row.sha256 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="100">
          <template #default="{ row }">{{ row.size_bytes ? formatBytes(row.size_bytes) : '—' }}</template>
        </el-table-column>
        <el-table-column label="注册时间" width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="danger" plain @click.stop="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :image-size="80" description="镜像库是空的">
            <div class="text-muted" style="font-size: 13px; max-width: 460px; line-height: 1.7">
              注册一个 http(s) 镜像地址与其 sha256，引擎会在后台拉取并校验——
              装机时直接从库里选择，不必再手工粘贴校验和。
            </div>
          </el-empty>
        </template>
      </el-table>
      <el-alert
        v-for="(img, i) in rows.filter((r) => r.state === 'failed')"
        :key="i"
        :title="`拉取失败：${img.name || img.source_url}`"
        :description="img.error"
        type="error"
        :closable="false"
        show-icon
        class="mt"
      />
    </el-card>

    <el-dialog v-model="regVisible" title="注册镜像" width="560px">
      <el-form label-position="top" @submit.prevent="submitRegister">
        <el-form-item label="名称（可选；粘贴地址后自动按文件名预填）">
          <el-input v-model="reg.name" placeholder="如 rocky9.4-qa" />
        </el-form-item>
        <el-form-item label="镜像地址（http/s，引擎可达）" required>
          <el-input v-model="reg.source_url" placeholder="https://mirror.example.com/rocky9.iso" class="mono" />
        </el-form-item>
        <el-form-item label="SHA256" required>
          <el-input v-model="reg.sha256" placeholder="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" class="mono" />
          <div class="hint">引擎按它做拉取门禁：不符即弃、不落缓存。发行版与版本留空时，拉取完成后自动识别。</div>
        </el-form-item>
        <el-row :gutter="10">
          <el-col :span="12">
            <el-form-item label="发行版">
              <el-input v-model="reg.distro" placeholder="rocky" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="版本">
              <el-input v-model="reg.version" placeholder="9.4" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="regVisible = false">取消</el-button>
        <el-button type="primary" :loading="registering" @click="submitRegister">注册并拉取</el-button>
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
.url {
  font-size: 12px;
  word-break: break-all;
}
.sha {
  font-size: 11px;
  word-break: break-all;
}
.hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
</style>
