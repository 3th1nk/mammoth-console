<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useQuery } from '@tanstack/vue-query'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'

/**
 * 注册机器表单（POST /machines 与零注册 claim 复用，docs/03-product-design.md §7.2/§7.3）。
 * 引擎无凭证列表端点（已记入引擎反馈清单）：凭证支持"内联新建"或"粘贴已有 ID"。
 */
const props = defineProps<{ modelValue: boolean; claimMac?: string }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  registered: [machine: components['schemas']['Machine']]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const bmcAddress = ref('')
const protocol = ref<'auto' | 'redfish' | 'ipmi' | 'fake'>('auto')
const credMode = ref<'new' | 'existing'>('new')
const credName = ref('')
const credUser = ref('')
const credPass = ref('')
const credId = ref('')
const useSsh = ref(false)
const sshCredId = ref('')
const sshAddress = ref('')
const labelChips = ref<string[]>([])
const labelInput = ref('')
const submitting = ref(false)

// 凭证列表（元数据，无 secret）：打开对话框时拉取
const credsQuery = useQuery({
  queryKey: ['credentials'],
  queryFn: async () => unwrap(await getClient().GET('/api/v1/credentials')),
  enabled: visible,
})
const bmcCreds = computed(() => (credsQuery.data.value?.items ?? []).filter((c) => c.type === 'bmc'))
const sshCreds = computed(() => (credsQuery.data.value?.items ?? []).filter((c) => c.type === 'ssh'))

watch(visible, (v) => {
  if (v) {
    bmcAddress.value = ''
    protocol.value = 'auto'
    credMode.value = 'new'
    credName.value = ''
    credUser.value = ''
    credPass.value = ''
    credId.value = ''
    useSsh.value = false
    sshCredId.value = ''
    sshAddress.value = ''
    labelChips.value = []
    labelInput.value = ''
  }
})

function addLabel() {
  const v = labelInput.value.trim()
  if (!v) return
  if (!/^[^=]+=[^=]*$/.test(v)) {
    ElMessage.warning('标签格式为 k=v')
    return
  }
  if (!labelChips.value.includes(v)) labelChips.value = [...labelChips.value, v]
  labelInput.value = ''
}

const labels = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  for (const chip of labelChips.value) {
    const [k, ...rest] = chip.split('=')
    if (k) out[k] = rest.join('=')
  }
  return out
})

async function createCredential(): Promise<string> {
  const { data, error } = await getClient().POST('/api/v1/credentials', {
    body: {
      name: credName.value.trim(),
      type: 'bmc',
      secret: { username: credUser.value, password: credPass.value },
    },
  })
  if (error !== undefined && error !== null) {
    throw error
  }
  return (data as components['schemas']['Credential']).id
}

