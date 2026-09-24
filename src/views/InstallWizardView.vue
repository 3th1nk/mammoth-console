<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Delete } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import { useConnectionStore } from '@/stores/connection'
import DistroBadge from '@/components/DistroBadge.vue'
import StateBadge from '@/components/StateBadge.vue'
import { resolveDistroKey } from '@/utils/distro'
import { formatBytes } from '@/utils/format'

type InstallSpec = components['schemas']['InstallSpec']
type Machine = components['schemas']['Machine']

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()
const conn = useConnectionStore()

// ── 目标机器（来自列表多选或详情"重装"入口） ────────────────────────────────
const machineIds = computed(() =>
  String(route.query.machines ?? '').split(',').map((s) => s.trim()).filter(Boolean),
)

const step = ref(1)
const submittingJob = ref(false)

type TargetRow = {
  machine: Machine
  busy: boolean
  busyTaskId?: string
}

const targetsQuery = useQuery({
  queryKey: ['wizard-targets', machineIds.value],
  queryFn: async () => {
    const ids = machineIds.value
    const rows: TargetRow[] = []
    for (const id of ids) {
      const m = await unwrap(
        await getClient().GET('/api/v1/machines/{id}', { params: { path: { id } } }),
      )
      let busy = false
      let busyTaskId: string | undefined
      try {
        const ct = await unwrap(
          await getClient().GET('/api/v1/machines/{id}/current-tasks', { params: { path: { id } } }),
        )
        const inst = ct.items.find((t) => t.flow_name === 'install')
        if (inst) {
          busy = true
          busyTaskId = inst.task_id
        }
      } catch {
        busy = true // 查不到占用状态时按保守处理
      }
      rows.push({ machine: m, busy, busyTaskId })
    }
    return rows
  },
})

const targetRows = computed(() => targetsQuery.data.value ?? [])
const readyTargets = computed(() => targetRows.value.filter((r) => !r.busy))

// ── Step2 安装意图 ──────────────────────────────────────────────────────────
const distros = computed(() => conn.capabilities?.distros ?? [])
const bootDefault = computed(() => conn.capabilities?.boot_strategy_default ?? 'virtual_media')

const spec = reactive<InstallSpec>({
  image: { distro: '' },
  boot: { strategy: bootDefault.value, installer: 'auto' },
})

const distroChoice = computed({
  get: () => spec.image.distro,
  set: (v: string) => {
    spec.image.distro = v
  },
})

const isWindows = computed(() => spec.image.distro.toLowerCase().includes('win'))
const isDebian = computed(() => {
  const d = distros.value.find((x) => x.name === spec.image.distro)
  return d?.family === 'preseed'
})

// windows 选中/取消时收敛启动策略：UEFI-only 且 agent 通路 PXE-only
watch(isWindows, (win) => {
  if (win && spec.boot?.strategy !== 'pxe') spec.boot!.strategy = 'virtual_media'
})

// ── 镜像：库选择 / 内联 ────────────────────────────────────────────────────
const imageMode = ref<'library' | 'inline'>('library')
const imagesQuery = useQuery({
  queryKey: ['wizard-images'],
  queryFn: async () => unwrap(await getClient().GET('/api/v1/images')),
})
const readyImages = computed(() => (imagesQuery.data.value?.items ?? []).filter((i) => i.state === 'ready'))
const chosenImageId = ref('')
// 依据镜像登记的 distro/version 自动选择发行版驱动（可手动改）
const autoDistroHint = ref('')

watch(chosenImageId, (id) => {
  const img = readyImages.value.find((i) => i.id === id)
  if (!img?.distro) {
    autoDistroHint.value = ''
    return
  }
  const family = resolveDistroKey(img.distro, undefined)
  const candidates = distros.value.filter((d) => resolveDistroKey(d.name, d.family) === family)
  if (candidates.length === 0) {
    autoDistroHint.value = `镜像登记为 ${img.distro}，但引擎没有对应的发行版驱动`
    return
  }
  let picked = candidates[0]!
  if (candidates.length > 1 && img.version) {
    const major = img.version.match(/\d+/)?.[0]
    const byMajor = major ? candidates.find((d) => d.name.replace(/[^\d]/g, '') === major) : undefined
    if (byMajor) picked = byMajor
  }
  spec.image.distro = picked.name
  autoDistroHint.value = `已按镜像信息自动选择 ${picked.name}（可手动修改）`
})

// ── 身份 / 访问 ────────────────────────────────────────────────────────────
const hostnamePattern = ref('')
const rootMode = ref<'random' | 'manual'>('random')
const rootPassword = ref('')
// SSH 公钥（人登录装机系统的通道；与凭证私钥无关）
const sshKeys = ref<string[]>([])

function addSshKey() {
  sshKeys.value.push('')
}

// windows 访问能力开关（rdp/winrm/ping，opt-in）
const winCaps = ref<string[]>([])


// ── 存储：预设 / 逐盘图形化布局 ────────────────────────────────────────────
const storageMode = ref<'preset' | 'custom'>('preset')
type SelectorKind = 'largest' | 'smallest' | 'ssd' | 'hdd' | 'nvme'
interface PartitionRow { size: string; fs: string; mount: string }
interface DiskRow {
  selector: SelectorKind
  action: 'wipe' | 'keep_disk'
  partitions: PartitionRow[]
}

