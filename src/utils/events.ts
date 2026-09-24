/**
 * 事件类型与资源类型的中文呈现。
 *
 * 事件类型清单来自引擎实现(各 repo 的 Events.Append 发射点);引擎按
 * additive 演进持续增加类型,映射 miss 一律回落英文原文显示——中文名是
 * 助读,英文原文才是排障时与日志/契约对照的权威形态(表格里以小字并排)。
 */

export const RESOURCE_TYPE_LABEL: Record<string, string> = {
  job: '任务作业',
  task: '机器任务',
  machine: '机器',
  credential: '凭证',
  pending: '待认领',
  webhook: 'Webhook',
  image: '镜像',
}

export const EVENT_TYPE_LABEL: Record<string, string> = {
  // machine
  'machine.created': '机器注册',
  'machine.deleted': '机器注销',
  'machine.claimed': '待认领机器已认领',
  'machine.discovered': '盘查完成',
  'machine.layout_captured': '布局快照落库',
  'machine.probe_reported': '探针报告上报',
  'machine.labelled': '机器打标签',
  // credential
  'credential.created': '凭证创建',
  'credential.deleted': '凭证删除',
  // job
  'job.created': '作业创建',
  'job.cancel_requested': '作业取消请求',
  // task
  'task.stage_changed': '阶段推进',
  'task.state_changed': '任务状态变更',
  'task.root_password': 'root 密码产生',
  'task.drive_erase': '擦盘完成',
  'task.bios_attributes': 'BIOS 属性下发',
  'task.verify_ready_degraded': '装后核验降级',
  'task.retry_requested': '任务重试请求',
  'task.interrupted': '任务中断',
  'task.answer_fetched': '应答文件拉取',
  'task.install_applied': '镜像应用完成',
  'task.install_reported': '装机完成上报',
  'task.netboot_registered': 'PXE 引导项注册',
  'task.netboot_released': 'PXE 引导项释放',
  'task.netboot_grub_served': 'GRUB 配置下发',
  'task.netboot_script_served': 'iPXE 脚本下发',
  'task.bcdboot_armed': 'BCD 预烤武装',
  'task.bcdboot_done': 'BCD 预烤完成',
  // pending
  'pending.sighted': '零注册机器首见',
  'pending.reported': '零注册探针上报',
  'pending.enroll_served': 'enroll 引导下发',
  // webhook
  'webhook.created': 'Webhook 创建',
  'webhook.deleted': 'Webhook 删除',
  // image
  'image.ready': '镜像就绪',
  'image.failed': '镜像拉取失败',
}

/** 中文显示名;未映射类型回落原文(additive 兼容)。 */
export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABEL[type] ?? type
}

export function resourceTypeLabel(rt: string): string {
  return RESOURCE_TYPE_LABEL[rt] ?? rt
}

/** 按资源类型分组的事件类型下拉选项(label=中文名,value=类型原文)。 */
export const EVENT_TYPE_GROUPS: { label: string; types: { value: string; label: string }[] }[] =
  Object.entries(
    Object.keys(EVENT_TYPE_LABEL).reduce<Record<string, string[]>>((acc, type) => {
      const rt = type.split('.')[0] ?? type
      ;(acc[rt] ??= []).push(type)
      return acc
    }, {}),
  )
    .map(([rt, types]) => ({
      label: resourceTypeLabel(rt),
      types: types
        .sort()
        .map((t) => ({ value: t, label: eventTypeLabel(t) })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
