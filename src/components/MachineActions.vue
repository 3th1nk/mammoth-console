<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import EraseDrivesDialog from './EraseDrivesDialog.vue'
import BiosDialog from './BiosDialog.vue'
import RescueDialog from './RescueDialog.vue'
import { getClient } from '@/api/client'
import { errorMessage, unwrap } from '@/api/problem'
import type { components } from '@/api/types.gen'
import { uuid } from '@/utils/uuid'
import { markActionCommand } from '@/utils/actionNavGuard'
import { confirm } from '@/composables/confirm'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import SegmentedControl from '@/components/SegmentedControl.vue'

/**
 * 机器动作入口。
 * flat 模式（表格行内）：高频电源动作平铺为小按钮，其余收进"更多"下拉；
 * 完整模式（详情页头部）：单个下拉承载全部动作。
 * 全部动作 202 + Job，受理后 toast 给出任务入口；高危两段式（BIOS/擦盘）
 * 与重装向导后续里程碑提供。
 */
const props = withDefaults(
  defineProps<{ machineId: string; powerState?: string; flat?: boolean; bmc?: components['schemas']['BMC'] }>(),
  { powerState: 'unknown', flat: false },
)
const { t } = useI18n()
const emit = defineEmits<{ submitted: [] }>()
const router = useRouter()

type ActionRequest = components['schemas']['ActionRequest']

// 无带外机器(protocol=none,docs/13):引擎 HEADLESS_UNSUPPORTED 门只放行
// 盘查(带内 SSH)与 boot_rescue——带外动作组在菜单里整段隐藏
const headless = computed(() => props.bmc?.protocol === 'none')

const submitting = ref(false)
const bootDialog = ref(false)
const bootDevice = ref<'pxe' | 'disk' | 'cdrom' | 'bios'>('pxe')
const bootOnce = ref(true)
const mediaDialog = ref(false)
const mediaUrl = ref('')
const ejectAfter = ref(false)
const eraseDialog = ref(false)
const biosDialog = ref(false)
const rescueDialog = ref(false)
const decommissionBusy = ref(false)

const POWER_CONFIRM = computed<Record<string, string>>(() => ({
  power_off: t('actions.powerOffConfirm'),
  soft_off: t('actions.softOffConfirm'),
  hard_reboot: t('actions.hardRebootConfirm'),
  cycle: t('actions.cycleConfirm'),
  eject_media: t('actions.ejectConfirm'),
}))

function notifyAccepted(title: string, jobId?: string) {
  toast.success(title, {
    description: jobId ? t('actions.acceptedWithJob', { id: jobId }) : undefined,
    duration: 6000,
    action: jobId
      ? { label: t('actions.viewProgress'), onClick: () => router.push({ name: 'job-detail', params: { id: jobId } }) }
      : undefined,
  })
}

