<script setup lang="ts">
import type { Component } from 'vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Bell,
  FileText,
  KeyRound,
  LayoutDashboard,
  List,
  Package,
  Server,
  Settings,
} from 'lucide-vue-next'
import { getClient } from '@/api/client'
import { useConnectionStore } from '@/stores/connection'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

/**
 * 全局命令面板（Ctrl/Cmd+K）：静态导航 + 机器模糊搜索（引擎 A1 q=）+
 * 最近任务。机器搜索走引擎、任务在最近 20 条里按 id/机器 id 片段前端过滤
 * （引擎 jobs 列表无 q=，任务身份就是 job id 本身）。Listbox 的本地过滤以
 * 元素文本为据——每个 item 内嵌 sr-only 的搜索词锚点，保证异步结果不被
 * 二次过滤误伤。
 */
const visible = ref(false)
const term = ref('')
const loading = ref(false)
const router = useRouter()
const conn = useConnectionStore()

type Item = {
  key: string
  icon: Component
  title: string
  subtitle?: string
  to: { name: string; params?: Record<string, string> }
}

const NAV_ITEMS: Item[] = [
  { key: 'nav-dashboard', icon: LayoutDashboard, title: '总览', to: { name: 'dashboard' } },
  { key: 'nav-machines', icon: Server, title: '机器', to: { name: 'machines' } },
  { key: 'nav-pending', icon: Bell, title: '待认领', to: { name: 'pending' } },
  { key: 'nav-jobs', icon: List, title: '任务', to: { name: 'jobs' } },
  { key: 'nav-events', icon: FileText, title: '事件', to: { name: 'events' } },
  { key: 'nav-images', icon: Package, title: '镜像库', to: { name: 'images' } },
  { key: 'nav-credentials', icon: KeyRound, title: '凭证', to: { name: 'credentials' } },
  { key: 'nav-settings', icon: Settings, title: '设置', to: { name: 'settings' } },
]

const machines = ref<Item[]>([])
const JOB_LABEL: Record<string, string> = {
  install: '安装', discover: '盘查', power: '电源动作', erase_drives: '擦盘',
  set_bios_attributes: 'BIOS 修改', configure_raid: 'RAID 配置',
  rescue: '救援模式', decommission: '退役(全盘擦除)',
}

function jobItem(j: { id: string; type: string; state: string; machine_ids?: string[] }): Item {
  return {
    key: j.id,
    icon: List,
    title: `任务 ${j.id.slice(4, 12)}…`,
    subtitle: `${JOB_LABEL[j.type] ?? j.type} · ${j.state}${j.machine_ids?.[0] ? ` · ${j.machine_ids[0].slice(4, 12)}…` : ''}`,
    to: { name: 'job-detail', params: { id: j.id } },
  }
}

let searchSeq = 0
watch([term, visible], async ([t, vis]) => {
  if (!vis) return
  const seq = ++searchSeq
  const q = t.trim()
  // 机器：引擎 A1 模糊搜索（序列号/BMC/厂商/型号/标签/ID 片段）
  if (q.length >= 1) {
    loading.value = true
    try {
      const res = await getClient().GET('/api/v1/machines', {
        params: { query: { q, page_size: 8 } },
      })
      if (seq !== searchSeq) return
      const items = res.data?.items ?? []
      machines.value = items.map((m) => ({
        key: m.id,
        icon: Server,
        title: m.bmc?.address || m.id,
        subtitle: [m.bmc?.vendor, m.bmc?.model, m.hardware?.serial_number, m.id]
          .filter(Boolean)
          .join(' · '),
        to: { name: 'machine-detail', params: { id: m.id } },
      }))
    } catch {
      machines.value = []
    } finally {
      if (seq === searchSeq) loading.value = false
    }
  } else {
    machines.value = []
    loading.value = false
  }
})

// 最近任务：面板打开时拉一次（最近 20 条），输入时前端按 id/机器 id 过滤。
const recentJobs = ref<{ id: string; type: string; state: string; machine_ids?: string[] }[]>([])
watch(visible, async (vis) => {
  if (!vis) {
    term.value = ''
    return
  }
  if (recentJobs.value.length > 0 || !conn.connected) return
  try {
    const res = await getClient().GET('/api/v1/jobs', { params: { query: { page_size: 20 } } })
    recentJobs.value = res.data?.items ?? []
  } catch {
    recentJobs.value = []
  }
})