const SELECTOR_LABEL: Record<SelectorKind, string> = {
  largest: '最大盘',
  smallest: '最小盘',
  ssd: 'SSD 固态盘',
  hdd: 'HDD 机械盘',
  nvme: 'NVMe 盘',
}
const FS_OPTIONS = ['vfat', 'xfs', 'ext4', 'swap']

const disks = ref<DiskRow[]>([
  {
    selector: 'largest',
    action: 'wipe',
    partitions: [
      { size: '512M', fs: 'vfat', mount: '/boot/efi' },
      { size: '4G', fs: 'swap', mount: 'swap' },
      { size: 'rest', fs: 'xfs', mount: '/' },
    ],
  },
])

function addDisk() {
  disks.value.push({ selector: 'smallest', action: 'wipe', partitions: [{ size: 'rest', fs: 'xfs', mount: '/' }] })
}
function addPartition(d: DiskRow) {
  d.partitions.push({ size: '100G', fs: 'xfs', mount: '' })
}

// ── 网络：默认自动（DHCP） / 静态（网卡 + bond + vlan） ─────────────────────
const netMode = ref<'auto' | 'static'>('auto')
// 方言边界（docs/04 §5.4 矩阵）：debian 不支持 bond/vlan，前端即时预禁
const distroName = computed(() => spec.image.distro)
const bondSupported = computed(() => !distroName.value.toLowerCase().includes('debian'))

interface BaseIface { ip: string; gateway: string; dns: string; mtu?: number }
interface NicRow extends BaseIface { kind: 'nic'; mac: string }
interface BondRow extends BaseIface { kind: 'bond'; name: string; mode: string; miimon: string; memberMacs: string[]; paramsRaw: string }
type NetRow = NicRow | BondRow

const BOND_MODES = ['active-backup', '802.3ad', 'balance-tlb', 'balance-rr', 'balance-xor', 'broadcast']

const nics = ref<NetRow[]>([])
const vlans = ref<{ id: string; link: string; ip: string }[]>([])

function addNic() {
  nics.value.push({ kind: 'nic', mac: '', ip: '', gateway: '', dns: '' })
}
function addBond() {
  nics.value.push({ kind: 'bond', name: `bond${nics.value.filter((n) => n.kind === 'bond').length}`, mode: 'active-backup', miimon: '100', memberMacs: ['', ''], paramsRaw: '', ip: '', gateway: '', dns: '' })
}
function addVlan() {
  vlans.value.push({ id: '', link: 'bond0', ip: '' })
}

// ── 脚本（明文输入，提交时自动 UTF-8 base64） ──────────────────────────────
interface ScriptRow {
  stage: 'pre_install' | 'post_install'
  shell: 'cmd' | 'powershell'
  content: string
}
const scripts = ref<ScriptRow[]>([])

function addScript() {
  scripts.value.push({ stage: 'post_install', shell: 'cmd', content: '' })
}

function utf8ToB64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

// ── 软件源 ──────────────────────────────────────────────────────────────────
interface RepoRow {
  name: string
  url: string
  gpg_key_url: string
  suite: string
  components: string
}
const repos = ref<RepoRow[]>([])

function addRepo() {
  repos.value.push({ name: `repo-${repos.value.length + 1}`, url: '', gpg_key_url: '', suite: '', components: '' })
}
function removeRepo(idx: number) {
  repos.value.splice(idx, 1)
}

