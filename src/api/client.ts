import createClient from 'openapi-fetch'
import type { paths } from './types.gen'
import { useConnectionStore } from '@/stores/connection'

/**
 * 引擎 API 客户端（openapi-fetch，类型来自契约生成）。
 * baseUrl 在创建时取自连接 store——connect/disconnect 都会 resetClient()，
 * 所以换引擎/换 token 后自然重建。引擎错误一律 RFC 9457 problem+json，
 * 401 统一标记连接失效。
 */
export type ConsoleClient = ReturnType<typeof createClient<paths>>

// 无调用方 signal 的请求默认强制超时：fetch 对引擎 hang / 代理半开连接
// 永远 pending，useQuery 停在 isPending，页面无限骨架（卡 loading 的主因）。
// GET 是引擎本地快查询 30s 足够；写操作可能同步走 BMC（vMedia 挂载引擎
// 预算 90s）给 120s。唯二超预算的活读接口（machines/{id}/health|sel，
// console 已自带 60s 兜底）豁免，保留调用方的更宽预算。
const GET_TIMEOUT_MS = 30_000
const WRITE_TIMEOUT_MS = 120_000
const LIVE_READ_RE = /\/api\/v1\/machines\/[^/]+\/(health|sel)$/

let client: ConsoleClient | null = null

export function getClient(): ConsoleClient {
  if (!client) {
    const conn = useConnectionStore()
    client = createClient<paths>({
      baseUrl: conn.baseUrl,
      fetch: async (req: Request) => {
        if (conn.token) {
          req.headers.set('Authorization', `Bearer ${conn.token}`)
        }
        const limit = LIVE_READ_RE.test(new URL(req.url).pathname)
          ? undefined
          : AbortSignal.timeout(req.method === 'GET' ? GET_TIMEOUT_MS : WRITE_TIMEOUT_MS)
        // AbortSignal.any 组合调用方 signal：任一触发即中止；自带 signal 的
        // 请求（活读 60s、SSE 长流）语义不变。
        const res = await fetch(req, { signal: limit ? AbortSignal.any([req.signal, limit]) : req.signal })
        if (res.status === 401) {
          conn.markUnauthorized()
        }
        return res
      },
    })
  }
  return client
}

/** 换连接后丢弃旧客户端；下一次 getClient() 按新连接重建。 */
export function resetClient() {
  client = null
}
