import type { components } from './types.gen'

export type Problem = components['schemas']['Problem']

/** 常见错误码的中文文案（完整注册表见 mammoth-console docs/02 §二）。 */
const CODE_MESSAGES: Record<string, string> = {
  BMC_UNREACHABLE: 'BMC 不可达：请检查带外地址与网络',
  BMC_AUTH_FAILED: 'BMC 认证失败：请检查凭证用户名与密码（不可自动重试）',
  BMC_UNSUPPORTED: 'BMC 不支持该操作（当前固件/厂商未实现）',
  BMC_PROTOCOL_ERROR: 'BMC 协议错误',
  CREDENTIAL_AUTH_FAILED: '凭证认证失败',
  NETWORK_UNREACHABLE: '网络不可达',
  LAYOUT_DRIFT: '分区快照已漂移：机器现场与快照不一致，请刷新盘查后重试',
  LAYOUT_DISK_NOT_FOUND: '指定的磁盘未找到（选择器未命中任何盘）',
  LAYOUT_SNAPSHOT_REQUIRED: '尚无分区快照：请先做分区级盘查（SSH 或内存盘探针）',
  SCHEMA_INVALID_STORAGE: '存储配置不合法',
  SCHEMA_FIRMWARE_MISMATCH: '固件不匹配：UEFI 专用介质不能派给 BIOS 机器',
  SCHEMA_UNKNOWN_CREDENTIAL: '引用的凭证不存在',
  INSTALL_TIMEOUT: '安装超时',
  INSTALL_NOT_REACHABLE: '安装器未按预期回调（网络或引导顺序问题）',
  MEDIA_MOUNT_FAILED: '虚拟介质挂载失败',
  MEDIA_BUILD_FAILED: '引导介质构建失败：镜像文件损坏或不是可引导 ISO，请检查镜像库中的文件',
  JOB_CONFLICT: '任务状态冲突',
  JOB_IDEMPOTENCY_CONFLICT: '幂等键与既有请求不一致',
  JOB_MACHINE_BUSY: '目标机器已有进行中的安装任务：请先取消旧任务再重试',
  BIOS_CONFIRM_REQUIRED: '缺少两段式确认（confirm），提交被拒绝',
  DRIVE_ERASE_CONFIRM_REQUIRED: '擦盘缺少两段式确认（confirm），提交被拒绝',
  RENDER_FAILED: '安装意图渲染失败：检查该发行版方言的能力边界',
}

/** 引擎 API 错误：携带 problem 细节，message 已译为可读文案。 */
export class ConsoleApiError extends Error {
  readonly code?: string
  readonly status: number
  readonly retryable?: boolean
  readonly detail?: string

  constructor(problem: Partial<Problem>, status: number) {
    const code = typeof problem.code === 'string' ? problem.code : undefined
    const detail = typeof problem.detail === 'string' ? problem.detail : undefined
    super(CODE_MESSAGES[code ?? ''] ?? detail ?? problem.title ?? `请求失败（${status}）`)
    this.name = 'ConsoleApiError'
    this.code = code
    this.status = status
    this.retryable = problem.retryable === true
    this.detail = detail
  }
}

type UnwrapResult<T> = { data?: T; error?: unknown; response: Response }

/** openapi-fetch 结果 → 数据或抛出 ConsoleApiError（204 之类无体的成功返回 undefined）。 */
export function unwrap<T>(result: UnwrapResult<T>): Promise<T> {
  if (result.error !== undefined && result.error !== null) {
    const raw = result.error as Partial<Problem>
    return Promise.reject(
      new ConsoleApiError(raw, result.response?.status ?? 0),
    )
  }
  return Promise.resolve(result.data as T)
}

/** 错误码 → 中文文案（错误卡片等场景直接查码）。 */
export function codeText(code?: string): string | undefined {
  return code ? CODE_MESSAGES[code] : undefined
}

/** 任意抛出物 → 展示文案（配合 ElMessage.error 使用）。 */
export function errorMessage(e: unknown): string {
  if (e instanceof ConsoleApiError) return e.message
  if (e instanceof TypeError) return '无法连接引擎：请检查地址与网络'
  if (e instanceof Error) return e.message
  return String(e)
}