// ── spec 构建（表单 → InstallSpec） ────────────────────────────────────────
// 试算（install-plan）不做 image.id 解析：库镜像在试算时用注册件的
// source_url + digest 代替，提交仍用 id（引擎提交时才解析为缓存文件）。
function buildSpec(opts: { forPlan?: boolean } = {}): InstallSpec {
  const image: InstallSpec['image'] = { distro: spec.image.distro }
  if (imageMode.value === 'library' && chosenImageId.value) {
    if (opts.forPlan) {
      const reg = readyImages.value.find((i) => i.id === chosenImageId.value)
      if (reg) {
        image.source = reg.source_url
        image.checksum = `sha256:${reg.sha256}`
      } else {
        image.id = chosenImageId.value
      }
    } else {
      image.id = chosenImageId.value
    }
  } else if (imageMode.value === 'inline') {
    if (spec.image.source) image.source = spec.image.source
    if (spec.image.checksum) image.checksum = spec.image.checksum
  }
  const out: InstallSpec = { image }

  // 存储
  if (isWindows.value) {
    // windows：单目标盘 NTFS，布局由方言渲染固定生成（contract: 多盘/RAID ❌）
    out.storage = {
      alignment: '4k',
      disks: [{ select: { match: { size: 'largest' } }, wipe: true }],
    }
  } else if (storageMode.value === 'preset') {
    out.storage = {
      alignment: '4k',
      disks: [
        {
          select: { match: { size: 'largest' } },
          wipe: true,
          partitions: [
            { size: '512M', fs: 'vfat', mount: '/boot/efi' },
            { size: '4G', fs: 'swap', mount: 'swap' },
            { size: 'rest', fs: 'xfs', mount: '/' },
          ],
        },
      ],
    }
  } else {
    out.storage = {
      alignment: '4k',
      disks: disks.value.map((d) => {
        const match: components['schemas']['DiskSelectorMatch'] =
          d.selector === 'largest' || d.selector === 'smallest' ? { size: d.selector } : { type: d.selector }
        if (d.action === 'keep_disk') {
          return { select: { match }, keep: 'disk' as const }
        }
        return {
          select: { match },
          wipe: true,
          partitions: d.partitions.map((p) => ({
            size: p.size,
            fs: p.fs as 'vfat' | 'xfs' | 'ext4' | 'swap',
            mount: p.mount || undefined,
          })),
        }
      }),
    }
  }

  // 网络（静态）：普通网卡 + bond + vlan
  if (netMode.value === 'static') {
    const ifaces: components['schemas']['NetworkInterface'][] = []
    for (const n of nics.value) {
      const addr = n.ip.trim() ? [n.ip.trim()] : undefined
      const routes = n.gateway.trim() ? [{ to: 'default', via: n.gateway.trim() }] : undefined
      const dnsList = n.dns.split(/[ ,]+/).filter(Boolean)
      const nameservers = dnsList.length > 0 ? { addresses: dnsList } : undefined
      if (n.kind === 'nic') {
        if (!n.mac.trim()) continue
        ifaces.push({ match: { mac: n.mac.trim() }, addresses: addr, routes, nameservers })
      } else {
        const members = n.memberMacs.map((m) => m.trim()).filter(Boolean)
        if (members.length === 0 && !addr) continue
        let params: Record<string, unknown> | undefined
        if (n.miimon.trim()) params = { ...params, miimon: Number(n.miimon) }
        if (n.paramsRaw.trim()) {
          try {
            params = { ...(params ?? {}), ...(JSON.parse(n.paramsRaw) as Record<string, unknown>) }
          } catch {
            // 非法 JSON 留给提交校验；这里尽力合并
          }
        }
        ifaces.push({
          bond: { interfaces: members.map((m) => ({ match: { mac: m } })), mode: n.mode, params },
          addresses: addr,
          routes,
          nameservers,
        })
      }
    }
    for (const v of vlans.value) {
      if (!v.id.trim() || !v.ip.trim()) continue
      ifaces.push({ vlan: { id: Number(v.id), link: v.link.trim() || 'bond0' }, addresses: [v.ip.trim()] })
    }
    if (ifaces.length > 0) out.network = ifaces
  }

  // 脚本（明文 → base64）
  const scriptSpecs = scripts.value
    .filter((sc) => sc.content.trim())
.map((sc) => ({
      stage: sc.stage,
      shell: sc.shell,
      content_base64: utf8ToB64(sc.content),
    }))
  if (scriptSpecs.length > 0) out.scripts = scriptSpecs

  if (hostnamePattern.value.trim()) out.identity = { hostname_pattern: hostnamePattern.value.trim() }
  const keys = sshKeys.value.map((k) => k.trim()).filter(Boolean)
  const wantPassword = rootMode.value === 'manual' && rootPassword.value
  if (wantPassword || keys.length > 0 || (isWindows.value && winCaps.value.length > 0)) {
    out.access = {
      // root_password 字段在 windows 方言承载的是 Administrator 密码
      ...(wantPassword ? { root_password: rootPassword.value } : {}),
      ...(keys.length > 0 ? { ssh_keys: keys } : {}),
      ...(isWindows.value && winCaps.value.length > 0
        ? { capabilities: winCaps.value as ('rdp' | 'winrm' | 'ping')[] }
        : {}),
    }
  }
  const validRepos = repos.value.filter((r) => r.name && r.url)
  if (validRepos.length > 0) {
    out.package_source = {
      repos: validRepos.map((r) => ({
        name: r.name,
        url: r.url,
        gpg_key_url: r.gpg_key_url || undefined,
        suite: r.suite || undefined,
        components: r.components || undefined,
      })),
    }
  }
  out.boot = { strategy: spec.boot?.strategy ?? 'virtual_media', installer: spec.boot?.installer ?? 'auto' }
  return out
}

// ── Step2 校验与方言即时预校验 ──────────────────────────────────────────────
const REPO_NAME_OK = /^[A-Za-z0-9._-]+$/

