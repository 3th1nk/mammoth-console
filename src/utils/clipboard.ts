// http 部署是非安全上下文：navigator.clipboard 为 undefined（HTTPS/localhost
// 才有），必须回落 document.execCommand('copy')，否则复制按钮直接 TypeError。
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 权限拒绝等 → 走 legacy 路径再试一次
    }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  return ok
}