const filteredJobs = computed(() => {
  const q = term.value.trim().toLowerCase()
  const pool = recentJobs.value
  const hit = q
    ? pool.filter(
        (j) =>
          j.id.toLowerCase().includes(q) ||
          (j.machine_ids ?? []).some((m) => m.toLowerCase().includes(q)),
      )
    : pool
  return hit.slice(0, 6).map(jobItem)
})

// 展示分组:无搜索词时是导航+最近任务,有搜索词时是引擎机器结果+任务
const groups = computed<{ label: string; items: Item[] }[]>(() => [
  { label: '导航', items: term.value.trim() ? [] : NAV_ITEMS },
  { label: '机器', items: machines.value },
  { label: '最近任务', items: filteredJobs.value },
])

function pick(item: Item) {
  visible.value = false
  term.value = ''
  void router.push(item.to)
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    visible.value = !visible.value
    return
  }
  // reka Listbox 没有默认高亮(cmdk 有):无高亮时 Enter 兜底选第一条
  // 可见结果;有高亮则交给 reka 自己的 Enter 处理,避免双重触发
  if (e.key === 'Enter' && visible.value) {
    const highlighted = document.querySelector<HTMLElement>(
      '[data-slot=command-item][data-highlighted]',
    )
    if (highlighted) return
    const first = document.querySelector<HTMLElement>(
      '[data-slot=command-item]:not([data-hidden=true])',
    )
    if (first) {
      e.preventDefault()
      first.click()
    }
  }
}

defineExpose({ open: () => (visible.value = true) })

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Dialog :open="visible" @update:open="(v: boolean) => (visible = v)">
    <DialogContent class="max-w-[560px] overflow-hidden p-0">
      <DialogHeader class="sr-only">
        <DialogTitle>搜索</DialogTitle>
        <DialogDescription>搜索机器、任务或跳转页面</DialogDescription>
      </DialogHeader>
      <Command class="**:data-[slot=command-input-wrapper]:h-12">
        <!-- CommandInput 内部硬绑 filterState.search(外层 v-model 会被覆盖):
             异步搜索经原生 input 事件同步 term -->
        <CommandInput
          placeholder="搜索机器（序列号 / BMC / 厂商 / 标签）或任务 ID…"
          @input="(e: Event) => (term = (e.target as HTMLInputElement).value)"
        />
        <CommandList class="max-h-[380px] py-1.5">
          <CommandEmpty>无匹配结果</CommandEmpty>
          <template v-for="(group, gi) in groups" :key="gi">
            <CommandGroup v-if="group.items.length > 0" :heading="group.label">
              <CommandItem
                v-for="item in group.items"
                :key="item.key"
                :value="`${item.title} ${item.subtitle ?? ''}`"
                class="[&_span]:!text-current [&_span[data-slot=command-item]]:text-foreground"
                @select="pick(item)"
              >
                <!-- 搜索词锚点：Listbox 按元素文本过滤，异步结果恒含 term 防误伤 -->
                <span class="sr-only">{{ term }}</span>
                <component :is="item.icon" class="size-4 shrink-0 text-muted-foreground" />
                <div class="min-w-0">
                  <div class="truncate text-sm">{{ item.title }}</div>
                  <div v-if="item.subtitle" class="truncate text-xs text-muted-foreground">
                    {{ item.subtitle }}
                  </div>
                </div>
              </CommandItem>
            </CommandGroup>
          </template>
          <div
            v-if="loading"
            class="px-4 py-3 text-center text-sm text-muted-foreground"
          >
            搜索中…
          </div>
        </CommandList>
      </Command>
      <div class="flex justify-end gap-4 border-t px-4 py-2.5 text-xs text-muted-foreground">
        <span>↑↓ 选择</span><span>↵ 跳转</span><span>Esc 关闭</span>
      </div>
    </DialogContent>
  </Dialog>
</template>