async function submit() {
  if (!bmcAddress.value.trim()) {
    ElMessage.warning('请填写 BMC 地址')
    return
  }
  if (credMode.value === 'new' && (!credName.value.trim() || !credUser.value || !credPass.value)) {
    ElMessage.warning('请填写新凭证的名称、用户名与密码')
    return
  }
  if (credMode.value === 'existing' && !credId.value.trim()) {
    ElMessage.warning('请填写已有凭证 ID（cred_…）')
    return
  }
  submitting.value = true
  try {
    let credentialId = credId.value.trim()
    if (credMode.value === 'new') {
      credentialId = await createCredential()
    }
    const body: components['schemas']['MachineCreate'] = {
      labels: labels.value,
      bmc: {
        address: bmcAddress.value.trim(),
        protocol: protocol.value,
        credential_id: credentialId as components['schemas']['CredentialId'],
      },
    }
    if (useSsh.value && sshCredId.value.trim()) {
      body.ssh_credential_id = sshCredId.value.trim() as components['schemas']['CredentialId']
      if (sshAddress.value.trim()) body.ssh = { address: sshAddress.value.trim() }
    }
    const machine = props.claimMac
      ? await unwrap(
          await getClient().POST('/api/v1/pending-machines/{mac}/claim', {
            params: { path: { mac: props.claimMac } },
            body,
          }),
        )
      : await unwrap(await getClient().POST('/api/v1/machines', { body }))
    ElMessage.success(
      props.claimMac
        ? `认领成功：${machine.id}，固件观测与探针报告已迁移`
        : `注册成功：${machine.id}，已自动开始盘查`,
    )
    visible.value = false
    emit('registered', machine as components['schemas']['Machine'])
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="claimMac ? `认领机器 ${claimMac}` : '注册机器'"
    width="560px"
  >
    <el-alert
      v-if="claimMac"
      type="info"
      :closable="false"
      show-icon
      class="mb"
      title="认领 = 补齐 BMC 寻址与凭证， sighting 的固件观测与探针报告会迁移到新机器"
    />
    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item label="BMC 地址（host 或 host:port）">
        <el-input v-model="bmcAddress" placeholder="203.0.113.10 或 203.0.113.10:443" class="mono" />
      </el-form-item>
      <el-form-item label="带外协议">
        <el-radio-group v-model="protocol">
          <el-radio-button value="auto">自动（Redfish→IPMI）</el-radio-button>
          <el-radio-button value="redfish">Redfish</el-radio-button>
          <el-radio-button value="ipmi">IPMI</el-radio-button>
          <el-radio-button value="fake">fake（演示）</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="BMC 凭证">
        <el-radio-group v-model="credMode">
          <el-radio-button value="new">新建凭证</el-radio-button>
          <el-radio-button value="existing">使用已有凭证</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <template v-if="credMode === 'new'">
        <el-form-item label="凭证名称">
          <el-input v-model="credName" placeholder="如 bmc-rack01（唯一）" />
        </el-form-item>
        <el-row :gutter="10">
          <el-col :span="12">
            <el-form-item label="用户名">
              <el-input v-model="credUser" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="密码">
              <el-input v-model="credPass" type="password" show-password />
            </el-form-item>
          </el-col>
        </el-row>
        <div class="hint">密码仅用于提交：加密存储后任何接口都不会回显，请自行妥善保管。</div>
      </template>
      <el-form-item v-else label="选择 BMC 凭证">
        <el-select
          v-model="credId"
          filterable
          placeholder="选择凭证"
          style="width: 100%"
        >
          <el-option
            v-for="c in bmcCreds"
            :key="c.id"
            :value="c.id"
            :label="`${c.name}（${c.id}）`"
          />
        </el-select>
      </el-form-item>

      <el-collapse>
        <el-collapse-item name="ssh">
          <template #title>带内 SSH（可选，用于分区级盘查）</template>
          <el-form-item label="SSH 凭证（可选）">
            <el-select
              v-model="sshCredId"
              clearable
              filterable
              placeholder="选择 SSH 凭证"
              style="width: 100%"
            >
              <el-option
                v-for="c in sshCreds"
                :key="c.id"
                :value="c.id"
                :label="`${c.name}（${c.id}）`"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="带内地址">
            <el-input v-model="sshAddress" placeholder="机器业务网 IP（与 BMC 带外网络无关）" class="mono" />
          </el-form-item>
        </el-collapse-item>
      </el-collapse>

      <el-form-item label="标签" class="label-item">
        <el-input
          v-model="labelInput"
          placeholder="k=v，回车添加（如 env=prod）"
          @keyup.enter="addLabel"
        />
        <el-tag
          v-for="chip in labelChips"
          :key="chip"
          closable
          size="small"
          class="chip"
          @close="labelChips = labelChips.filter((c) => c !== chip)"
        >
          {{ chip }}
        </el-tag>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">
        {{ claimMac ? '认领' : '注册' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.mb {
  margin-bottom: 12px;
}
.hint {
  font-size: 12px;
  color: #909399;
  margin-top: -6px;
}
.label-item :deep(.el-form-item__content) {
  flex-wrap: wrap;
}
.chip {
  margin-top: 6px;
  margin-right: 6px;
}
.mono :deep(input) {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
</style>
