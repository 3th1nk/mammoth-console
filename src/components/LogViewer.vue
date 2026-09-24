<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useConnectionStore } from '@/stores/connection'
import { subscribeSse, type SseHandle } from '@/api/sse'
import { getClient } from '@/api/client'
import { unwrap } from '@/api/problem'

/**
 * 任务日志查看器：优先走引擎的 logs SSE（回放 + 尾随 + 终态 eos 收流，
 * docs/04-engine-api-enhancements.md A4）；SSE 不可用时降级 2s cursor 轮询。
 * 仅会话内保留，最多 2000 行。
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

const conn = useConnectionStore()
const logs = ref<LogLine[]>([])
const ended = ref(false)
const following = ref(true)
const levelFilter = ref<string>('ALL')
const container = ref<HTMLDivElement>()

let handle: SseHandle | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let lastId = 0

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
  if (logs.value.length > 2000) logs.value.splice(0, logs.value.length - 2000)
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

function startStream() {
  handle = subscribeSse({
    url: `/api/v1/jobs/${props.jobId}/tasks/${props.taskId}/logs/stream`,
    token: conn.token,
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
  () => {
    logs.value = []
    lastId = 0
    ended.value = false
    handle?.close()
    handle = null
    startStream()
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
      <el-tag v-if="ended" type="info" size="small">任务已终态，日志收流完毕</el-tag>
    </div>
    <div ref="container" class="lines mono">
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
