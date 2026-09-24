<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { Refresh, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import { formatTime } from '@/utils/format'

type Credential = components['schemas']['Credential']

const query = useQuery({
  queryKey: ['credentials'],
  queryFn: async () => unwrap(await getClient().GET('/api/v1/credentials')),
})

const rows = computed(() => query.data.value?.items ?? [])

// ── 新建对话框 ──────────────────────────────────────────────────────────────
const visible = ref(false)
const submitting = ref(false)
const form = reactive({
  name: '',
  type: 'bmc' as 'bmc' | 'ssh',
  username: '',
  password: '',
  private_key: '',
})

function openCreate() {
  Object.assign(form, { name: '', type: 'bmc', username: '', password: '', private_key: '' })
  visible.value = true
}

async function submit() {
  if (!form.name.trim() || !form.username.trim()) {
    ElMessage.warning('请填写名称与用户名')
    return
  }
  if (form.type === 'bmc' && !form.password) {
    ElMessage.warning('BMC 凭证需要密码')
    return
  }
  submitting.value = true
  try {
    const secret: components['schemas']['CredentialSecret'] = { username: form.username }
    if (form.password) secret.password = form.password
    if (form.type === 'ssh' && form.private_key.trim()) secret.private_key = form.private_key
    await unwrap(
      await getClient().POST('/api/v1/credentials', {
        body: { name: form.name.trim(), type: form.type, secret },
      }),
    )
    ElMessage.success('凭证已创建（secret 仅此一次提交，之后不可查看）')
    visible.value = false
    void query.refetch()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}

async function remove(c: Credential) {
  try {
    await ElMessageBox.confirm(
      '删除后引用它的机器将无法带外操作（引擎会拒绝仍被引用的凭证）。确定删除？',
      `删除凭证 ${c.name}`,
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await unwrap(await getClient().DELETE('/api/v1/credentials/{id}', { params: { path: { id: c.id } } }))
    ElMessage.success('已删除')
    void query.refetch()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

const TYPE_LABEL: Record<string, string> = { bmc: 'BMC（带外）', ssh: 'SSH（带内）' }
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">凭证</h1>
      <div>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建凭证</el-button>
        <el-button :icon="Refresh" @click="query.refetch()">刷新</el-button>
      </div>
    </div>

    <el-card shadow="never">
      <el-table v-loading="query.isFetching.value" :data="rows" size="default">
        <el-table-column label="类型" width="140">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === 'bmc' ? 'primary' : 'success'" effect="plain">
              {{ TYPE_LABEL[row.type] ?? row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="180" />
        <el-table-column label="ID" min-width="180">
          <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="danger" plain @click.stop="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :image-size="80" description="还没有凭证">
            <div class="text-muted" style="font-size: 13px; max-width: 440px; line-height: 1.7">
              凭证是只写资源：secret 一经创建不可查看。BMC 凭证用于带外操作，
              SSH 凭证用于带内分区级盘查。
            </div>
          </el-empty>
        </template>
      </el-table>
      <el-alert
        v-if="query.error.value"
        :title="errorMessage(query.error.value)"
        type="error"
        :closable="false"
        show-icon
        class="mt"
      />
    </el-card>

    <el-dialog v-model="visible" title="新建凭证" width="520px">
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="名称（唯一）" required>
          <el-input v-model="form.name" placeholder="如 bmc-rack01" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-radio-group v-model="form.type">
            <el-radio-button value="bmc">BMC（带外）</el-radio-button>
            <el-radio-button value="ssh">SSH（带内）</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" class="mono" />
        </el-form-item>
        <el-form-item :label="form.type === 'bmc' ? '密码' : '密码（密钥认证时可留空）'">
          <el-input v-model="form.password" type="password" show-password class="mono" />
        </el-form-item>
        <el-form-item v-if="form.type === 'ssh'" label="私钥 PEM（可选；留在引擎侧作带内 SSH 认证，不会写入装机系统）">
          <el-input v-model="form.private_key" type="textarea" :rows="4" class="mono" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mt {
  margin-top: 10px;
}
.mono :deep(input),
.mono :deep(textarea) {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
</style>
