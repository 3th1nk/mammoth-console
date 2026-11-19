<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, LoaderCircle, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { pendingDomain, machineDomain, credentialsKey, credentialDomain } from '@/api/queryKeys'
import type { components } from '@/api/types.gen'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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

const qc = useQueryClient()

const submitting = ref(false)

const bmcAddress = ref('')
const protocol = ref<'auto' | 'redfish' | 'ipmi' | 'fake' | 'none'>('auto')
// headless（protocol=none）形态：机器无带外控制器，NIC MAC 即身份——
// 引擎契约是合成地址 none://<mac>（docs/13-headless-design.md §2），表单
// 只收 MAC 并自动拼前缀；无 BMC 凭证（credential_id 留空）。
const headlessMac = ref('')
const isHeadless = computed(() => protocol.value === 'none')
const MAC_OK = /^[0-9a-fA-F]{2}(:?[0-9a-fA-F]{2}){5}$/

function headlessAddress(): string {
  const mac = headlessMac.value.trim()
  if (!mac) return ''
  const norm = mac.replace(/-/g, '').replace(/:/g, '').toLowerCase()
  const colon = norm.replace(/(..)(..)(..)(..)(..)(..)/, '$1:$2:$3:$4:$5:$6')
  return 'none://' + colon
}
// 认领提示随协议切换：无带外没有 BMC 可补，认领即确认按无带外登记
// （引擎要求 claim 显式带 protocol=none，docs/13-headless-design.md §3.1）。
const claimTip = computed(() =>
  isHeadless.value
    ? '认领 = 按无带外机器登记（以该 MAC 为身份，无需 BMC 寻址与凭证），sighting 的固件观测与探针报告会迁移到新机器'
    : '认领 = 补齐 BMC 寻址与凭证，sighting 的固件观测与探针报告会迁移到新机器',
)
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

// 凭证列表（元数据，无 secret）：打开对话框时拉取
const credsQuery = useQuery({
  queryKey: credentialsKey,
  queryFn: async () => unwrap(await getClient().GET('/api/v1/credentials')),
  enabled: visible,
})
const bmcCreds = computed(() => (credsQuery.data.value?.items ?? []).filter((c) => c.type === 'bmc'))
const sshCreds = computed(() => (credsQuery.data.value?.items ?? []).filter((c) => c.type === 'ssh'))

