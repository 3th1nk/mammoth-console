<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/vue-query'
import { ElMessage } from 'element-plus'
import { getClient } from '@/api/client'
import { unwrap } from '@/api/problem'
import { subscribeSse, type SseHandle } from '@/api/sse'
import {
  pendingListKey,
  pendingDomain,
  machineDomain,
  jobDomain,
  credentialDomain,
  imageDomain,
  biosProfileDomain,
  webhookDomain,
  eventDomain,
  dashboardDomain,
} from '@/api/queryKeys'
import { useConnectionStore } from '@/stores/connection'
import { useThemeStore } from '@/stores/theme'
import { copyToClipboard } from '@/utils/clipboard'
import { formatVersion } from '@/utils/format'
import CommandPalette from '@/components/CommandPalette.vue'

const conn = useConnectionStore()
const theme = useThemeStore()
const router = useRouter()
const qc = useQueryClient()
const palette = ref<InstanceType<typeof CommandPalette> | null>(null)

// 待认领徽章：key 与待认领列表页/Dashboard 共享（pendingListKey），认领等
// 变更由全局事件总线即时失效；15s 轮询仅作 SSE 不可用时的兜底
const pendingQuery = useQuery({
  queryKey: pendingListKey,
  queryFn: async () => unwrap(await getClient().GET('/api/v1/pending-machines')),
  refetchInterval: 15000,
})
const pendingCount = computed(() => pendingQuery.data.value?.items.length ?? 0)

function disconnect() {
  conn.disconnect()
  router.push({ name: 'welcome' })
}

// ── 全局事件流：root 密码一次性捕获 + 事件→查询失效总线 ────────────────────
const pwDialog = ref(false)
const pwInfo = ref<{ password: string; taskId: string } | null>(null)
let eventWatch: SseHandle | null = null

// 事件 type 前缀 → 查询域前缀。task.* 不进映射：job/task 详情页各自订阅
// job 级 SSE 失效（装机期间 PXE/阶段事件很密，不打全局总线）；机器事件
// 顺带刷 pending（claimed/created/deleted 影响待认领数）；BIOS 基线事件
// 顺带刷机器域（baseline_set/applied 改机器视角）。
const EVENT_DOMAINS: Array<[string, readonly QueryKey[]]> = [
  ['pending.', [pendingDomain]],
  ['machine.', [machineDomain, pendingDomain]],
  ['credential.', [credentialDomain]],
  ['image.', [imageDomain]],
  ['bios_profile', [biosProfileDomain, machineDomain]],
  ['webhook.', [webhookDomain]],
  ['job.', [jobDomain]],
]

// 聚合类失效节流：总览统计与事件列表对实时性不敏感，3s 聚合一次即可，
// 避免 task.* 高频事件引发的密集 refetch。资源域映射不节流（本身低频，
// 徽标/详情要即时）。
const BULK_INVALIDATE_MS = 3000
let lastBulkInvalidate = 0

function invalidateOnEvent(type: string) {
  const now = Date.now()
  if (now - lastBulkInvalidate > BULK_INVALIDATE_MS) {
    lastBulkInvalidate = now
    void qc.invalidateQueries({ queryKey: eventDomain })
    void qc.invalidateQueries({ queryKey: dashboardDomain })
  }
  for (const [prefix, domains] of EVENT_DOMAINS) {
    if (type.startsWith(prefix)) {
      for (const d of domains) void qc.invalidateQueries({ queryKey: d })
      break
    }
  }
}

async function watchGlobalEvents() {
  if (!conn.connected || eventWatch) return
  // 订阅水位取当前最新事件：历史里的旧密码不重弹（事件表会留存很久）。
  // 必须 order=desc——events 列表默认 asc，无游标的 page_size=1 返回的是
  // 全表最老事件；那样水位永远在远古，每次刷新整张事件表从头回放
  // （200 行/s），正是刷新卡顿的放大器之一。断线重连按 Last-Event-ID
  // 续传，补发的事件照常走失效总线——错过的变更会被补刷。
  let watermark = 0
  try {
    const latest = await unwrap(
      await getClient().GET('/api/v1/events', { params: { query: { page_size: 1, order: 'desc' } } }),
    )
    watermark = latest.items?.[0]?.id ?? 0
  } catch {
    watermark = 0
  }
  const loadedAt = Date.now()
  eventWatch = subscribeSse({
    url: '/api/v1/events/stream',
    token: conn.token,
    lastEventId: String(watermark),
    onMessage: (msg) => {
      invalidateOnEvent(msg.event)
      if (msg.event !== 'task.root_password') return
      try {
        const ev = JSON.parse(msg.data) as { resource_id?: string; ts?: string; payload?: { password?: string } }
        // 只弹本会话期间新产生的事件
        if (ev.ts && Date.parse(ev.ts) < loadedAt - 60_000) return
        pwInfo.value = { password: ev.payload?.password ?? '', taskId: ev.resource_id ?? '' }
        pwDialog.value = true
      } catch {
        // 非法负载忽略
      }
    },
  })
}

