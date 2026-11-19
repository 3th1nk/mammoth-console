/**
 * 命令式确认弹窗（全局 AlertDialog 封装）。
 *
 * ConfirmDialogHost 在 ConsoleLayout 挂载时注册处理器；业务侧
 * `await confirm({ title, description, destructive })` 返回 Promise<boolean>，
 * 调用形态与原生 confirm 一致。
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
