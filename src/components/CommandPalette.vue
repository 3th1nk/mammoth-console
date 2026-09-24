<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getClient } from '@/api/client'
import { useConnectionStore } from '@/stores/connection'

/**
 * 全局命令面板（Ctrl/Cmd+K）：静态导航 + 机器模糊搜索（引擎 A1 q=）+
 * 最近任务。机器搜索走引擎、任务在最近 20 条里按 id/机器 id 片段前端过滤
 * （引擎 jobs 列表无 q=，任务身份就是 job id 本身）。
 */
const visible = ref(false)
const term = ref('')
const loading = ref(false)
const activeIdx = ref(0)
const router = useRouter()
const conn = useConnectionStore()

type Item = {
  key: string
  icon: string
  title: string
  subtitle?: string
  to: { name: string; params?: Record<string, string> }
}

const NAV_ITEMS: Item[] = [
  { key: 'nav-dashboard', icon: 'Odometer', title: '总览', to: { name: 'dashboard' } },
  { key: 'nav-machines', icon: 'Platform', title: '机器', to: { name: 'machines' } },
  { key: 'nav-pending', icon: 'Bell', title: '待认领', to: { name: 'pending' } },
  { key: 'nav-jobs', icon: 'List', title: '任务', to: { name: 'jobs' } },
  { key: 'nav-events', icon: 'Document', title: '事件', to: { name: 'events' } },
  { key: 'nav-images', icon: 'Box', title: '镜像库', to: { name: 'images' } },
  { key: 'nav-credentials', icon: 'Key', title: '凭证', to: { name: 'credentials' } },
  { key: 'nav-settings', icon: 'Setting', title: '设置', to: { name: 'settings' } },
]

const machines = ref<Item[]>([])
const JOB_LABEL: Record<string, string> = {
  install: '安装', discover: '盘查', power: '电源动作', erase_drives: '擦盘',
  set_bios_attributes: 'BIOS 修改', configure_raid: 'RAID 配置',
}

function jobItem(j: { id: string; type: string; state: string; machine_ids?: string[] }): Item {
  return {
    key: j.id,
    icon: 'List',
    title: `任务 ${j.id.slice(4, 12)}…`,
    subtitle: `${JOB_LABEL[j.type] ?? j.type} · ${j.state}${j.machine_ids?.[0] ? ` · ${j.machine_ids[0].slice(4, 12)}…` : ''}`,
    to: { name: 'job-detail', params: { id: j.id } },
  }
}

let searchSeq = 0
watch([term, visible], async ([t, vis]) => {
  if (!vis) return
  activeIdx.value = 0
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
        icon: 'Platform',
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
  if (!vis || recentJobs.value.length > 0 || !conn.connected) return
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

const results = computed<Item[]>(() => {
  const q = term.value.trim()
  if (!q) return [...NAV_ITEMS, ...filteredJobs.value]
  return [...machines.value, ...filteredJobs.value]
})

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
  if (!visible.value) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIdx.value = Math.min(activeIdx.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIdx.value = Math.max(activeIdx.value - 1, 0)
  } else if (e.key === 'Enter') {
    const item = results.value[activeIdx.value]
    if (item) pick(item)
  }
}

defineExpose({ open: () => (visible.value = true) })

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

watch(results, (r) => {
  if (activeIdx.value >= r.length) activeIdx.value = Math.max(0, r.length - 1)
})
</script>

<template>
  <el-dialog
    v-model="visible"
    width="560px"
    align-center
    :show-close="false"
    class="palette-dialog"
    @opened="() => (term = '')"
  >
    <el-input
      v-model="term"
      placeholder="搜索机器（序列号 / BMC / 厂商 / 标签）或任务 ID，输入页名跳页面…"
      clearable
      :prefix-icon="'Search'"
      size="large"
    />
    <div class="results">
      <div v-if="results.length === 0 && !loading" class="empty text-muted">无匹配结果</div>
      <div
        v-for="(item, i) in results"
        :key="item.key"
        class="row"
        :class="{ active: i === activeIdx }"
        @mouseenter="activeIdx = i"
        @click="pick(item)"
      >
        <div class="title">{{ item.title }}</div>
        <div v-if="item.subtitle" class="sub text-muted">{{ item.subtitle }}</div>
      </div>
    </div>
    <div class="hints text-muted">
      <span>↑↓ 选择</span><span>↵ 跳转</span><span>Esc 关闭</span>
    </div>
  </el-dialog>
</template>

<style scoped>
.results {
  max-height: 380px;
  overflow: auto;
  margin-top: 8px;
}
.row {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.row.active {
  background: var(--el-color-primary-light-9);
}
.row .title {
  font-size: 14px;
  color: var(--el-text-color-primary);
}
.row .sub {
  font-size: 12px;
  margin-top: 2px;
}
.empty {
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
}
.hints {
  display: flex;
  gap: 14px;
  justify-content: flex-end;
  font-size: 12px;
  margin-top: 8px;
}
</style>

<style>
.palette-dialog .el-dialog__header {
  display: none;
}
.palette-dialog .el-dialog__body {
  padding: 14px 16px;
}
</style>
