<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, LoaderCircle, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import SegmentedControl from '@/components/SegmentedControl.vue'

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

const { t } = useI18n()

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
  isHeadless.value ? t('pending.claimTipHeadless') : t('pending.claimTipBmc'),
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
    toast.warning(t('pending.labelFormatError'))
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
      toast.warning(t('pending.macRequired'))
      return
    }
    bmcAddressFinal = headlessAddress()
    credentialIdFinal = ''
  } else {
    if (!bmcAddressFinal) {
      toast.warning(t('pending.bmcRequired'))
      return
    }
    if (credMode.value === 'new' && (!credName.value.trim() || !credUser.value || !credPass.value)) {
      toast.warning(t('pending.credFieldsRequired'))
      return
    }
    if (credMode.value === 'existing' && !credentialIdFinal) {
      toast.warning(t('pending.credIdRequired'))
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
        ? t('pending.claimed', { id: machine.id })
        : t('pending.registered', { id: machine.id }),
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
        <DialogTitle>{{ claimMac ? t('pending.claimTitle', { mac: claimMac }) : t('pending.registerTitle') }}</DialogTitle>
        <DialogDescription v-if="!claimMac">{{ t('pending.registerSubtitle') }}</DialogDescription>
        <DialogDescription v-else>{{ t('pending.claimSubtitle') }}</DialogDescription>
      </DialogHeader>

      <Alert v-if="claimMac" class="border-blue-500/30 bg-blue-500/5">
        <AlertTitle>{{ claimTip }}</AlertTitle>
        <AlertDescription v-if="isHeadless" class="text-xs">{{ t('pending.claimTipFromSighting') }}</AlertDescription>
      </Alert>

      <form class="grid gap-4" @submit.prevent="submit">
        <div class="grid gap-1.5">
          <Label>{{ t('pending.protocol') }}</Label>
          <SegmentedControl
            v-model="protocol"
            :options="[
              { value: 'auto', label: t('pending.protocolAuto') },
              { value: 'redfish', label: t('pending.protocolRedfish') },
              { value: 'ipmi', label: t('pending.protocolIpmi') },
              { value: 'fake', label: t('pending.protocolFake') },
              { value: 'none', label: t('pending.protocolNone') },
            ]"
          />
        </div>

        <div v-if="isHeadless" class="grid gap-1.5">
          <Label for="headless-mac">{{ t('pending.macLabel') }}</Label>
          <Input id="headless-mac" v-model="headlessMac" :placeholder="t('pending.macPlaceholder')" class="font-mono" :disabled="!!claimMac" />
          <p class="text-xs leading-relaxed text-muted-foreground">{{ t('pending.macHint') }}</p>
        </div>
        <div v-else class="grid gap-1.5">
          <Label for="bmc-address">{{ t('pending.bmcLabel') }}</Label>
          <Input id="bmc-address" v-model="bmcAddress" :placeholder="t('pending.bmcPlaceholder')" class="font-mono" />
        </div>

        <template v-if="!isHeadless">
          <div class="grid gap-1.5">
            <Label>{{ t('pending.credModeLabel') }}</Label>
            <SegmentedControl
              v-model="credMode"
              :options="[
                { value: 'new', label: t('pending.credModeNew') },
                { value: 'existing', label: t('pending.credModeExisting') },
              ]"
            />
          </div>

          <div v-if="credMode === 'new'" class="grid gap-4">
            <div class="grid gap-1.5">
              <Label for="cred-name">{{ t('pending.credName') }}</Label>
              <Input id="cred-name" v-model="credName" :placeholder="t('pending.credNamePlaceholder')" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label for="cred-user">{{ t('pending.credUser') }}</Label>
                <Input id="cred-user" v-model="credUser" />
              </div>
              <div class="grid gap-1.5">
                <Label for="cred-pass">{{ t('pending.credPass') }}</Label>
                <Input id="cred-pass" v-model="credPass" type="password" />
              </div>
            </div>
            <p class="text-xs text-muted-foreground">{{ t('pending.credPassHint') }}</p>
          </div>
          <div v-else class="grid gap-1.5">
            <Label>{{ t('pending.selectCred') }}</Label>
            <Select v-model="credId">
              <SelectTrigger>
                <SelectValue :placeholder="t('pending.selectCredPlaceholder')" />
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
              {{ t('pending.sshCollapsible') }}
              <ChevronDown class="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent class="grid gap-4 pt-3">
              <div class="grid gap-1.5">
                <Label>{{ t('pending.sshCred') }}</Label>
                <Select v-model="sshCredId">
                  <SelectTrigger>
                    <SelectValue :placeholder="t('pending.sshCredPlaceholder')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="c in sshCreds" :key="c.id" :value="c.id">
                      {{ c.name }}（{{ c.id }}）
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="grid gap-1.5">
                <Label for="ssh-address">{{ t('pending.sshAddress') }}</Label>
                <Input id="ssh-address" v-model="sshAddress" :placeholder="t('pending.sshAddressPlaceholder')" class="font-mono" />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </template>

        <div class="grid gap-1.5">
          <Label for="machine-label">{{ t('pending.labels') }}</Label>
          <Input id="machine-label" v-model="labelInput" :placeholder="t('pending.labelsPlaceholder')" @keyup.enter="addLabel" />
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
          <Button type="button" variant="outline" @click="visible = false">{{ t('common.cancel') }}</Button>
          <Button type="submit" :disabled="submitting">
            <LoaderCircle v-if="submitting" class="size-4 animate-spin" />
            {{ claimMac ? t('pending.claimBtn') : t('pending.registerBtn') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
