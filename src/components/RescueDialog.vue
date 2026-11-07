<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElNotification } from 'element-plus'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import { uuid } from '@/utils/uuid'

/**
 * 救援模式向导(docs/07-bmc.md §6.5):机器引导进引擎的内存救援系统
 * (alpine RAM OS)——不动盘、不跑安装步骤;ssh_keys 注入 root 供网络
 * SSH,缺省 console-only(BMC KVM/SOL)。rescue-ready 报告即任务完成,
 * 机器留在救援系统里;任意重启(BMC 电源动作)回归原系统。
 */
const props = defineProps<{ machineId: string; modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const router = useRouter()

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
    ElNotification.success({
      title: '救援已受理',
      message: jobId ? `救援任务 ${jobId} 已创建，引导约需几分钟，完成后 SSH 可达` : '救援动作已受理',
      onClick: () => {
        if (jobId) router.push({ name: 'job-detail', params: { id: jobId } })
      },
      duration: 6000,
    })
    visible.value = false
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="救援模式（内存修复系统）" width="560px">
    <el-alert type="info" :closable="false" show-icon class="rescue-info">
      <p>机器将引导进内存救援系统（Alpine RAM OS）：不动盘、不跑安装步骤，sshd 随机启动。</p>
      <p>救援就绪后本任务即完成，机器留在救援系统里；排障完成后任意电源动作（重启）即回归原系统。</p>
    </el-alert>
    <el-form label-width="110px" label-position="left">
      <el-form-item label="SSH 公钥">
        <el-input
          v-model="sshKeys"
          type="textarea"
          :rows="4"
          placeholder="OpenSSH 公钥，每行一条（authorized_keys 格式）。留空 = 仅 console 救援（BMC KVM/SOL 访问）。"
        />
      </el-form-item>
      <el-form-item label="引导载体">
        <el-radio-group v-model="carrier">
          <el-radio value="pxe">PXE（无 BMC 机器唯一选项；vMedia 固件死路机型的逃生门）</el-radio>
          <el-radio value="virtual_media">虚拟介质（有 BMC 时缺省）</el-radio>
        </el-radio-group>
        <div class="rescue-hint">
          预算 25 分钟（引导 + 池拉包 + sshd）；救援期间任务日志每 10 秒回传机器侧输出。
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="warning" :loading="submitting" @click="submit">进入救援模式</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.rescue-info p {
  margin: 2px 0;
  line-height: 1.5;
}
.rescue-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  line-height: 1.5;
}
</style>
