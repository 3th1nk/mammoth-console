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
        const res = await fetch(req)
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
