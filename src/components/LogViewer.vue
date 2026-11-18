<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useConnectionStore } from '@/stores/connection'
import { subscribeSse, type SseHandle } from '@/api/sse'
import { getClient } from '@/api/client'
import { unwrap } from '@/api/problem'

/**
 * 任务日志查看器：打开先取末尾 200 行渲染（logs order=desc），SSE 携带
 * Last-Event-ID 从末条续流——打开即有内容，不再从第一条全量回放（安装
 * 日志经 syslog 灌入整个安装环境 journal，几万行；旧实现 200 行/s 回放
 * 要滚数分钟，刷新/重开必经）。desc 引导不可用（旧引擎忽略 order，按
 * id 升序识别）时回退旧的从头回放语义。向上滚自动暂停跟随、触顶按 desc
 * 游标加载更早；回到底部自动恢复跟随。仅会话内保留，最多 2000 行
 * （加载更早可临时超出，由后续 push 的窗口裁剪收敛）。
 */
const props = defineProps<{ jobId: string; taskId: string }>()

interface LogLine {
  id: number
  level: string
  stage?: string
  message: string
  attrs?: Record<string, unknown>
  ts: string
}

const PAGE = 200
const BUFFER_MAX = 2000
const EDGE = 40 // 距底/距顶多少像素算"贴边"（跟随判定 / 加载更早触发）

const conn = useConnectionStore()
const logs = ref<LogLine[]>([])
const ended = ref(false)
const following = ref(true)
const levelFilter = ref<string>('ALL')
const container = ref<HTMLDivElement>()

let handle: SseHandle | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let lastId = 0
let hasOlder = false
let loadingOlder = false
let epoch = 0 // 任务切换守卫：慢的 desc 引导回来时任务可能已换

const LEVEL_COLOR: Record<string, string> = {
  DEBUG: '#909399',
  INFO: '#409eff',
  WARN: '#e6a23c',
  ERROR: '#f56c6c',
}

const visible = computed(() =>
  levelFilter.value === 'ALL' ? logs.value : logs.value.filter((l) => l.level === levelFilter.value),
)

function push(l: LogLine) {
  logs.value.push(l)
  if (logs.value.length > BUFFER_MAX) logs.value.splice(0, logs.value.length - BUFFER_MAX)
  if (l.id > lastId) lastId = l.id
}

function parseLog(data: string): LogLine | null {
  try {
    const raw = JSON.parse(data) as LogLine
    return { ...raw, id: Number(raw.id) }
  } catch {
    return null
  }
}

/** 尾部引导：末页（新→旧）反转成写序进缓冲，返回是否可据此续流。
 * 旧引擎不认识 order 参数时会静默按 asc 返回首页——id 严格递增识别出
 * 来，丢弃并回退全量回放（也顺带保证新引擎下顺序契约被破坏时不出错）。 */
async function bootstrapTail(jobId: string, taskId: string): Promise<boolean> {
  try {
    const page = await unwrap(
      await getClient().GET('/api/v1/jobs/{id}/tasks/{taskId}/logs', {
        params: {
          path: { id: jobId, taskId },
          query: { order: 'desc', page_size: PAGE },
        },
      }),
    )
    const items = [...(page.items ?? [])]
    if (items.length === 0) return true // 空任务：无可引导，直接开流
    let descending = true
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]
      const cur = items[i]
      if (prev && cur && cur.id >= prev.id) {
        descending = false
        break
      }
    }
    if (!descending) return false
    hasOlder = items.length === PAGE // 不满一页即已到最早
    for (const l of items.reverse()) push(l as LogLine)
    return true
  } catch {
    return false
  }
}

/** 触顶加载更早：desc 游标续翻，顶部插入后补回 scrollHeight 增量，
 * 视点不跳。满页才认为还有更早（恰好整页边界多试一次空查询，可忽略）。 */
async function loadOlder() {
  const first = logs.value[0]
  if (!hasOlder || loadingOlder || !first) return
  loadingOlder = true
  try {
    const page = await unwrap(
      await getClient().GET('/api/v1/jobs/{id}/tasks/{taskId}/logs', {
        params: {
          path: { id: props.jobId, taskId: props.taskId },
          query: { order: 'desc', cursor: String(first.id), page_size: PAGE },
        },
      }),
    )
    const items = page.items ?? []
    if (items.length < PAGE) hasOlder = false
    if (items.length > 0) {
      const el = container.value
      const before = el ? el.scrollHeight : 0
      const older = [...items].reverse() as LogLine[]
      logs.value.splice(0, 0, ...older)
      if (el) {
        await nextTick()
        el.scrollTop += el.scrollHeight - before
      }
    }
  } catch {
    // 静默：下个触顶事件再试
  } finally {
    loadingOlder = false
  }
}

