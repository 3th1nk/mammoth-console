<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { Search } from 'lucide-vue-next'
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
import { copyToClipboard } from '@/utils/clipboard'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import LangToggle from '@/components/LangToggle.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import ConfirmDialogHost from '@/components/ConfirmDialogHost.vue'

const { t } = useI18n()
const conn = useConnectionStore()
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

async function copyPassword() {
  const { toast } = await import('vue-sonner')
  if (!pwInfo.value?.password) return
  const ok = await copyToClipboard(pwInfo.value.password)
  if (ok) toast.success(t('common.copied'))
  else toast.warning(t('common.copyFailed'))
}
</script>

<template>
  <SidebarProvider>
    <AppSidebar :pending-count="pendingCount" />

    <!-- 壳固定视口高(inset 变体上下各 0.5rem margin,故减 1rem),滚动收敛到
         内层 overflow-auto——reka 弹层(Select/Combobox/Dialog)打开时会锁
         body 的 overflow 且可能残留,内容滚动与 body 解耦后不再被殃及 -->
    <SidebarInset class="h-[calc(100svh-1rem)] overflow-hidden">
      <header
        class="sticky top-0 z-50 flex h-16 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur"
      >
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="mr-1 !h-6" />
        <div class="ms-auto flex items-center gap-2">
          <button
            class="search-entry flex h-8 w-60 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
            @click="palette?.open()"
          >
            <Search class="size-4" />
            <span>{{ t('common.search') }}</span>
            <kbd class="ml-auto rounded border bg-background px-1.5 text-[10px] font-medium">⌘K</kbd>
          </button>
          <LangToggle />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button class="operator cursor-pointer">
                <img
                  src="/avatar.svg"
                  alt="operator"
                  class="block size-8 rounded-full border-2 border-border bg-muted"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56">
              <DropdownMenuLabel>{{ t('common.operator') }}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem @click="disconnect">{{ t('common.disconnect') }}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Alert
        v-if="conn.unauthorized"
        variant="destructive"
        class="mx-4 mt-3 border-x-0 border-t-0 rounded-none"
      >
        <AlertTitle>{{ t('common.unauthorizedTitle') }}</AlertTitle>
        <AlertDescription>{{ t('common.unauthorizedDesc') }}</AlertDescription>
      </Alert>

      <div class="flex-1 overflow-auto"><RouterView /></div>
    </SidebarInset>

    <Dialog :open="pwDialog" @update:open="(v: boolean) => (pwDialog = v)">
      <DialogContent class="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{{ t('common.pwTitle') }}</DialogTitle>
          <DialogDescription>{{ t('common.pwDesc') }}</DialogDescription>
        </DialogHeader>
        <div class="break-all rounded-md bg-muted px-3 py-2.5 font-mono text-sm">
          {{ pwInfo?.password }}
        </div>
        <div class="text-xs text-muted-foreground">{{ t('common.pwTaskId') }} {{ pwInfo?.taskId }}</div>
        <DialogFooter>
          <Button variant="outline" @click="copyPassword">{{ t('common.copy') }}</Button>
          <Button @click="pwDialog = false">{{ t('common.close') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <CommandPalette ref="palette" />
    <ConfirmDialogHost />
  </SidebarProvider>
</template>
