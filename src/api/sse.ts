/**
 * 轻量 SSE 客户端：原生 EventSource 不能带 Authorization 头，引擎又是
 * Bearer 认证，所以用 fetch + ReadableStream 自解析 text/event-stream。
 * 断线自动重连（3s，与引擎 retry 帧一致），携带 Last-Event-ID 续传。
 */
export interface SseMessage {
  id?: string
  event: string
  data: string
}

export interface SseHandle {
  close(): void
}

export function subscribeSse(opts: {
  url: string
  token?: string
  lastEventId?: string
  onMessage: (msg: SseMessage) => void
  onError?: (e: unknown) => void
  onDone?: () => void
}): SseHandle {
  const controller = new AbortController()
  void (async () => {
    let lastId = opts.lastEventId
    while (!controller.signal.aborted) {
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' }
        if (opts.token) headers.Authorization = `Bearer ${opts.token}`
        if (lastId) headers['Last-Event-ID'] = lastId
        const res = await fetch(opts.url, { headers, signal: controller.signal })
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let sep: number
          while ((sep = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, sep)
            buf = buf.slice(sep + 2)
            let id: string | undefined
            let event = 'message'
            const dataLines: string[] = []
            for (const line of chunk.split('\n')) {
              if (line.startsWith(':')) continue // keepalive 注释帧
              if (line.startsWith('id:')) id = line.slice(3).trim()
              else if (line.startsWith('event:')) event = line.slice(6).trim()
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
            }
            if (id) lastId = id
            opts.onMessage({ id, event, data: dataLines.join('\n') })
          }
        }
        // 服务端正常收流（eos 后关闭）：仅对一次性流有意义
        opts.onDone?.()
        return
      } catch (e) {
        if (controller.signal.aborted) return
        opts.onError?.(e)
      }
      if (controller.signal.aborted) return
      await new Promise((r) => setTimeout(r, 3000))
    }
  })()
  return { close: () => controller.abort() }
}
