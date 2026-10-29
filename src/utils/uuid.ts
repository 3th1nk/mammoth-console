/**
 * UUID v4（幂等键等场景）。crypto.randomUUID 仅在安全上下文（https 或
 * localhost）暴露，控制台常经 http://<host> 直接部署访问——此时回退到
 * getRandomValues（非安全上下文仍可用）手工拼装 v4 位布局。
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
