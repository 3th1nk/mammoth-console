/**
 * 命令式确认弹窗（替代 Element Plus 的 ElMessageBox.confirm）。
 *
 * ConfirmDialogHost 在 ConsoleLayout 挂载时注册处理器；业务侧
 * `await confirm({ title, description, destructive })` 返回 Promise<boolean>，
 * 迁移 EP 调用点时只改 import 与弹窗参数，调用形态不变。
 */
export interface ConfirmOptions {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

type ConfirmHost = (opts: ConfirmOptions) => Promise<boolean>

let host: ConfirmHost | null = null

/** 由 ConfirmDialogHost 调用（仅 ConsoleLayout 一处）。 */
export function registerConfirmHost(fn: ConfirmHost): void {
  host = fn
}

/** 业务侧入口：resolve true = 用户确认。 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return host ? host(opts) : Promise.resolve(false)
}
