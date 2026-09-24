<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { ElMessage } from 'element-plus'
import { getClient } from '@/api/client'
import { unwrap } from '@/api/problem'
import { subscribeSse, type SseHandle } from '@/api/sse'
import { useConnectionStore } from '@/stores/connection'

const conn = useConnectionStore()
const router = useRouter()

// 待认领徽章：15s 轮询兜底（零注册台账量小、无分页）
const pendingQuery = useQuery({
  queryKey: ['pending-count'],
  queryFn: async () => unwrap(await getClient().GET('/api/v1/pending-machines')),
  refetchInterval: 15000,
})
const pendingCount = computed(() => pendingQuery.data.value?.items.length ?? 0)

function disconnect() {
  conn.disconnect()
  router.push({ name: 'welcome' })
}

// ── root 密码一次性捕获（task.root_password 事件错过即丢） ──────────────────
const pwDialog = ref(false)
const pwInfo = ref<{ password: string; taskId: string } | null>(null)
let pwWatch: SseHandle | null = null

async function watchRootPassword() {
  if (!conn.connected || pwWatch) return
  // 订阅水位取当前最新事件：历史里的旧密码不重弹（事件表会留存很久）
  let watermark = 0
  try {
    const latest = await unwrap(await getClient().GET('/api/v1/events', { params: { query: { page_size: 1 } } }))
    watermark = latest.items?.[0]?.id ?? 0
  } catch {
    watermark = 0
  }
  const loadedAt = Date.now()
  pwWatch = subscribeSse({
    url: '/api/v1/events/stream',
    token: conn.token,
    lastEventId: String(watermark),
    onMessage: (msg) => {
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
    if (ok) void watchRootPassword()
    else {
      pwWatch?.close()
      pwWatch = null
    }
  },
  { immediate: true },
)

function copyPassword() {
  if (pwInfo.value?.password) {
    void navigator.clipboard.writeText(pwInfo.value.password)
    ElMessage.success('已复制到剪贴板')
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
        <el-menu-item index="/images">
          <el-icon><Box /></el-icon>镜像库
        </el-menu-item>
        <el-menu-item index="/credentials">
          <el-icon><Key /></el-icon>凭证
        </el-menu-item>
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>设置
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="topbar" height="48px">
        <div class="topbar-right">
          <el-tag v-if="conn.capabilities" type="success" effect="plain" size="small">
            引擎 v{{ conn.capabilities.version }}
          </el-tag>
          <el-tag v-else type="danger" effect="plain" size="small">未连接</el-tag>
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
  </el-container>
</template>

<style scoped>
.shell {
  height: 100%;
}
.aside {
  background: #fff;
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
  color: #303133;
}
.brand img {
  width: 26px;
  height: 26px;
}
.menu {
  border-right: none;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.operator {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid #e4e7ed;
  background: #f5f7fa;
  display: block;
}
.main {
  padding: 0;
  overflow: auto;
}
.pw-value {
  margin: 12px 0 8px;
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 6px;
  font-size: 14px;
  word-break: break-all;
}
</style>
