<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import EraseDrivesDialog from './EraseDrivesDialog.vue'
import BiosDialog from './BiosDialog.vue'
import { getClient } from '@/api/client'
import { errorMessage, unwrap } from '@/api/problem'
import type { components } from '@/api/types.gen'

/**
 * 机器动作入口。
 * flat 模式（表格行内）：高频电源动作平铺为小按钮，其余收进"更多"下拉；
 * 完整模式（详情页头部）：单个下拉承载全部动作。
 * 全部动作 202 + Job，受理后通知给出任务入口；高危两段式（BIOS/擦盘）
 * 与重装向导后续里程碑提供。
 */
const props = withDefaults(
  defineProps<{ machineId: string; powerState?: string; flat?: boolean }>(),
  { powerState: 'unknown', flat: false },
)
const emit = defineEmits<{ submitted: [] }>()
const router = useRouter()

type ActionRequest = components['schemas']['ActionRequest']

const submitting = ref(false)
const bootDialog = ref(false)
const bootDevice = ref<'pxe' | 'disk' | 'cdrom' | 'bios'>('pxe')
const bootOnce = ref(true)
const mediaDialog = ref(false)
const mediaUrl = ref('')
const ejectAfter = ref(false)
const eraseDialog = ref(false)
const biosDialog = ref(false)

const POWER_CONFIRM: Record<string, string> = {
  power_off: '硬关机不等操作系统落盘，可能丢失数据。确定执行？',
  soft_off: '向机器发送软关机指令？',
  hard_reboot: '硬重启立即断电再上电。确定执行？',
  cycle: '强制循环上电（硬关→开）。确定执行？',
  eject_media: '弹出该机器挂载的所有虚拟介质？',
}