async function submit(action: ActionRequest, confirmText?: string) {
  if (confirmText) {
    const ok = await confirm({
      title: t('actions.confirmOpTitle', { id: props.machineId }),
      description: confirmText,
      confirmText: t('actions.exec'),
    })
    if (!ok) return
  }
  submitting.value = true
  try {
    const data = await unwrap(await getClient().POST('/api/v1/machines/{id}/actions', {
      params: {
        path: { id: props.machineId },
        header: { 'Idempotency-Key': uuid() },
      },
      body: action,
    }))
    const jobId = (data as components['schemas']['Job'] | undefined)?.id
    notifyAccepted(t('actions.title'), jobId)
    emit('submitted')
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}

function onCommand(cmd: string) {
  // 打点供整行可点的列表页抑制紧随其后的落穿点击（见 actionNavGuard）。
  markActionCommand()
  if (cmd === 'boot') {
    bootDialog.value = true
    return
  }
  if (cmd === 'media') {
    mediaDialog.value = true
    return
  }
  if (cmd === 'erase') {
    eraseDialog.value = true
    return
  }
  if (cmd === 'bios') {
    biosDialog.value = true
    return
  }
  if (cmd === 'rescue') {
    rescueDialog.value = true
    return
  }
  if (cmd === 'decommission') {
    return void decommission()
  }
  if (cmd === 'install') {
    router.push({ name: 'install-wizard', query: { machines: props.machineId } })
    return
  }
  if (cmd === 'deregister') {
    return void deregister()
  }
  const [type] = cmd.split(':')
  switch (type) {
    case 'power_on':
      return void submit({ type: 'power_on' })
    case 'reboot':
      return void submit({ type: 'reboot' })
    case 'soft_off':
      return void submit({ type: 'soft_off' }, POWER_CONFIRM.value['soft_off'])
    case 'power_off':
      return void submit({ type: 'power_off' }, POWER_CONFIRM.value['power_off'])
    case 'hard_reboot':
      return void submit({ type: 'hard_reboot' }, POWER_CONFIRM.value['hard_reboot'])
    case 'cycle':
      return void submit({ type: 'cycle' }, POWER_CONFIRM.value['cycle'])
    case 'eject_media':
      return void submit({ type: 'eject_media' }, POWER_CONFIRM.value['eject_media'])
    case 'discover':
      // headless 机器引擎只放行带内 SSH 探针(docs/13),无带外可 auto
      if (headless.value) {
        return void submit({ type: 'discover', probe: 'inband_ssh', confirm: false })
      }
      // confirm 门禁仅 ramdisk 接管探针需要
      return void submit({ type: 'discover', probe: 'auto', confirm: false })
  }
}

// 退役 = 全盘 NIST 800-88 擦除 + 证据落档 + retired 终态(docs/07-bmc.md
// §6.6):confirm 是唯一门禁,擦盘不可回滚。机器进入 retired 后对
// 装机/救援/退役一律 422,复投 = 重新盘查。
async function decommission() {
  const ok = await confirm({
    title: t('actions.decommissionTitle', { id: props.machineId }),
    description: t('actions.decommissionConfirm'),
    confirmText: t('actions.decommissionConfirmText'),
    destructive: true,
  })
  if (!ok) return
  decommissionBusy.value = true
  try {
    const data = await unwrap(await getClient().POST('/api/v1/jobs', {
      header: { 'Idempotency-Key': uuid() },
      body: {
        type: 'decommission',
        targets: { targets: [{ machine_id: props.machineId }] },
        confirm: true,
      } as never,
    }))
    const jobId = (data as components['schemas']['Job'] | undefined)?.id
    notifyAccepted(t('actions.decommissionAccepted'), jobId)
    emit('submitted')
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    decommissionBusy.value = false
  }
}

// 注销 = DELETE /machines/{id}:删除登记与档案(任务/事件历史按引擎语义保留),
// 与「注册」互为反义。列表与详情在 submitted 后各自刷新;详情页刷新后
// 404 由其自身的错误态呈现。
async function deregister() {
  const ok = await confirm({
    title: t('actions.deregisterTitle', { id: props.machineId }),
    description: t('actions.deregisterConfirm'),
    confirmText: t('actions.deregisterConfirmText'),
    destructive: true,
  })
  if (!ok) return
  submitting.value = true
  try {
    await unwrap(
      await getClient().DELETE('/api/v1/machines/{id}', { params: { path: { id: props.machineId } } }),
    )
    toast.success(t('actions.deregistered'))
    emit('submitted')
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}

function powerToggle() {
  if (props.powerState === 'on') {
    return void submit({ type: 'soft_off' }, POWER_CONFIRM.value['soft_off'])
  }
  return void submit({ type: 'power_on' })
}

function submitBoot() {
  bootDialog.value = false
  void submit({ type: 'set_boot_device', device: bootDevice.value, once: bootOnce.value })
}

function submitMedia() {
  if (!mediaUrl.value.trim()) {
    toast.warning(t('actions.mediaUrlRequired'))
    return
  }
  const url = mediaUrl.value.trim()
  mediaDialog.value = false
  mediaUrl.value = ''
  void submit({ type: 'mount_media', image_url: url, eject_after: ejectAfter.value })
}
</script>

<template>
  <span class="inline-flex items-center" :class="flat ? 'gap-1.5' : ''" @click.stop>
    <!-- flat：行内高频电源 + 更多下拉。headless(protocol=none) 机器无带外,
         引擎 HEADLESS_UNSUPPORTED 门只放行盘查(带内 SSH)/救援——带外动作整组隐藏 -->
    <template v-if="flat">
      <Button
        v-if="!headless"
        variant="outline"
        size="sm"
        class="h-8"
        :class="powerState === 'on' ? 'border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400' : ''"
        :disabled="submitting"
        @click="powerToggle"
      >
        {{ powerState === 'on' ? t('actions.powerOff') : t('actions.powerOn') }}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm" class="h-8" :disabled="submitting">
            {{ t('actions.more') }}<ChevronDown class="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-44">
          <DropdownMenuItem @click="onCommand('discover:auto')">
            {{ headless ? t('actions.discoverInband') : t('actions.discoverAuto') }}
          </DropdownMenuItem>
          <template v-if="!headless">
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="onCommand('power_off')">{{ t('actions.hardOff') }}</DropdownMenuItem>
            <DropdownMenuItem @click="onCommand('reboot')">{{ t('actions.softReboot') }}</DropdownMenuItem>
            <DropdownMenuItem @click="onCommand('hard_reboot')">{{ t('actions.hardReboot') }}</DropdownMenuItem>
            <DropdownMenuItem @click="onCommand('cycle')">{{ t('actions.cycle') }}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="onCommand('boot')">{{ t('actions.setBoot') }}</DropdownMenuItem>
            <DropdownMenuItem @click="onCommand('media')">{{ t('actions.mountMedia') }}</DropdownMenuItem>
            <DropdownMenuItem @click="onCommand('eject_media')">{{ t('actions.ejectMedia') }}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="onCommand('bios')">{{ t('actions.biosAttrs') }}</DropdownMenuItem>
            <DropdownMenuItem @click="onCommand('erase')">{{ t('actions.erase') }}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="onCommand('decommission')">{{ t('actions.decommission') }}</DropdownMenuItem>
          </template>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="onCommand('rescue')">{{ t('actions.rescue') }}</DropdownMenuItem>
          <DropdownMenuItem @click="onCommand('install')">{{ t('actions.reinstall') }}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive" @click="onCommand('deregister')">
            {{ t('actions.deregister') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>

    <!-- 完整：详情页头部单下拉。headless 同 flat 口径:带外动作整组隐藏 -->
    <DropdownMenu v-else>
      <DropdownMenuTrigger as-child>
        <Button variant="outline" :disabled="submitting">
          操作<ChevronDown class="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-44">
        <DropdownMenuItem @click="onCommand('discover:auto')">
          {{ headless ? t('actions.discoverInband') : t('actions.discoverAuto') }}
        </DropdownMenuItem>
        <template v-if="!headless">
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="onCommand('power_on')">{{ t('actions.powerOn') }}</DropdownMenuItem>
          <DropdownMenuItem @click="onCommand('soft_off')">{{ t('actions.softOff') }}</DropdownMenuItem>
          <DropdownMenuItem @click="onCommand('power_off')">{{ t('actions.hardOff') }}</DropdownMenuItem>
          <DropdownMenuItem @click="onCommand('reboot')">{{ t('actions.softReboot') }}</DropdownMenuItem>
          <DropdownMenuItem @click="onCommand('hard_reboot')">{{ t('actions.hardReboot') }}</DropdownMenuItem>
          <DropdownMenuItem @click="onCommand('cycle')">{{ t('actions.cycle') }}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="onCommand('boot')">{{ t('actions.setBoot') }}</DropdownMenuItem>
          <DropdownMenuItem @click="onCommand('media')">{{ t('actions.mountMedia') }}</DropdownMenuItem>
          <DropdownMenuItem @click="onCommand('eject_media')">{{ t('actions.ejectMedia') }}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="onCommand('bios')">{{ t('actions.biosAttrs') }}</DropdownMenuItem>
          <DropdownMenuItem @click="onCommand('erase')">{{ t('actions.erase') }}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="onCommand('decommission')">{{ t('actions.decommission') }}</DropdownMenuItem>
        </template>
        <DropdownMenuSeparator />
        <DropdownMenuItem @click="onCommand('rescue')">{{ t('actions.rescue') }}</DropdownMenuItem>
        <DropdownMenuItem @click="onCommand('install')">{{ t('actions.reinstall') }}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem class="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive" @click="onCommand('deregister')">
          {{ t('actions.deregister') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Dialog :open="bootDialog" @update:open="(v: boolean) => (bootDialog = v)">
      <DialogContent class="sm:max-w-[460px]" @click.stop>
        <DialogHeader>
          <DialogTitle>{{ t('actions.bootTitle') }}</DialogTitle>
          <DialogDescription>{{ t('actions.bootDesc') }}</DialogDescription>
        </DialogHeader>
        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <Label>{{ t('actions.device') }}</Label>
            <SegmentedControl
              v-model="bootDevice"
              :options="[
                { value: 'pxe', label: t('actions.devPxe') },
                { value: 'disk', label: t('actions.devDisk') },
                { value: 'cdrom', label: t('actions.devCdrom') },
                { value: 'bios', label: t('actions.devBios') },
              ]"
            />
          </div>
          <div class="flex items-center gap-3">
            <Switch id="boot-once" v-model:checked="bootOnce" />
            <Label for="boot-once" class="font-normal text-muted-foreground">
              {{ t('actions.once') }}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="bootDialog = false">{{ t('common.cancel') }}</Button>
          <Button @click="submitBoot">{{ t('common.submit') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <EraseDrivesDialog v-model="eraseDialog" :machine-id="machineId" />
    <BiosDialog v-model="biosDialog" :machine-id="machineId" />
    <RescueDialog v-model="rescueDialog" :machine-id="machineId" />

    <Dialog :open="mediaDialog" @update:open="(v: boolean) => (mediaDialog = v)">
      <DialogContent class="sm:max-w-[500px]" @click.stop>
        <DialogHeader>
          <DialogTitle>{{ t('actions.mediaTitle') }}</DialogTitle>
          <DialogDescription>{{ t('actions.mediaDesc') }}</DialogDescription>
        </DialogHeader>
        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <Label for="media-url">{{ t('actions.mediaUrl') }}</Label>
            <Input
              id="media-url"
              v-model="mediaUrl"
              :placeholder="t('actions.mediaUrlPlaceholder')"
              class="font-mono"
            />
          </div>
          <div class="flex items-center gap-3">
            <Switch id="eject-after" v-model:checked="ejectAfter" />
            <Label for="eject-after" class="font-normal">{{ t('actions.ejectAfter') }}</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="mediaDialog = false">{{ t('common.cancel') }}</Button>
          <Button @click="submitMedia">{{ t('actions.mount') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </span>
</template>
