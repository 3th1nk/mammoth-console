/**
 * 行内「更多」菜单的动作命令打点：菜单关闭的瞬间，浏览器会把落在原菜单
 * 位置的后续点击派发到底下的元素——整行可点进详情的列表页会因此误触发行
 * 点击跳详情。命令分发时打点，行点击（row-click）处理里检查即可抑制。
 */
let lastCommandAt = 0

export function markActionCommand() {
  lastCommandAt = Date.now()
}

export function actionCommandRecent(ms = 500): boolean {
  return Date.now() - lastCommandAt < ms
}
