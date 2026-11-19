<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { LoaderCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { machineDomain, jobDomain } from '@/api/queryKeys'
import type { components } from '@/api/types.gen'
import { uuid } from '@/utils/uuid'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'

/**
 * 救援模式向导(docs/07-bmc.md §6.5):机器引导进引擎的内存救援系统
 * (alpine RAM OS)——不动盘、不跑安装步骤;ssh_keys 注入 root 供网络
 * SSH,缺省 console-only(BMC KVM/SOL)。rescue-ready 报告即任务完成,
 * 机器留在救援系统里;任意重启(BMC 电源动作)回归原系统。
 */
const props = defineProps<{ machineId: string; modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { t } = useI18n()
const router = useRouter()
const qc = useQueryClient()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const sshKeys = ref('')
const carrier = ref<'pxe' | 'virtual_media'>('pxe')
const submitting = ref(false)

async function submit() {
  const keys = sshKeys.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  submitting.value = true
  try {
    const body: Record<string, unknown> = { type: 'boot_rescue', boot: carrier.value }
    if (keys.length > 0) body.ssh_keys = keys
    const data = await unwrap(await getClient().POST('/api/v1/machines/{id}/actions', {
      params: {
        path: { id: props.machineId },
        header: { 'Idempotency-Key': uuid() },
      },
      body: body as never,
    }))
    const jobId = (data as components['schemas']['Job'] | undefined)?.id
    // 异步 job 受理后机器视角与任务列表都会变,即时失效
    void qc.invalidateQueries({ queryKey: machineDomain })
    void qc.invalidateQueries({ queryKey: jobDomain })
    toast.success(t('rescue.accepted'), {
      description: jobId ? t('rescue.acceptedDesc', { id: jobId }) : undefined,
      duration: 6000,
      action: jobId
        ? { label: t('actions.viewProgress'), onClick: () => router.push({ name: 'job-detail', params: { id: jobId } }) }
        : undefined,
    })
    visible.value = false
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="visible">
    <DialogContent class="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>{{ t('rescue.title') }}</DialogTitle>
        <DialogDescription>{{ t('rescue.desc') }}</DialogDescription>
      </DialogHeader>
      <div class="grid gap-4">
        <div class="grid gap-1.5">
          <Label for="rescue-keys">{{ t('rescue.sshKeys') }}</Label>
          <Textarea
            id="rescue-keys"
            v-model="sshKeys"
            :rows="4"
            class="font-mono"
            :placeholder="t('rescue.sshKeysPlaceholder')"
          />
        </div>
        <div class="grid gap-1.5">
          <Label>{{ t('rescue.carrier') }}</Label>
          <RadioGroup
            v-model="carrier"
            class="grid gap-2 [&_[data-slot=radio-group-item]]:flex [&_[data-slot=radio-group-item]]:items-start [&_[data-slot=radio-group-item]]:gap-2"
          >
            <Label class="flex cursor-pointer items-start gap-2 font-normal">
              <RadioGroupItem value="pxe" class="mt-0.5" />
              <span>{{ t('rescue.pxe') }}</span>
            </Label>
            <Label class="flex cursor-pointer items-start gap-2 font-normal">
              <RadioGroupItem value="virtual_media" class="mt-0.5" />
              <span>{{ t('rescue.vmedia') }}</span>
            </Label>
          </RadioGroup>
          <p class="text-xs leading-relaxed text-muted-foreground">{{ t('rescue.budget') }}</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="visible = false">{{ t('common.cancel') }}</Button>
        <Button
          class="border-amber-500/40 bg-amber-500/90 text-white hover:bg-amber-500"
          :disabled="submitting"
          @click="submit"
        >
          <LoaderCircle v-if="submitting" class="size-4 animate-spin" /> {{ t('rescue.enter') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