watch(visible, (v) => {
  if (v) {
    bmcAddress.value = ''
    protocol.value = 'auto'
    // 认领时身份 MAC 即 sighting 的 MAC：引擎 claim 会把地址改写成
    // none://<该 MAC>，表单里改了也不生效——预填并锁定，免手填。
    headlessMac.value = props.claimMac ?? ''
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
    toast.warning('标签格式为 k=v')
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
  let bmcAddressFinal = bmcAddress.value.trim()
  let credentialIdFinal = credId.value.trim()
  if (isHeadless.value) {
    if (!MAC_OK.test(headlessMac.value.trim())) {
      toast.warning('请填写装机网卡的 MAC 地址（如 AA:BB:CC:DD:EE:01）')
      return
    }
    bmcAddressFinal = headlessAddress()
    credentialIdFinal = ''
  } else {
    if (!bmcAddressFinal) {
      toast.warning('请填写 BMC 地址')
      return
    }
    if (credMode.value === 'new' && (!credName.value.trim() || !credUser.value || !credPass.value)) {
      toast.warning('请填写新凭证的名称、用户名与密码')
      return
    }
    if (credMode.value === 'existing' && !credentialIdFinal) {
      toast.warning('请填写已有凭证 ID（cred_…）')
      return
    }
    if (credMode.value === 'new') {
      credentialIdFinal = await createCredential()
    }
  }
  submitting.value = true
  try {
    const body: components['schemas']['MachineCreate'] = {
      labels: labels.value,
      bmc: {
        address: bmcAddressFinal,
        protocol: protocol.value,
        credential_id: credentialIdFinal as components['schemas']['CredentialId'],
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
    toast.success(
      props.claimMac
        ? `认领成功：${machine.id}，固件观测与探针报告已迁移`
        : `注册成功：${machine.id}，已自动开始盘查`,
    )
    // 即时失效，不等 SSE 回环：认领/注册影响待认领数与机器台账；
    // 内联新建凭证时凭证列表也变了（徽标/列表/详情页全部联动刷新）
    void qc.invalidateQueries({ queryKey: pendingDomain })
    void qc.invalidateQueries({ queryKey: machineDomain })
    if (credMode.value === 'new' && !isHeadless.value) {
      void qc.invalidateQueries({ queryKey: credentialDomain })
    }
    visible.value = false
    emit('registered', machine as components['schemas']['Machine'])
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="visible">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>{{ claimMac ? `认领机器 ${claimMac}` : '注册机器' }}</DialogTitle>
        <DialogDescription v-if="!claimMac">录入机器的 BMC 寻址与凭证，注册后自动开始盘查。</DialogDescription>
        <DialogDescription v-else>为 sighting 补齐登记信息完成收编。</DialogDescription>
      </DialogHeader>

      <Alert v-if="claimMac" class="border-blue-500/30 bg-blue-500/5">
        <AlertTitle>{{ claimTip }}</AlertTitle>
        <AlertDescription v-if="isHeadless" class="text-xs">
          已取自该机器 PXE 引导时上报的 MAC（引擎认领以此为身份，不可改）。
        </AlertDescription>
      </Alert>

      <form class="grid gap-4" @submit.prevent="submit">
        <div class="grid gap-1.5">
          <Label>带外协议</Label>
          <RadioGroup
            v-model="protocol"
            class="flex flex-wrap gap-2 [&_[data-slot=radio-group-item]]:border [&_[data-slot=radio-group-item]]:rounded-md [&_[data-slot=radio-group-item]]:px-2.5 [&_[data-slot=radio-group-item]]:py-1.5 [&_[data-slot=radio-group-item]]:text-xs"
          >
            <Label class="flex cursor-pointer items-center gap-1.5 font-normal"><RadioGroupItem value="auto" /> 自动（Redfish→IPMI）</Label>
            <Label class="flex cursor-pointer items-center gap-1.5 font-normal"><RadioGroupItem value="redfish" /> Redfish</Label>
            <Label class="flex cursor-pointer items-center gap-1.5 font-normal"><RadioGroupItem value="ipmi" /> IPMI</Label>
            <Label class="flex cursor-pointer items-center gap-1.5 font-normal"><RadioGroupItem value="fake" /> 演示</Label>
            <Label class="flex cursor-pointer items-center gap-1.5 font-normal"><RadioGroupItem value="none" /> 无带外</Label>
          </RadioGroup>
        </div>

        <div v-if="isHeadless" class="grid gap-1.5">
          <Label for="headless-mac">装机网卡 MAC（机器身份，装机走 PXE + WoL/人工上电）</Label>
          <Input id="headless-mac" v-model="headlessMac" placeholder="AA:BB:CC:DD:EE:01" class="font-mono" :disabled="!!claimMac" />
          <p class="text-xs leading-relaxed text-muted-foreground">
            无带外机器以合成地址 none://&lt;mac&gt; 注册；装机网段需 PXE 可达，关机唤醒依赖
            WoL（跨网段需引擎侧 edge 代发）或人工上电兜底。
          </p>
        </div>
        <div v-else class="grid gap-1.5">
          <Label for="bmc-address">BMC 地址（host 或 host:port）</Label>
          <Input id="bmc-address" v-model="bmcAddress" placeholder="203.0.113.10 或 203.0.113.10:443" class="font-mono" />
        </div>

        <template v-if="!isHeadless">
          <div class="grid gap-1.5">
            <Label>BMC 凭证</Label>
            <RadioGroup
              v-model="credMode"
              class="flex gap-2 [&_[data-slot=radio-group-item]]:border [&_[data-slot=radio-group-item]]:rounded-md [&_[data-slot=radio-group-item]]:px-3 [&_[data-slot=radio-group-item]]:py-1.5 [&_[data-slot=radio-group-item]]:text-xs"
            >
              <Label class="flex cursor-pointer items-center gap-1.5 font-normal"><RadioGroupItem value="new" /> 新建凭证</Label>
              <Label class="flex cursor-pointer items-center gap-1.5 font-normal"><RadioGroupItem value="existing" /> 使用已有凭证</Label>
            </RadioGroup>
          </div>

          <div v-if="credMode === 'new'" class="grid gap-4">
            <div class="grid gap-1.5">
              <Label for="cred-name">凭证名称</Label>
              <Input id="cred-name" v-model="credName" placeholder="如 bmc-rack01（唯一）" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label for="cred-user">用户名</Label>
                <Input id="cred-user" v-model="credUser" />
              </div>
              <div class="grid gap-1.5">
                <Label for="cred-pass">密码</Label>
                <Input id="cred-pass" v-model="credPass" type="password" />
              </div>
            </div>
            <p class="text-xs text-muted-foreground">
              密码仅用于提交：加密存储后任何接口都不会回显，请自行妥善保管。
            </p>
          </div>
          <div v-else class="grid gap-1.5">
            <Label>选择 BMC 凭证</Label>
            <Select v-model="credId">
              <SelectTrigger>
                <SelectValue placeholder="选择凭证" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="c in bmcCreds" :key="c.id" :value="c.id">
                  {{ c.name }}（{{ c.id }}）
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Collapsible>
            <CollapsibleTrigger
              class="group flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
            >
              带内 SSH（可选，用于分区级盘查）
              <ChevronDown class="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent class="grid gap-4 pt-3">
              <div class="grid gap-1.5">
                <Label>SSH 凭证</Label>
                <Select v-model="sshCredId">
                  <SelectTrigger>
                    <SelectValue placeholder="选择 SSH 凭证" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="c in sshCreds" :key="c.id" :value="c.id">
                      {{ c.name }}（{{ c.id }}）
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="grid gap-1.5">
                <Label for="ssh-address">带内地址</Label>
                <Input id="ssh-address" v-model="sshAddress" placeholder="机器业务网 IP（与 BMC 带外网络无关）" class="font-mono" />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </template>

        <div class="grid gap-1.5">
          <Label for="machine-label">标签</Label>
          <Input id="machine-label" v-model="labelInput" placeholder="k=v，回车添加（如 env=prod）" @keyup.enter="addLabel" />
          <div v-if="labelChips.length > 0" class="flex flex-wrap gap-1.5">
            <span
              v-for="chip in labelChips"
              :key="chip"
              class="inline-flex items-center gap-1 rounded-md border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
            >
              {{ chip }}
              <button class="transition-opacity hover:opacity-70" @click="labelChips = labelChips.filter((c) => c !== chip)">
                <X class="size-3" />
              </button>
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="visible = false">取消</Button>
          <Button type="submit" :disabled="submitting">
            <LoaderCircle v-if="submitting" class="size-4 animate-spin" />
            {{ claimMac ? '认领' : '注册' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