function onScroll() {
  const el = container.value
  if (!el) return
  const toBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  following.value = toBottom <= EDGE
  if (el.scrollTop <= EDGE) void loadOlder()
}

async function jumpToBottom() {
  following.value = true
  await nextTick()
  const el = container.value
  if (el) el.scrollTop = el.scrollHeight
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    try {
      const page = await unwrap(
        await getClient().GET('/api/v1/jobs/{id}/tasks/{taskId}/logs', {
          params: {
            path: { id: props.jobId, taskId: props.taskId },
            query: { cursor: lastId > 0 ? String(lastId) : undefined, page_size: 200 },
          },
        }),
      )
      for (const l of page.items ?? []) push(l as LogLine)
      if (page.next_cursor == null && page.items?.length === 0) {
        // 到尾了：任务终态判断交给 eos；轮询下用任务状态兜底
      }
    } catch {
      // 轮询失败静默，下轮再试
    }
  }, 2000)
}

function startStream(resumeId: number) {
  handle = subscribeSse({
    url: `/api/v1/jobs/${props.jobId}/tasks/${props.taskId}/logs/stream`,
    token: conn.token,
    lastEventId: resumeId > 0 ? String(resumeId) : undefined,
    onMessage: (msg) => {
      if (msg.event === 'eos') {
        ended.value = true
        handle?.close()
        return
      }
      if (msg.event === 'log') {
        const l = parseLog(msg.data)
        if (l) push(l)
      }
    },
    onError: () => {
      // 首次错误即降级轮询（代理不支持 SSE / 网络异常）
      handle?.close()
      handle = null
      startPolling()
    },
  })
}

watch(
  () => [props.jobId, props.taskId],
  async () => {
    const my = ++epoch
    const { jobId, taskId } = props
    logs.value = []
    lastId = 0
    ended.value = false
    following.value = true
    hasOlder = false
    loadingOlder = false
    handle?.close()
    handle = null
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    // 尾部引导成功 → SSE 从末条续流（零回放）；失败 → 旧的从头回放
    const bootstrapped = await bootstrapTail(jobId, taskId)
    if (my !== epoch) return // 引导期间任务已切换，本轮作废
    startStream(bootstrapped ? lastId : 0)
  },
  { immediate: true },
)

watch(
  () => logs.value.length,
  async () => {
    if (!following.value) return
    await nextTick()
    const el = container.value
    if (el) el.scrollTop = el.scrollHeight
  },
)

onUnmounted(() => {
  handle?.close()
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="log-viewer">
    <div class="toolbar">
      <el-radio-group v-model="levelFilter" size="small">
        <el-radio-button value="ALL">全部</el-radio-button>
        <el-radio-button v-for="lv in ['DEBUG', 'INFO', 'WARN', 'ERROR']" :key="lv" :value="lv">
          {{ lv }}
        </el-radio-button>
      </el-radio-group>
      <el-checkbox v-model="following" size="small">跟随尾部</el-checkbox>
      <el-tag v-if="!hasOlder && logs.length > 0" type="info" size="small">已到最早</el-tag>
      <el-tag v-if="ended" type="info" size="small">任务已终态，日志收流完毕</el-tag>
      <el-button v-if="!following && !ended" size="small" text type="primary" @click="jumpToBottom">
        回到底部 ↓
      </el-button>
    </div>
    <div ref="container" class="lines mono" @scroll="onScroll">
      <div v-for="l in visible" :key="l.id" class="line">
        <span class="ts">{{ l.ts.slice(11, 19) }}</span>
        <span class="lv" :style="{ color: LEVEL_COLOR[l.level] ?? '#909399' }">{{ l.level.padEnd(5) }}</span>
        <span v-if="l.stage" class="stage">[{{ l.stage }}]</span>
        <span class="msg">{{ l.message }}</span>
        <span v-if="l.attrs && Object.keys(l.attrs).length" class="attrs">{{ JSON.stringify(l.attrs) }}</span>
      </div>
      <div v-if="visible.length === 0" class="empty">暂无日志{{ ended ? '' : '，等待输出…' }}</div>
    </div>
  </div>
</template>

<style scoped>
.log-viewer {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-bottom: 1px solid #ebeef5;
  background: #fafafa;
}
.lines {
  height: 360px;
  overflow: auto;
  padding: 8px 10px;
  background: #1e1e1e;
  font-size: 12px;
  line-height: 1.7;
}
.line {
  white-space: pre-wrap;
  word-break: break-all;
  color: #d4d4d4;
}
.ts {
  color: #6a9955;
  margin-right: 8px;
}
.lv {
  margin-right: 8px;
}
.stage {
  color: #ce9178;
  margin-right: 8px;
}
.attrs {
  color: #808080;
  margin-left: 8px;
}
.empty {
  color: #808080;
}
</style>