async function submit(action: ActionRequest, confirmText?: string) {
  if (confirmText) {
    try {
      await ElMessageBox.confirm(confirmText, `操作 ${props.machineId}`, {
        type: 'warning',
        confirmButtonText: '执行',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  submitting.value = true
  try {
    const { data } = await getClient().POST('/api/v1/machines/{id}/actions', {
      params: {
        path: { id: props.machineId },
        header: { 'Idempotency-Key': crypto.randomUUID() },
      },
      body: action,
    })
    const jobId = (data as components['schemas']['Job'] | undefined)?.id
    ElNotification.success({
      title: '已受理',
      message: jobId ? `任务 ${jobId} 已创建，点击查看进度` : '动作已受理',
      onClick: () => {
        if (jobId) router.push({ name: 'job-detail', params: { id: jobId } })
      },
      duration: 6000,
    })
    emit('submitted')
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}

function onCommand(cmd: string) {
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
      return void submit({ type: 'soft_off' }, POWER_CONFIRM['soft_off'])
    case 'power_off':
      return void submit({ type: 'power_off' }, POWER_CONFIRM['power_off'])
    case 'hard_reboot':
      return void submit({ type: 'hard_reboot' }, POWER_CONFIRM['hard_reboot'])
    case 'cycle':
      return void submit({ type: 'cycle' }, POWER_CONFIRM['cycle'])
    case 'eject_media':
      return void submit({ type: 'eject_media' }, POWER_CONFIRM['eject_media'])
    case 'discover':
      return void submit({ type: 'discover', probe: 'auto' })
  }
}

// 注销 = DELETE /machines/{id}:删除登记与档案(任务/事件历史按引擎语义保留)。
// 列表与详情在 submitted 后各自刷新;详情页刷新后 404 由其自身的错误态呈现。
async function deregister() {
  try {
    await ElMessageBox.confirm(
      '注销将删除该机器的登记与硬件档案（任务与事件历史保留在作业里）。确定注销？',
      `注销机器 ${props.machineId}`,
      { type: 'warning', confirmButtonText: '注销', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  submitting.value = true
  try {
    await unwrap(
      await getClient().DELETE('/api/v1/machines/{id}', { params: { path: { id: props.machineId } } }),
    )
    ElMessage.success('机器已注销')
    emit('submitted')
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}

function powerToggle() {
  if (props.powerState === 'on') {
    return void submit({ type: 'soft_off' }, POWER_CONFIRM['soft_off'])
  }
  return void submit({ type: 'power_on' })
}

function submitBoot() {
  bootDialog.value = false
  void submit({ type: 'set_boot_device', device: bootDevice.value, once: bootOnce.value })
}

function submitMedia() {
  if (!mediaUrl.value.trim()) {
    ElMessage.warning('请填写镜像 URL（引擎可达，http:// 或 nfs://）')
    return
  }
  const url = mediaUrl.value.trim()
  mediaDialog.value = false
  mediaUrl.value = ''
  void submit({ type: 'mount_media', image_url: url, eject_after: ejectAfter.value })
}
</script>

<template>
  <span class="actions-wrap" :class="{ row: flat }" @click.stop>
    <!-- flat：行内高频电源 + 更多下拉 -->
    <template v-if="flat">
      <el-button
        size="small"
        :type="powerState === 'on' ? 'warning' : 'primary'"
        :plain="powerState === 'on'"
        :loading="submitting"
        @click="powerToggle"
      >
        {{ powerState === 'on' ? '关机' : '开机' }}
      </el-button>
      <el-dropdown trigger="click" @command="onCommand">
        <el-button size="small">
          更多<el-icon v-if="!submitting" class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="discover:auto">盘查（自动探针）</el-dropdown-item>
            <el-dropdown-item divided command="reboot">软重启</el-dropdown-item>
            <el-dropdown-item command="power_off">关机（硬）</el-dropdown-item>
            <el-dropdown-item command="hard_reboot">硬重启</el-dropdown-item>
            <el-dropdown-item command="cycle">强制循环上电</el-dropdown-item>
            <el-dropdown-item divided command="boot">设置启动设备…</el-dropdown-item>
            <el-dropdown-item command="media">挂载介质…</el-dropdown-item>
            <el-dropdown-item command="eject_media">弹出介质</el-dropdown-item>
            <el-dropdown-item divided command="bios">BIOS 属性…</el-dropdown-item>
            <el-dropdown-item command="erase">擦盘…</el-dropdown-item>
            <el-dropdown-item command="install">重装系统…</el-dropdown-item>
            <el-dropdown-item divided command="deregister" class="deregister-item">注销机器…</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>

    <!-- 完整：详情页头部单下拉 -->
    <el-dropdown v-else trigger="click" @command="onCommand">
      <el-button type="primary" plain :loading="submitting">
        操作<el-icon v-if="!submitting" class="el-icon--right"><ArrowDown /></el-icon>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="discover:auto">盘查（自动探针）</el-dropdown-item>
          <el-dropdown-item divided command="power_on">开机</el-dropdown-item>
          <el-dropdown-item command="reboot">软重启</el-dropdown-item>
          <el-dropdown-item command="soft_off">软关机</el-dropdown-item>
          <el-dropdown-item command="power_off">关机（硬）</el-dropdown-item>
          <el-dropdown-item command="hard_reboot">硬重启</el-dropdown-item>
          <el-dropdown-item command="cycle">强制循环上电</el-dropdown-item>
          <el-dropdown-item divided command="boot">设置启动设备…</el-dropdown-item>
          <el-dropdown-item command="media">挂载介质…</el-dropdown-item>
          <el-dropdown-item command="eject_media">弹出介质</el-dropdown-item>
          <el-dropdown-item divided command="bios">BIOS 属性…</el-dropdown-item>
          <el-dropdown-item command="erase">擦盘…</el-dropdown-item>
          <el-dropdown-item divided command="install">重装系统…</el-dropdown-item>
          <el-dropdown-item divided command="deregister" class="deregister-item">注销机器…</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </span>

  <el-dialog v-model="bootDialog" title="设置启动设备" width="460px" @click.stop>
    <el-form label-width="90px">
      <el-form-item label="设备">
        <el-radio-group v-model="bootDevice">
          <el-radio-button value="pxe">PXE</el-radio-button>
          <el-radio-button value="disk">磁盘</el-radio-button>
          <el-radio-button value="cdrom">虚拟介质</el-radio-button>
          <el-radio-button value="bios">进 BIOS</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="一次性">
        <el-switch v-model="bootOnce" />
        <span class="text-muted" style="margin-left: 8px; font-size: 12px">
          开启时仅下次生效，之后自动回落原启动序
        </span>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="bootDialog = false">取消</el-button>
      <el-button type="primary" @click="submitBoot">提交</el-button>
    </template>
  </el-dialog>

  <EraseDrivesDialog v-model="eraseDialog" :machine-id="machineId" />
  <BiosDialog v-model="biosDialog" :machine-id="machineId" />

  <el-dialog v-model="mediaDialog" title="挂载虚拟介质" width="500px" @click.stop>
    <el-form label-width="90px">
      <el-form-item label="镜像 URL">
        <el-input v-model="mediaUrl" placeholder="http://…/ubuntu-24.04.iso 或 nfs://…" class="mono" />
      </el-form-item>
      <el-form-item label="用后弹出">
        <el-switch v-model="ejectAfter" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="mediaDialog = false">取消</el-button>
      <el-button type="primary" @click="submitMedia">挂载</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* inline-flex：v-loading/遮罩类需要可定位容器，行内 span 会塌掉按钮高度 */
.actions-wrap {
  display: inline-flex;
  align-items: center;
}
.actions-wrap.row {
  gap: 6px;
}
</style>

<style scoped>
.deregister-item {
  color: var(--el-color-danger);
}
</style>
