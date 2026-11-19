<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { LoaderCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useQueryClient } from '@tanstack/vue-query'
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
    toast.success('救援已受理', {
      description: jobId ? `救援任务 ${jobId} 已创建，引导约需几分钟，完成后 SSH 可达` : undefined,
      duration: 6000,
      action: jobId
        ? { label: '查看进度', onClick: () => router.push({ name: 'job-detail', params: { id: jobId } }) }
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
        <DialogTitle>救援模式（内存修复系统）</DialogTitle>
        <DialogDescription>
          机器将引导进内存救援系统（Alpine RAM OS）：不动盘、不跑安装步骤，sshd 随机启动。
          救援就绪后本任务即完成，机器留在救援系统里；排障完成后任意电源动作（重启）即回归原系统。
        </DialogDescription>
      </DialogHeader>
      <div class="grid gap-4">
        <div class="grid gap-1.5">
          <Label for="rescue-keys">SSH 公钥</Label>
          <Textarea
            id="rescue-keys"
            v-model="sshKeys"
            :rows="4"
            class="font-mono"
            placeholder="OpenSSH 公钥，每行一条（authorized_keys 格式）。留空 = 仅 console 救援（BMC KVM/SOL 访问）。"
          />
        </div>
        <div class="grid gap-1.5">
          <Label>引导载体</Label>
          <RadioGroup
            v-model="carrier"
            class="grid gap-2 [&_[data-slot=radio-group-item]]:flex [&_[data-slot=radio-group-item]]:items-start [&_[data-slot=radio-group-item]]:gap-2"
          >
            <Label class="flex cursor-pointer items-start gap-2 font-normal">
              <RadioGroupItem value="pxe" class="mt-0.5" />
              <span>PXE（无 BMC 机器唯一选项；vMedia 固件死路机型的逃生门）</span>
            </Label>
            <Label class="flex cursor-pointer items-start gap-2 font-normal">
              <RadioGroupItem value="virtual_media" class="mt-0.5" />
              <span>虚拟介质（有 BMC 时缺省）</span>
            </Label>
          </RadioGroup>
          <p class="text-xs leading-relaxed text-muted-foreground">
            预算 25 分钟（引导 + 池拉包 + sshd）；救援期间任务日志每 10 秒回传机器侧输出。
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="visible = false">取消</Button>
        <Button
          class="border-amber-500/40 bg-amber-500/90 text-white hover:bg-amber-500"
          :disabled="submitting"
          @click="submit"
        >
          <LoaderCircle v-if="submitting" class="size-4 animate-spin" /> 进入救援模式
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