function validateStep2(): string | null {
  if (!spec.image.distro) return '请选择发行版'
  if (imageMode.value === 'library' && !chosenImageId.value) return '请从镜像库选择镜像'
  if (imageMode.value === 'inline' && !spec.image.source) return '请填写镜像 source 地址'
  if (imageMode.value === 'inline' && spec.image.source && !/^https?:\/\//.test(spec.image.source)) {
    return '镜像 source 需为 http(s) 地址'
  }
  if (rootMode.value === 'manual' && rootPassword.value.length < 6) return '手动 root 密码至少 6 位'
  const badRepo = repos.value.find((r) => (r.name || r.url) && !(r.name && REPO_NAME_OK.test(r.name) && /^https?:\/\//.test(r.url)))
  if (badRepo) return `软件源 ${badRepo.name || badRepo.url} 的 name/URL 不合法（name 限字母数字._-，URL 需 http(s)）`
  if (storageMode.value === 'custom') {
    for (const [i, d] of disks.value.entries()) {
      if (d.action === 'wipe') {
        if (d.partitions.length === 0) return `第 ${i + 1} 块盘还没有分区`
        if (d.partitions.some((p) => !p.size.trim())) return `第 ${i + 1} 块盘有未填大小的分区`
      }
    }
  }
  if (netMode.value === 'static') {
    for (const [i, n] of nics.value.entries()) {
      if (n.kind === 'nic') {
        if ((n.mac.trim() && !n.ip.trim()) || (!n.mac.trim() && n.ip.trim())) {
          return `第 ${i + 1} 块网卡的 MAC 与 IP 需要成对填写`
        }
      } else {
        const members = n.memberMacs.filter((m) => m.trim())
        if (members.length > 0 && members.length !== n.memberMacs.length) {
          return `bond "${n.name}" 有未填的成员 MAC`
        }
        if (n.ip.trim() && members.length === 0) {
          return `bond "${n.name}" 需要至少一个成员 MAC`
        }
        if (n.paramsRaw.trim()) {
          try { JSON.parse(n.paramsRaw) } catch {
            return `bond "${n.name}" 的高级参数不是合法 JSON`
          }
        }
      }
    }
    for (const [i, v] of vlans.value.entries()) {
      if ((v.id.trim() && !v.ip.trim()) || (!v.id.trim() && v.ip.trim())) {
        return `第 ${i + 1} 条 VLAN 的 VLAN ID 与 IP 需要成对填写`
      }
    }
  }
  if (spec.boot?.strategy === 'pxe' && !conn.capabilities?.netboot_enabled) {
    return '引擎未启用 PXE（netboot），请改用虚拟介质或在引擎侧开启 MAMMOTH_PXE_ENABLED'
  }
  if (isWindows.value) {
    // UEFI-only 前置检查缺机器侧观测（pxe_firmware 不在契约顶层），
    // BIOS 机器由提交期 SCHEMA_FIRMWARE_MISMATCH 拦截并点名。
    if (policyDraftInstaller.value === 'agent' && spec.boot?.strategy !== 'pxe') {
      return 'windows agent 通路仅支持 PXE 启动，请在启动策略中切换为 PXE'
    }
    if (policyDraftInstaller.value === 'agent' && !conn.capabilities?.windows_agent_installer) {
      return '部署未配置 windows agent 通路（MAMMOTH_WINDOWS_APPLY_ALPINE_ISO + PXE）'
    }
    if (policyDraftInstaller.value === 'setup' && !conn.capabilities?.windows_smb_share) {
      return 'windows setup 通路需要部署层 SMB 导出（MAMMOTH_WINDOWS_INSTALL_SMB_UNC 未配置）'
    }
  } else if (isDebian.value && (netMode.value === 'static' ? nics.value.some((n) => n.kind === 'bond') || vlans.value.length > 0 : false)) {
    return 'Debian 方言不支持 bond/VLAN（引擎渲染即拒）'
  }
  return null
}

function next() {
  if (step.value === 2) {
    const err = validateStep2()
    if (err) {
      ElMessage.warning(err)
      return
    }
    void runPlans()
  }
  step.value = Math.min(step.value + 1, 4)
}

function back() {
  step.value = Math.max(step.value - 1, 1)
}

// ── Step3 试算 ─────────────────────────────────────────────────────────────
interface PlanResult {
  machineId: string
  ok: boolean
  plan?: components['schemas']['InstallPlan']
  error?: string
}
const planResults = ref<PlanResult[]>([])
const planning = ref(false)

async function runPlans() {
  planning.value = true
  planResults.value = []
  try {
    for (const row of readyTargets.value) {
      try {
        const plan = await unwrap(
          await getClient().POST('/api/v1/machines/{id}/install-plan', {
            params: { path: { id: row.machine.id } },
            body: buildSpec({ forPlan: true }) as never,
          }),
        )
        planResults.value.push({ machineId: row.machine.id, ok: true, plan })
      } catch (e) {
        planResults.value.push({ machineId: row.machine.id, ok: false, error: errorMessage(e) })
      }
    }
  } finally {
    planning.value = false
  }
}

const planAllOk = computed(() => planResults.value.length > 0 && planResults.value.every((r) => r.ok))

// ── Step4 策略与提交 ───────────────────────────────────────────────────────
const policy = reactive({
  concurrency: 10,
  on_task_failure: 'continue' as 'continue' | 'abort_batch',
  verify_layout: true,
  task_timeout_seconds: 3600,
  health_gate: 'off' as 'off' | 'report' | 'block',
})

async function submit() {
  submittingJob.value = true
  try {
    const { data } = await getClient().POST('/api/v1/jobs', {
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: {
        type: 'install',
        targets: { machine_ids: readyTargets.value.map((r) => r.machine.id as never) },
        spec: buildSpec() as never,
        policy: {
          concurrency: policy.concurrency,
          on_task_failure: policy.on_task_failure,
          verify_layout: policy.verify_layout,
          task_timeout_seconds: policy.task_timeout_seconds,
          health_gate: policy.health_gate,
        },
      },
    })
    const jobId = (data as components['schemas']['Job'] | undefined)?.id
    ElMessage.success(`装机任务 ${jobId} 已受理`)
    void queryClient.invalidateQueries({ queryKey: ['jobs'] })
    router.push({ name: 'job-detail', params: { id: jobId } })
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    submittingJob.value = false
  }
}

// windows 安装通路（setup | agent | auto），随 spec.boot 走
const policyDraftInstaller = computed({
  get: () => (spec.boot?.installer as 'setup' | 'agent' | 'auto') ?? 'auto',
  set: (v: 'setup' | 'agent' | 'auto') => {
    spec.boot!.installer = v
  },
})

const KEEP_LABEL: Record<string, string> = { full: '完整支持', partial: '部分支持', none: '不支持' }

const HEALTH_GATE_DESC: Record<string, string> = {
  off: '不检查，直接装机',
  report: '坏盘写入试算警告，不拦截',
  block: '提交前拦截：最近盘查中有 fail 盘的机器将被 422 拒绝并点名 serial',
}

</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">装机向导</h1>
    </div>

    <el-card shadow="never" class="mb">
      <el-steps :active="step - 1" align-center finish-status="success">
        <el-step title="目标机器" />
        <el-step title="安装意图" />
        <el-step title="试算预览" />
        <el-step title="执行策略" />
      </el-steps>
    </el-card>

    <!-- Step 1 -->
    <el-card v-if="step === 1" shadow="never">
      <el-alert
        v-if="targetsQuery.error.value"
        :title="errorMessage(targetsQuery.error.value)"
        type="error"
        :closable="false"
        show-icon
        class="mb"
      />
      <el-table :data="targetRows" v-loading="targetsQuery.isFetching.value" size="default">
        <el-table-column label="机器" min-width="160">
          <template #default="{ row }"><span class="mono">{{ row.machine.id }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><StateBadge kind="machine" :state="row.machine.state" /></template>
        </el-table-column>
        <el-table-column label="BMC 地址" min-width="140">
          <template #default="{ row }"><span class="mono">{{ row.machine.bmc.address }}</span></template>
        </el-table-column>
        <el-table-column label="占用检查" min-width="260">
          <template #default="{ row }">
            <template v-if="row.busy">
              <el-tag type="warning" size="small">有进行中的装机任务</el-tag>
              <span class="mono text-muted" style="margin-left: 6px">{{ row.busyTaskId }}</span>
            </template>
            <el-tag v-else type="success" size="small">空闲</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <div class="step-actions">
        <span class="text-muted">空闲 {{ readyTargets.length }} / {{ targetRows.length }} 台可装机</span>
        <el-button type="primary" :disabled="readyTargets.length === 0" @click="step = 2">
          下一步：安装意图
        </el-button>
      </div>
    </el-card>

    <!-- Step 2 -->
    <el-card v-else-if="step === 2" shadow="never">
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="镜像" required>
          <el-radio-group v-model="imageMode">
            <el-radio-button value="library">从镜像库选择（推荐）</el-radio-button>
            <el-radio-button value="inline">直接填写镜像地址</el-radio-button>
          </el-radio-group>
          <div v-if="imageMode === 'library'" style="width: 100%; margin-top: 6px">
            <el-select v-model="chosenImageId" placeholder="选择就绪的库镜像" style="width: 420px">
              <el-option v-for="i in readyImages" :key="i.id" :value="i.id" :label="i.name || i.id">
                {{ i.name || i.id }} · {{ formatBytes(i.size_bytes) }}
              </el-option>
            </el-select>
            <div class="hint">
              没有合适的？先到「镜像库」注册（引擎按 sha256 门禁后台拉取）。
              <router-link to="/images" target="_blank">打开镜像库</router-link>
            </div>
            <div v-if="readyImages.length === 0" class="hint" style="color: #e6a23c">
              镜像库中没有就绪的镜像。
            </div>
          </div>
          <div v-else style="width: 100%; margin-top: 6px">
            <el-input
              v-model="spec.image.source"
              placeholder="https://mirror.example.com/rocky9.iso（引擎可达；粘贴后自动识别发行版）"
              class="mono"
            />
            <el-input
              v-model="spec.image.checksum"
              placeholder="校验和: 9f86d8... (SHA256，可选，建议填写)"
              class="mono"
              style="margin-top: 6px"
            />
          </div>
        </el-form-item>

        <el-form-item label="发行版（按镜像自动识别，可手动调整）" required>
          <el-select v-model="distroChoice" placeholder="选择发行版" style="width: 320px">
            <el-option v-for="d in distros" :key="d.name" :value="d.name" :label="d.name">
              <span style="display: inline-flex; align-items: center; gap: 8px">
                <DistroBadge :name="d.name" :family="d.family" />
                {{ d.name }}
                <span class="text-muted" style="font-size: 12px">{{ d.family }}</span>
              </span>
            </el-option>
          </el-select>
          <div v-if="autoDistroHint" class="hint" style="color: #67c23a">{{ autoDistroHint }}</div>
          <div v-if="distroChoice" class="hint">
            {{ distros.find((d) => d.name === distroChoice)?.family }} 方言 ·
            保留分区 {{ KEEP_LABEL[distros.find((d) => d.name === distroChoice)?.keep_partition_support ?? ''] ?? '—' }}
          </div>
        </el-form-item>

        <el-form-item label="存储">
          <el-radio-group v-model="storageMode" :disabled="isWindows">
            <el-radio-button value="preset">{{ isWindows ? '最大盘整盘 NTFS（windows 固定）' : '整盘擦除最大盘（推荐预设）' }}</el-radio-button>
            <el-radio-button v-if="!isWindows" value="custom">自定义磁盘布局</el-radio-button>
          </el-radio-group>
          <div v-if="storageMode === 'preset' && !isWindows" class="hint">
            预设 = 最大盘全盘擦除：512M EFI + 4G swap + 其余 xfs 挂 /。
          </div>
          <div v-else-if="isWindows" class="hint">
            windows 方言：单盘 NTFS 布局由引擎固定生成（多盘/软件 RAID/硬件 RAID 卷均不支持）。
          </div>
          <div v-else style="width: 100%; margin-top: 8px">
            <el-card v-for="(d, di) in disks" :key="di" shadow="never" class="disk-block">
              <div class="disk-head">
                <el-select v-model="d.selector" style="width: 170px">
                  <el-option v-for="(label, key) in SELECTOR_LABEL" :key="key" :value="key" :label="label" />
                </el-select>
                <el-radio-group v-model="d.action" size="small">
                  <el-radio-button value="wipe">擦除并重装分区</el-radio-button>
                  <el-radio-button value="keep_disk">保留整盘</el-radio-button>
                </el-radio-group>
                <el-button
                  type="danger"
                  plain
                  size="small"
                  :icon="Delete"
                  :disabled="disks.length === 1"
                  @click="disks.splice(di, 1)"
                />
              </div>
              <div v-if="d.action === 'wipe'" class="part-editor">
                <div v-for="(p, pi) in d.partitions" :key="pi" class="part-row">
                  <el-input v-model="p.size" placeholder="大小（512M / rest）" style="width: 150px" class="mono" />
                  <el-select v-model="p.fs" style="width: 110px">
                    <el-option v-for="f in FS_OPTIONS" :key="f" :value="f" :label="f" />
                  </el-select>
                  <el-input v-model="p.mount" placeholder="挂载点，如 /" style="width: 180px" class="mono" />
                  <el-button type="danger" plain :icon="Delete" @click="d.partitions.splice(pi, 1)" />
                </div>
                <el-button size="small" @click="addPartition(d)">+ 添加分区</el-button>
              </div>
              <div v-else class="hint">保留整盘：不触碰该盘上的任何数据。</div>
            </el-card>
            <el-button size="small" @click="addDisk">+ 添加磁盘</el-button>
          </div>
        </el-form-item>

        <el-form-item label="网络">
          <el-radio-group v-model="netMode">
            <el-radio-button value="auto">自动（装机环境 DHCP）</el-radio-button>
            <el-radio-button value="static">静态配置</el-radio-button>
          </el-radio-group>
          <div v-if="netMode === 'static'" style="width: 100%; margin-top: 8px">
            <div v-for="(n, i) in nics" :key="i" class="net-block">
              <!-- 普通网卡 -->
              <template v-if="n.kind === 'nic'">
                <div class="repo-row">
                  <el-tag size="small" effect="plain" class="kind-tag">网卡</el-tag>
                  <el-input v-model="n.mac" placeholder="网卡 MAC" class="mono" style="width: 190px" />
                  <el-input v-model="n.ip" placeholder="IP/位，如 10.0.0.5/24" class="mono" style="width: 180px" />
                  <el-input v-model="n.gateway" placeholder="网关（可选）" class="mono" style="width: 160px" />
                  <el-input v-model="n.dns" placeholder="DNS，逗号分隔（可选）" class="mono" style="width: 180px" />
                  <el-button type="danger" plain :icon="Delete" @click="nics.splice(i, 1)" />
                </div>
              </template>
              <!-- bond -->
              <template v-else>
                <div class="repo-row">
                  <el-tag size="small" type="warning" effect="plain" class="kind-tag">bond</el-tag>
                  <el-input v-model="n.name" placeholder="bond0" class="mono" style="width: 110px" />
                  <el-select v-model="n.mode" style="width: 170px">
                    <el-option v-for="m in BOND_MODES" :key="m" :value="m" :label="m" />
                  </el-select>
                  <el-input v-model="n.ip" placeholder="IP/位（可选）" class="mono" style="width: 180px" />
                  <el-input v-model="n.gateway" placeholder="网关（可选）" class="mono" style="width: 150px" />
                  <el-button type="danger" plain :icon="Delete" @click="nics.splice(i, 1)" />
                </div>
                <div class="bond-members">
                  <div class="text-muted" style="font-size: 12px; width: 100%">成员网卡 MAC（按 miimon 链路监测）：</div>
                  <div v-for="(_m, mi) in n.memberMacs" :key="mi" class="repo-row">
                    <el-input v-model="n.memberMacs[mi]" placeholder="成员网卡 MAC" class="mono" style="width: 240px" />
                    <el-button type="danger" plain size="small" :icon="Delete" @click="n.memberMacs.splice(mi, 1)" />
                  </div>
                  <el-button size="small" @click="n.memberMacs.push('')">+ 成员</el-button>
                  <el-input v-model="n.miimon" placeholder="miimon(ms)" class="mono" style="width: 130px" />
                  <el-input v-model="n.paramsRaw" placeholder='高级参数 JSON，如 {"lacp_rate":"fast"}' class="mono" style="width: 320px" />
                </div>
              </template>
            </div>
            <div class="net-add">
              <el-button size="small" @click="addNic">+ 添加网卡</el-button>
              <el-button size="small" :disabled="!bondSupported || isWindows" @click="addBond">+ 添加 bond</el-button>
              <el-button size="small" :disabled="!bondSupported || isWindows" @click="addVlan">+ 添加 VLAN</el-button>
            </div>
            <div v-if="!bondSupported" class="hint" style="color: #e6a23c">
              Debian 方言不支持 bond/VLAN（引擎渲染即拒）；如需 bond 请改用 Rocky/Ubuntu 系列。
            </div>
            <div v-else-if="isWindows" class="hint" style="color: #e6a23c">
              Windows 方言不支持 bond/VLAN；静态网络仅支持单网卡（MAC 绑定）。
            </div>
            <template v-if="vlans.length > 0">
              <div class="text-muted" style="font-size: 12px; margin-top: 10px">VLAN 子接口：</div>
              <div v-for="(v, i) in vlans" :key="'v' + i" class="repo-row">
                <el-tag size="small" type="warning" effect="plain" class="kind-tag">VLAN</el-tag>
                <el-input v-model="v.id" placeholder="VLAN ID" class="mono" style="width: 110px" />
                <el-input v-model="v.link" placeholder="挂在哪个接口（bond0）" class="mono" style="width: 200px" />
                <el-input v-model="v.ip" placeholder="IP/位" class="mono" style="width: 180px" />
                <el-button type="danger" plain :icon="Delete" @click="vlans.splice(i, 1)" />
              </div>
            </template>
          </div>
          <div v-else class="hint">不配置则由装机环境 DHCP 分配网络。</div>
        </el-form-item>

        <el-form-item label="主机名模式（可选）">
          <el-input v-model="hostnamePattern" placeholder="如 node-{index} → node-1、node-2…" style="width: 320px" />
          <div class="hint">
            仅支持 {index} 变量：按上方勾选顺序替换为 1、2、3…（1 起）。不含 {index} 时所有机器同名（不推荐）。
            逐台固定名暂不支持——引擎的提交接口可按机器单独覆盖，向导会在后续版本提供 CSV 导入。
          </div>
        </el-form-item>

        <el-form-item :label="isWindows ? '管理员密码（Administrator）' : 'root 密码'">
          <div class="inline-row">
            <el-radio-group v-model="rootMode">
              <el-radio-button value="random">按任务随机（推荐）</el-radio-button>
              <el-radio-button value="manual">手动指定</el-radio-button>
            </el-radio-group>
            <el-input
              v-if="rootMode === 'manual'"
              v-model="rootPassword"
              type="password"
              show-password
              :placeholder="isWindows ? '管理员密码' : 'root 密码'"
              style="width: 240px"
            />
          </div>
          <div class="hint">随机模式下，密码将在装机完成时经一次性事件弹出，仅此一次，请留意保存。</div>
        </el-form-item>

        <el-form-item v-if="!isWindows" label="SSH 公钥（可选；写入装好系统的 root authorized_keys，用于人工登录）">
          <div style="width: 100%">
            <div v-for="(_k, i) in sshKeys" :key="i" class="repo-row">
              <el-input v-model="sshKeys[i]" placeholder="ssh-ed25519 AAAA… user@host" class="mono" style="flex: 1" />
              <el-button type="danger" plain :icon="Delete" @click="sshKeys.splice(i, 1)" />
            </div>
            <el-button size="small" @click="addSshKey">+ 添加公钥</el-button>
            <div class="hint">注意：这里的公钥是给你登录用的；「凭证」页的 SSH 私钥是引擎做带内盘查的认证凭据，两者互不相干。</div>
          </div>
        </el-form-item>

        <el-form-item v-if="isWindows" label="开启远程管理能力（opt-in，缺省全关）">
          <el-checkbox-group v-model="winCaps">
            <el-checkbox value="rdp">远程桌面（RDP）</el-checkbox>
            <el-checkbox value="winrm">WinRM 远程管理</el-checkbox>
            <el-checkbox value="ping">ICMP ping</el-checkbox>
          </el-checkbox-group>
          <div class="hint">全新系统默认不开任何入站管理面；按需开启是运营者的安全决策。</div>
        </el-form-item>

        <el-form-item v-if="!isWindows" label="软件源（package_source，可选）">
          <div style="width: 100%">
            <div v-for="(r, idx) in repos" :key="idx" class="repo-row">
              <el-input v-model="r.name" placeholder="name" style="width: 130px" class="mono" />
              <el-input v-model="r.url" placeholder="http(s)://repo-url" style="flex: 1" class="mono" />
              <el-input v-model="r.gpg_key_url" placeholder="GPG key URL（可选）" style="width: 200px" class="mono" />
              <el-input v-model="r.suite" placeholder="suite" style="width: 90px" class="mono" />
              <el-input v-model="r.components" placeholder="components" style="width: 110px" class="mono" />
              <el-button type="danger" plain :icon="Delete" @click="removeRepo(idx)" />
            </div>
            <el-button size="small" @click="addRepo">+ 添加软件源</el-button>
          </div>
        </el-form-item>

        <el-form-item :label="isWindows ? '脚本（Windows：装后走引擎托管首启链；装前仅 setup 通路的 WinPE）' : '脚本'">
          <div style="width: 100%">
            <el-card v-for="(sc, i) in scripts" :key="i" shadow="never" class="script-block">
              <div class="script-head">
                <el-select v-model="sc.stage" style="width: 240px">
                  <el-option label="装前执行（pre_install）" value="pre_install" />
                  <el-option label="装后执行（post_install）" value="post_install" />
                </el-select>
                <el-select v-if="isWindows" v-model="sc.shell" style="width: 170px">
                  <el-option label="cmd 批处理" value="cmd" />
                  <el-option label="PowerShell" value="powershell" />
                </el-select>
                <el-button type="danger" plain :icon="Delete" @click="scripts.splice(i, 1)" />
              </div>
              <el-input
                v-model="sc.content"
                type="textarea"
                :rows="4"
                class="mono"
                placeholder="#!/bin/sh …（明文，提交时自动按引擎要求转 base64）"
              />
            </el-card>
            <el-button size="small" @click="addScript">+ 添加脚本</el-button>
          </div>
        </el-form-item>

        <el-form-item label="引导方式">
          <el-radio-group
            v-model="spec.boot!.strategy"
            :disabled="isWindows && policyDraftInstaller === 'agent'"
          >
            <el-radio-button value="virtual_media">虚拟介质</el-radio-button>
            <el-radio-button value="pxe">PXE</el-radio-button>
          </el-radio-group>
          <div v-if="spec.boot?.strategy === 'pxe' && !conn.capabilities?.netboot_enabled" class="hint" style="color: #e6a23c">
            引擎未启用 netboot，PXE 提交会被拒绝。
          </div>
        </el-form-item>

        <el-form-item v-if="isWindows" label="安装通路（windows 专用）">
          <el-radio-group v-model="policyDraftInstaller">
            <el-radio-button value="auto">自动（按部署事实）</el-radio-button>
            <el-radio-button value="setup">setup（需 SMB 导出）</el-radio-button>
            <el-radio-button value="agent">agent（PXE-only，无需 SMB）</el-radio-button>
          </el-radio-group>
          <div class="hint">
            Windows 仅支持 UEFI 引导。setup = setup.exe 黑盒，依赖部署层 SMB 导出（MAMMOTH_WINDOWS_INSTALL_SMB_UNC）；
            agent = alpine agent wimlib 铺盘，依赖 extended ISO 池 + PXE（无需 SMB）。
            当前部署：SMB 导出 {{ conn.capabilities?.windows_smb_share ? '已配置' : '未配置' }} ·
            agent 通路 {{ conn.capabilities?.windows_agent_installer ? '可用' : '不可用' }}。
          </div>
        </el-form-item>
      </el-form>

      <div class="step-actions">
        <el-button @click="back">上一步</el-button>
        <el-button type="primary" @click="next">下一步：试算预览</el-button>
      </div>
    </el-card>

    <!-- Step 3 -->
    <el-card v-else-if="step === 3" shadow="never" v-loading="planning">
      <template v-if="planning">正在对 {{ readyTargets.length }} 台机器运行只读试算…</template>
      <template v-else>
        <div v-for="r in planResults" :key="r.machineId" class="plan-block">
          <div class="plan-head">
            <span class="mono">{{ r.machineId }}</span>
            <el-tag v-if="r.ok" type="success" size="small">试算通过</el-tag>
            <el-tag v-else type="danger" size="small">试算失败</el-tag>
          </div>
          <template v-if="r.ok && r.plan">
            <el-alert
              v-for="(w, i) in r.plan.warnings ?? []"
              :key="i"
              :title="w"
              type="warning"
              :closable="false"
              class="plan-warning"
            />
            <el-table :data="r.plan.resolved_disks" size="small">
              <el-table-column prop="device" label="设备" width="110" />
              <el-table-column label="serial" min-width="150">
                <template #default="{ row }"><span class="mono">{{ row.serial || '—' }}</span></template>
              </el-table-column>
              <el-table-column label="容量" width="110">
                <template #default="{ row }">{{ formatBytes(row.size_bytes) }}</template>
              </el-table-column>
              <el-table-column label="保留" width="80">
                <template #default="{ row }">{{ row.keep ? '是' : '否' }}</template>
              </el-table-column>
              <el-table-column label="计划分区" min-width="220">
                <template #default="{ row }">
                  <span class="mono" style="font-size: 11px">
                    {{ (row.planned_partitions || []).map((p: { number: number; mount: string }) => `${p.number}:${p.mount}`).join(' ') }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </template>
          <el-alert v-else-if="!r.ok" :title="r.error" type="error" :closable="false" class="plan-warning" />
        </div>
        <div class="step-actions">
          <el-button @click="back">上一步</el-button>
          <el-button type="primary" :disabled="!planAllOk" @click="step = 4">下一步：执行策略</el-button>
        </div>
      </template>
    </el-card>

    <!-- Step 4 -->
    <el-card v-else-if="step === 4" shadow="never">
      <el-form label-position="top" style="max-width: 560px">
        <el-form-item label="并发数">
          <el-input-number v-model="policy.concurrency" :min="1" :max="100" />
        </el-form-item>
        <el-form-item label="单机失败后">
          <el-radio-group v-model="policy.on_task_failure">
            <el-radio-button value="continue">继续其余机器</el-radio-button>
            <el-radio-button value="abort_batch">中止整批</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="单机超时（秒）">
          <el-input-number v-model="policy.task_timeout_seconds" :min="60" :step="300" />
        </el-form-item>
        <el-form-item label="装前健康门禁（依据内存盘探针的逐盘 smartctl/nvme 读数）">
          <el-radio-group v-model="policy.health_gate">
            <el-radio-button value="off">关闭</el-radio-button>
            <el-radio-button value="report">报告</el-radio-button>
            <el-radio-button value="block">拦截</el-radio-button>
          </el-radio-group>
          <div class="hint">{{ HEALTH_GATE_DESC[policy.health_gate] }}</div>
        </el-form-item>
      </el-form>
      <div class="step-actions">
        <el-button @click="back">上一步</el-button>
        <el-button type="primary" :loading="submittingJob" @click="submit">
          提交装机任务（{{ readyTargets.length }} 台）
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.step-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
}
.plan-block {
  margin-bottom: 16px;
}
.plan-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.plan-warning {
  margin-bottom: 8px;
}
.repo-row,
.part-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  width: 100%;
}
.inline-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hint {
  margin-top: 6px;
  width: 100%;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}
.disk-block,
.script-block {
  margin-bottom: 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}
.disk-head,
.script-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.part-editor {
  margin: 8px 0;
}
.part-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.mono :deep(input),
.mono :deep(textarea),
.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.net-block {
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  margin-bottom: 8px;
}
.bond-members {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-left: 14px;
}
.net-add {
  display: flex;
  gap: 6px;
}
.kind-tag {
  flex-shrink: 0;
}
</style>