watch(
  () => conn.connected,
  (ok) => {
    if (ok) void watchGlobalEvents()
    else {
      eventWatch?.close()
      eventWatch = null
    }
  },
  { immediate: true },
)

function copyPassword() {
  if (pwInfo.value?.password) {
    void copyToClipboard(pwInfo.value.password).then((ok) =>
      ok ? ElMessage.success('已复制到剪贴板') : ElMessage.warning('复制失败，请手动选中复制'),
    )
  }
}
</script>

<template>
  <el-container class="shell">
    <el-aside width="200px" class="aside">
      <div class="brand">
        <img src="/mammoth.svg" alt="mammoth" />
        <span>Mammoth Console</span>
      </div>
      <div class="engine-version">
        <el-tag v-if="conn.capabilities" type="success" effect="plain" size="small">
          引擎 {{ formatVersion(conn.capabilities.version) }}
        </el-tag>
        <el-tag v-else type="danger" effect="plain" size="small">未连接</el-tag>
      </div>
      <el-menu router :default-active="$route.path" class="menu">
        <el-menu-item index="/">
          <el-icon><Odometer /></el-icon>总览
        </el-menu-item>
        <el-menu-item index="/machines">
          <el-icon><Platform /></el-icon>机器
        </el-menu-item>
        <el-menu-item index="/pending">
          <el-icon><Bell /></el-icon>
          <el-badge :value="pendingCount" :hidden="pendingCount === 0" :max="99">
            待认领
          </el-badge>
        </el-menu-item>
        <el-menu-item index="/jobs">
          <el-icon><List /></el-icon>任务
        </el-menu-item>
        <el-menu-item index="/events">
          <el-icon><Document /></el-icon>事件
        </el-menu-item>
        <el-menu-item index="/images">
          <el-icon><Box /></el-icon>镜像库
        </el-menu-item>
        <el-menu-item index="/credentials">
          <el-icon><Key /></el-icon>凭证
        </el-menu-item>
        <el-menu-item index="/bios-profiles">
          <el-icon><Cpu /></el-icon>BIOS 基线
        </el-menu-item>
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>设置
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="topbar" height="52px">
        <div class="topbar-right">
          <el-input
            class="search-entry"
            readonly
            placeholder="搜索  ⌘K"
            @click="palette?.open()"
          />
          <el-tooltip :content="theme.dark ? '切到亮色' : '切到暗色'" placement="bottom">
            <el-button class="theme-toggle" circle text @click="theme.toggle()">
              <el-icon><Moon v-if="!theme.dark" /><Sunny v-else /></el-icon>
            </el-button>
          </el-tooltip>
          <el-dropdown trigger="click">
            <span class="operator">
              <img src="/avatar.svg" alt="operator" class="avatar" />
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>管理员（引擎单 token 模式）</el-dropdown-item>
                <el-dropdown-item divided @click="disconnect">断开连接</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-alert
        v-if="conn.unauthorized"
        title="引擎返回 401：Token 已失效，请在「设置 · 连接」更新"
        type="error"
        :closable="false"
        show-icon
      />
      <el-main class="main"><router-view /></el-main>
    </el-container>

    <el-dialog v-model="pwDialog" title="装机 root 密码（一次性）" width="480px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon title="该密码不会再次显示，请立即保存。" />
      <div class="pw-value mono">{{ pwInfo?.password }}</div>
      <div class="text-muted" style="font-size: 12px">任务 {{ pwInfo?.taskId }}</div>
      <template #footer>
        <el-button @click="copyPassword">复制</el-button>
        <el-button type="primary" @click="pwDialog = false">我已保存</el-button>
      </template>
    </el-dialog>

    <CommandPalette ref="palette" />
  </el-container>
</template>

<style scoped>
.shell {
  height: 100%;
}
.aside {
  background: var(--el-bg-color);
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.brand img {
  width: 26px;
  height: 26px;
}
.menu {
  border-right: none;
}
.engine-version {
  padding: 0 16px 10px;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  background: var(--el-bg-color);
  border-bottom: 1px solid #e4e7ed;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.search-entry {
  width: 220px;
  cursor: pointer;
}
.search-entry :deep(.el-input__inner) {
  cursor: pointer;
}
.theme-toggle {
  height: 32px;
  width: 32px;
}
.theme-toggle :deep(.el-icon) {
  font-size: 17px;
}
.operator {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid #e4e7ed;
  background: var(--el-fill-color-light);
  display: block;
}
.main {
  padding: 0;
  overflow: auto;
}
.pw-value {
  margin: 12px 0 8px;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 14px;
  word-break: break-all;
}
</style>
