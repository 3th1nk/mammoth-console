import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { components } from '@/api/types.gen'
import { resetClient } from '@/api/client'
import { ConsoleApiError } from '@/api/problem'

export type Capabilities = components['schemas']['Capabilities']

const LS_KEY = 'mammoth.console.connection'

interface SavedConnection {
  baseUrl: string
  token: string
}

/**
 * 连接状态：引擎地址 + 静态 Bearer token（引擎首版无用户体系，token 即
 * 管理员权限，见 docs/03-product-design.md §3.1）。capabilities 来自
 * GET /api/v1，是全站特性开关的事实源。
 */
export const useConnectionStore = defineStore('connection', () => {
  const saved = parseSaved()
  const baseUrl = ref(saved?.baseUrl ?? '')
  const token = ref(saved?.token ?? '')
  const capabilities = ref<Capabilities | null>(null)
  const unauthorized = ref(false)
  const connected = computed(() => capabilities.value !== null)

  /** 空地址 = 与控制台同源（dev 走 vite 代理，生产走 Caddy 反代）。 */
  function resolveBase(base: string): string {
    const trimmed = base.trim()
    return trimmed === '' ? window.location.origin : trimmed.replace(/\/+$/, '')
  }

  async function probe(base: string, bearer: string): Promise<Capabilities> {
    const url = `${resolveBase(base)}/api/v1`
    let res: Response
    try {
      res = await fetch(url, {
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      })
    } catch {
      throw new Error('无法连接引擎：请检查地址与网络（跨源直连会被浏览器 CORS 拦截，留空走同源或配置反代）')
    }
    if (!res.ok) {
      let problem: Partial<components['schemas']['Problem']> = {}
      try {
        problem = (await res.json()) as Partial<components['schemas']['Problem']>
      } catch {
        // 非 problem 响应（反代 502 等）——保持空对象
      }
      throw new ConsoleApiError(problem, res.status)
    }
    return (await res.json()) as Capabilities
  }

  /** 探测成功才落盘，避免把坏连接写进 localStorage。 */
  async function connect(base: string, bearer: string): Promise<Capabilities> {
    const caps = await probe(base, bearer)
    baseUrl.value = resolveBase(base) === window.location.origin ? '' : resolveBase(base)
    token.value = bearer
    capabilities.value = caps
    unauthorized.value = false
    localStorage.setItem(LS_KEY, JSON.stringify({ baseUrl: baseUrl.value, token: bearer } satisfies SavedConnection))
    resetClient()
    return caps
  }

  function disconnect() {
    capabilities.value = null
    unauthorized.value = false
    localStorage.removeItem(LS_KEY)
    resetClient()
  }

  function markUnauthorized() {
    unauthorized.value = true
  }

  // 刷新后 capabilities 不在 localStorage：有存量连接就静默重探一次，
  // 路由守卫在首次导航时 await 它——避免每次刷新都被踢回欢迎页。
  const hadSaved = saved !== null
  let rehydrated = false
  async function rehydrate(): Promise<void> {
    if (rehydrated || !hadSaved || capabilities.value) {
      rehydrated = true
      return
    }
    rehydrated = true
    try {
      await connect(baseUrl.value, token.value)
    } catch (e) {
      if (e instanceof ConsoleApiError && e.status === 401) {
        unauthorized.value = true
      }
      // 网络/同源问题：保持未连接，让守卫导向欢迎页
    }
  }

  return {
    baseUrl,
    token,
    capabilities,
    unauthorized,
    connected,
    rehydratedFlag: computed(() => rehydrated),
    probe,
    connect,
    disconnect,
    markUnauthorized,
    rehydrate,
  }
})

function parseSaved(): SavedConnection | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as SavedConnection
    return typeof v.baseUrl === 'string' && typeof v.token === 'string' ? v : null
  } catch {
    return null
  }
}
