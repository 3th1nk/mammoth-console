<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { LoaderCircle, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import ComboInput from '@/components/ComboInput.vue'
import NumberInput from '@/components/NumberInput.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { machineWizardTargetsKey, imageWizardKey, jobDomain } from '@/api/queryKeys'
import type { components } from '@/api/types.gen'
import { useConnectionStore } from '@/stores/connection'
import DistroBadge from '@/components/DistroBadge.vue'
import StateBadge from '@/components/StateBadge.vue'
import { resolveDistroKey } from '@/utils/distro'
import { formatBytes } from '@/utils/format'
import { uuid } from '@/utils/uuid'

type InstallSpec = components['schemas']['InstallSpec']
type Machine = components['schemas']['Machine']

const { t } = useI18n()
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
  queryKey: machineWizardTargetsKey(machineIds.value),
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
// 可选发行版 = 引擎 user_facing 标记的过滤面(bootc 冻结 / alpine agent 无
// 表单形态的通路驱动按契约退出,能力仍走 API);全量 distros 保留给族查询
const selectableDistros = computed(() => distros.value.filter((d) => d.user_facing !== false))
// dd 是通路不是发行版,沉底下拉末位——常规发行版是主流程,特殊通路垫底
const orderedDistros = computed(() => {
  const rest = selectableDistros.value.filter((d) => d.name !== 'dd')
  const dd = selectableDistros.value.find((d) => d.name === 'dd')
  return dd ? [...rest, dd] : rest
})
const bootDefault = computed(() => conn.capabilities?.boot_strategy_default ?? 'virtual_media')
// 引导证据等待窗(headless,docs/13 §4):0 = 引擎缺省(10m)
const evidenceWait = computed({
  get: () => spec.boot?.evidence_wait_seconds ?? 0,
  set: (v: number | undefined) => {
    spec.boot!.evidence_wait_seconds = v ?? 0
  },
})

const spec = reactive<InstallSpec>({
  image: { distro: '', format: 'raw.gz' },
  // evidence_wait_seconds:0 = 引擎缺省(10m 等待窗)——生成器把带 default 的
  // 字段标成必填(openapi-typescript 已知坑,docs/03 §199),显式给缺省值。
  boot: { strategy: bootDefault.value, installer: 'auto', evidence_wait_seconds: 0 },
})

const distroChoice = computed({
  get: () => spec.image.distro,
  set: (v: string) => {
    spec.image.distro = v
  },
})

const isWindows = computed(() => spec.image.distro.toLowerCase().includes('win'))
// 镜像直写通路(image.distro=dd,docs/09「镜像直写通路」):整盘镜像流式写盘
const isDD = computed(() => spec.image.distro === 'dd')
// headless 目标(protocol=none):装机网段需 PXE,boot 强制 pxe;
// 引导等待窗(boot.evidence_wait_seconds)默认引擎值 10m
const headlessTargets = computed(() => readyTargets.value.filter((r) => (r.machine as any).bmc?.protocol === 'none'))
const hasHeadlessTarget = computed(() => headlessTargets.value.length > 0)
const distroFamily = computed(() => distros.value.find((x) => x.name === spec.image.distro)?.family)
const isDebian = computed(() => distroFamily.value === 'preseed')

// windows 选中/取消时收敛启动策略：UEFI-only 且 agent 通路 PXE-only
watch(isWindows, (win) => {
  if (win && spec.boot?.strategy !== 'pxe') spec.boot!.strategy = 'virtual_media'
})
watch(hasHeadlessTarget, (h) => {
  if (h) spec.boot!.strategy = 'pxe' // 无带外机器只能 PXE + 引导证据等待
})

// ── 镜像：库选择 / 内联 ────────────────────────────────────────────────────
const imageMode = ref<'library' | 'inline'>('library')
// dd 镜像压缩(docs/09):raw.gz = busybox 原生解压(推荐交付),raw 零依赖。
// 压缩格式是机器侧运行时选解压器的依据(引擎解析期按注册件的 magic bytes
// 识别交叉校验),表单随注册镜像的扩展名预置、可手动改。
const imageFormat = ref<'raw' | 'raw.gz' | 'raw.xz'>('raw.gz')

// 注册件扩展名 → 压缩格式预置:.xz → raw.xz、.gz → raw.gz、其余 raw
function formatForSource(url?: string): 'raw' | 'raw.gz' | 'raw.xz' {
  const path = (url ?? '').split('?')[0]!.toLowerCase()
  if (path.endsWith('.xz')) return 'raw.xz'
  if (path.endsWith('.gz')) return 'raw.gz'
  return 'raw'
}
const imagesQuery = useQuery({
  queryKey: imageWizardKey,
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
    autoDistroHint.value = t('wizard.autoDistroNoDriver', { distro: img.distro })
    return
  }
  let picked = candidates[0]!
  if (candidates.length > 1 && img.version) {
    const major = img.version.match(/\d+/)?.[0]
    const byMajor = major ? candidates.find((d) => d.name.replace(/[^\d]/g, '') === major) : undefined
    if (byMajor) picked = byMajor
  }
  spec.image.distro = picked.name
  // dd:压缩格式随注册镜像的扩展名预置(.img.xz → raw.xz…),不是默认 raw.gz
  if (picked.name === 'dd') imageFormat.value = formatForSource(img.source_url)
  autoDistroHint.value = t('wizard.autoDistroPicked', { name: picked.name })
})

// 手动把发行版切到 dd 且库镜像在场：压缩格式同样随镜像预置
watch(distroChoice, (v) => {
  if (v !== 'dd' || imageMode.value !== 'library' || !chosenImageId.value) return
  const img = readyImages.value.find((i) => i.id === chosenImageId.value)
  if (img) imageFormat.value = formatForSource(img.source_url)
})

// 切到内联时带上所选注册件的事实（地址 + 校验和），不留空白表单：
// dd 的校验和语义是未压缩镜像的 SHA256（docs/09），优先取引擎识别出的
// 未压缩摘要（raw_sha256）；普通介质校验和就是注册文件本身的摘要。
watch(imageMode, (mode) => {
  const reg = readyImages.value.find((i) => i.id === chosenImageId.value)
  if (mode === 'inline' && reg) {
    spec.image.source = reg.source_url
    spec.image.checksum = isDD.value
      ? `sha256:${reg.raw_sha256 || reg.sha256}`
      : `sha256:${reg.sha256}`
    if (isDD.value) imageFormat.value = formatForSource(reg.source_url)
  }
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


// ── 存储：标准分区 / 自定义分区 / LVM 卷组（三档同轴：按产出布局形态命名） ──
const storageMode = ref<'standard' | 'custom' | 'lvm'>('standard')
type SelectorKind = 'largest' | 'smallest' | 'ssd' | 'hdd' | 'nvme'
interface PartitionRow { size: string; fs: string; mount: string }
interface DiskRow {
  selector: SelectorKind
  action: 'wipe' | 'keep_disk'
  partitions: PartitionRow[]
}

const SELECTOR_LABEL = computed<Record<SelectorKind, string>>(() => ({
  largest: t('wizard.selectorLargest'),
  smallest: t('wizard.selectorSmallest'),
  ssd: 'SSD',
  hdd: 'HDD',
  nvme: 'NVMe',
}))
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

// LVM 卷组（storage.lvm，docs/04 §5.1.1）：本档自带固定引导盘声明（最大盘
// ESP + kickstart 族 /boot），根分区建在卷组逻辑卷上。PV 默认整盘消费，与
// 磁盘声明互斥；「引导盘同盘」= 单盘布局——PV 占系统盘声明分区之外的剩余
// 空间（引擎分区切出语义，docs/04 §5.1.1），单盘机器即选它。
// 保留模式(keep:vg)整组采用既有卷组，只声明挂载意图。
// debian(partman)无 PV 行（单目标 = 最大盘，buildSpec 自动接线）。
const PV_SELECTOR_OPTIONS = Object.keys(SELECTOR_LABEL.value) as SelectorKind[]
const PV_SELECTOR_LABEL = computed<Record<SelectorKind, string>>(() => ({
  ...SELECTOR_LABEL.value,
  largest: t('wizard.pvBootDisk'),
}))
interface LvRow { name: string; size: string; fs: string; mount: string }
interface PreserveRow { name: string; mount: string; fs: string }
interface VgRow {
  name: string
  mode: 'fresh' | 'keep'
  pvs: { selector: SelectorKind }[]
  logvols: LvRow[]
  preserve: PreserveRow[]
}

const vgs = ref<VgRow[]>([])

function addVg() {
  vgs.value.push({
    name: '',
    mode: 'fresh',
    pvs: [{ selector: 'smallest' }],
    logvols: [{ name: 'root', size: 'rest', fs: 'xfs', mount: '/' }],
    preserve: [],
  })
}
function addPv(g: VgRow) {
  g.pvs.push({ selector: 'smallest' })
}
function addLv(g: VgRow) {
  g.logvols.push({ name: '', size: '100G', fs: 'xfs', mount: '' })
}
function addPreserve(g: VgRow) {
  g.preserve.push({ name: '', mount: '', fs: '' })
}

// ── 网络：默认静态（网卡 + bond + vlan） / 自动（装机环境 DHCP） ─────────────
const netMode = ref<'auto' | 'static'>('static')
// 方言边界（docs/04 §5.4 矩阵）：debian 不支持 bond/vlan，前端即时预禁
const distroName = computed(() => spec.image.distro)
const bondSupported = computed(() => !distroName.value.toLowerCase().includes('debian'))

type MatchKey = 'mac' | 'name' | 'pci_address'
interface BaseIface { key: string; ip: string; gateway: string; dns: string; mtu?: number }
interface NicRow extends BaseIface { kind: 'nic'; matchKey: MatchKey; matchValue: string }
interface BondRow extends BaseIface { kind: 'bond'; mode: string; miimon: string; memberKey: MatchKey; memberValues: string[]; paramsRaw: string }
type NetRow = NicRow | BondRow

// 匹配键与引擎 InterfaceMatch 同源（稳定序 mac > pci_address > name）；
// 批量共享 spec 时按键取各目标机该键值的交集。
const MATCH_KEYS: MatchKey[] = ['mac', 'name', 'pci_address']
const MATCH_KEY_LABEL = computed<Record<MatchKey, string>>(() => ({
  mac: 'MAC',
  name: t('wizard.matchName'),
  pci_address: t('wizard.matchPci'),
}))

// 与引擎白名单（docs/04 §5.2）一致：七种内核模式
const BOND_MODES = ['active-backup', '802.3ad', 'balance-tlb', 'balance-rr', 'balance-xor', 'broadcast', 'balance-alb']

const nics = ref<NetRow[]>([])
const vlans = ref<{ key: string; id: string; link: string; ip: string }[]>([])

function addNic() {
  nics.value.push({ kind: 'nic', key: uuid(), ...suggestedMatch(), ip: '', gateway: '', dns: '' })
}
function addBond() {
  nics.value.push({ kind: 'bond', key: uuid(), mode: 'active-backup', miimon: '100', memberKey: 'mac', memberValues: ['', ''], paramsRaw: '', ip: '', gateway: '', dns: '' })
}
function addVlan() {
  vlans.value.push({ key: uuid(), id: '', link: 'bond0', ip: '' })
}

// ── 批量静态地址：逐台矩阵（docs/04 §5.0 bindings） ─────────────────────────
// spec 是共享模板，地址以 {var:ip_*} 占位；每台的真实 IP/主机名走
// JobTargets.targets[].vars 提交，引擎在提交期逐台解析。
const isBatchStatic = computed(() => netMode.value === 'static' && readyTargets.value.length > 1)

interface MatrixCol { key: string; varName: string; label: string }
const shortVal = (s: string) => (s.length > 20 ? s.slice(0, 18) + '…' : s)
// 参与分配的接口列：网卡需有匹配值、bond 需有成员、VLAN 需有 ID；
// varName 即模板占位名，buildSpec 与 machineVars 共用这一份序列，不会漂移
const matrixColumns = computed<MatrixCol[]>(() => {
  if (!isBatchStatic.value) return []
  const cols: MatrixCol[] = []
  let nicSeq = 0, bondSeq = 0, vlanSeq = 0
  for (const n of nics.value) {
    if (n.kind === 'nic') {
      if (!n.matchValue.trim()) continue
      cols.push({ key: n.key, varName: `ip_nic${++nicSeq}`, label: `${t('wizard.nic')} · ${shortVal(n.matchValue)}` })
    } else {
      if (n.memberValues.every((m) => !m.trim())) continue
      cols.push({ key: n.key, varName: `ip_bond${++bondSeq}`, label: bondNameOf(n) })
    }
  }
  for (const v of vlans.value) {
    if (!v.id.trim()) continue
    cols.push({ key: v.key, varName: `ip_vlan${++vlanSeq}`, label: `VLAN ${v.id}` })
  }
  return cols
})

const ipMatrix = ref<Record<string, Record<string, string>>>({})
const hostnameMatrix = ref<Record<string, string>>({})

function matrixCell(mid: string, key: string): string {
  return ipMatrix.value[mid]?.[key] ?? ''
}
function setMatrixCell(mid: string, key: string, v: string) {
  if (!ipMatrix.value[mid]) ipMatrix.value[mid] = {}
  ipMatrix.value[mid]![key] = v
}

const batchHostnameUsed = computed(() =>
  readyTargets.value.some((r) => (hostnameMatrix.value[r.machine.id] ?? '').trim() !== ''),
)

// 单台机器的绑定表：模板里每个 {var:*} 各得一行；无矩阵时无 vars
function machineVars(mid: string): Record<string, string> | undefined {
  if (!isBatchStatic.value) return undefined
  const vars: Record<string, string> = {}
  for (const col of matrixColumns.value) vars[col.varName] = matrixCell(mid, col.key)
  if (batchHostnameUsed.value) vars.hostname = (hostnameMatrix.value[mid] ?? '').trim()
  return vars
}

// 从各列第一台的值递增最后一字节（IPv4），填满整列
function fillIncremental() {
  const targets = readyTargets.value
  if (targets.length === 0) return
  for (const col of matrixColumns.value) {
    const first = matrixCell(targets[0]!.machine.id, col.key).trim()
    const m = first.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(\/\d+)?$/)
    if (!m) continue
    const out: string[] = []
    let ok = true
    for (let i = 0; i < targets.length; i++) {
      const o4 = Number(m[4]) + i
      if (o4 > 254) { ok = false; break }
      out.push(`${m[1]}.${m[2]}.${m[3]}.${o4}${m[5] ?? ''}`)
    }
    if (ok) targets.forEach((t, i) => setMatrixCell(t.machine.id, col.key, out[i]!))
  }
}

// 引擎按声明顺序命名 bond（render.BondName：bond0、bond1…，与行位置无关）——
// 名称是派生事实不是用户输入；VLAN 挂载名（vlan.link）引用这里的派生名。
function bondNameOf(n: NetRow): string {
  let seq = 0
  for (const row of nics.value) {
    if (row.kind !== 'bond') continue
    if (row === n) return `bond${seq}`
    seq++
  }
  return 'bond0'
}

// ── 静态网卡自动填充：目标机盘查（hardware.nics）作为匹配值下拉数据源 ────────
// spec.network 为批量目标机共享一份，每个匹配键取各机该键值的交集；
// 已连接（link_up）的排前面。「+ 添加网卡」按 MAC → 网卡名 → PCI 地址顺序
// 取第一块未被占用的，MAC 交集为空时自动降级到名称/PCI 匹配。
interface NicOption { value: string; mac?: string; name?: string; speed_mbps?: number; link_up: boolean }

const nicOptionsByKey = computed<Record<MatchKey, NicOption[]>>(() => {
  const out: Record<MatchKey, NicOption[]> = { mac: [], name: [], pci_address: [] }
  const rows = readyTargets.value
  if (rows.length === 0) return out
  const lists = rows.map((r) => r.machine.hardware?.nics ?? [])
  for (const key of MATCH_KEYS) {
    const seen = new Set<string>()
    for (const nic of lists[0] ?? []) {
      const value = nic[key]
      if (!value || seen.has(value)) continue
      seen.add(value)
      const everywhere = lists.map((l) => l.find((n) => n[key] === value))
      if (everywhere.some((m) => !m)) continue
      out[key].push({
        value,
        // 多台机器取值不同时聚合展示，如 MAC 键下各机名称不同 → "eno1/ens1f0"
        mac: [...new Set(everywhere.map((n) => n!.mac).filter(Boolean))].join('/') || undefined,
        name: [...new Set(everywhere.map((n) => n!.name))].join('/'),
        speed_mbps: everywhere[0]!.speed_mbps,
        link_up: everywhere.every((n) => n!.link_up === true),
      })
    }
    out[key].sort((a, b) => Number(b.link_up) - Number(a.link_up))
  }
  return out
})

// 提示为空的具体原因：一台都没盘查出网卡 vs 多台机器没有共同匹配项
const anyTargetNics = computed(() =>
  readyTargets.value.some((r) => (r.machine.hardware?.nics ?? []).length > 0),
)

const nicInventoryHint = computed<string | null>(() => {
  if (netMode.value !== 'static') return null
  if (MATCH_KEYS.some((k) => nicOptionsByKey.value[k].length > 0)) return null
  return anyTargetNics.value
    ? t('wizard.nicHintNoCommon')
    : t('wizard.nicHintNoInventory')
})

function speedLabel(mbps: number): string {
  return mbps >= 1000 ? `${mbps / 1000}G` : `${mbps}M`
}

// 下拉项详情：隐藏正被用作匹配键的字段，展示其余（名称/MAC/速率/Up）
function nicOptionDetail(key: MatchKey, o: NicOption): string {
  const parts: string[] = []
  if (key !== 'name' && o.name) parts.push(o.name)
  if (key !== 'mac' && o.mac) parts.push(o.mac)
  if (o.speed_mbps) parts.push(speedLabel(o.speed_mbps))
  if (o.link_up) parts.push('Up')
  return parts.join(' · ')
}

function matchPlaceholder(key: MatchKey): string {
  return key === 'mac' ? t('wizard.matchPlaceholderMac') : key === 'name' ? t('wizard.matchPlaceholderName') : t('wizard.matchPlaceholderPci')
}

function matchByKey(key: MatchKey, value: string): components['schemas']['InterfaceMatch'] {
  return key === 'mac' ? { mac: value } : key === 'name' ? { name: value } : { pci_address: value }
}

// 已被其他行（含 bond 成员）占用的「键:值」，避免两行配到同一块网卡
function usedMatchValues(self?: NetRow): Set<string> {
  return new Set(
    nics.value
      .filter((r) => r !== self)
      .flatMap((r) =>
        r.kind === 'nic'
          ? [`${r.matchKey}:${r.matchValue.trim().toLowerCase()}`]
          : r.memberValues.map((m) => `${r.memberKey}:${m.trim().toLowerCase()}`),
      ),
  )
}

// 下一行建议网卡：按 MAC → 网卡名 → PCI 地址取第一个未占用项；windows 仅 MAC（方言限 MAC 绑定）
function suggestedMatch(): { matchKey: MatchKey; matchValue: string } {
  const used = usedMatchValues()
  const keys: MatchKey[] = isWindows.value ? ['mac'] : MATCH_KEYS
  for (const key of keys) {
    const opt = nicOptionsByKey.value[key].find((o) => !used.has(`${key}:${o.value.toLowerCase()}`))
    if (opt) return { matchKey: key, matchValue: opt.value }
  }
  return { matchKey: 'mac', matchValue: '' }
}

// 切换匹配方式：当前值仍有效则保留，否则带出新键下第一个未占用项（无则清空）
function onMatchKeyChange(n: NicRow) {
  const opts = nicOptionsByKey.value[n.matchKey]
  if (opts.some((o) => o.value === n.matchValue.trim())) return
  const used = usedMatchValues(n)
  n.matchValue = opts.find((o) => !used.has(`${n.matchKey}:${o.value.toLowerCase()}`))?.value ?? ''
}

function onMemberKeyChange(n: BondRow) {
  const opts = new Set(nicOptionsByKey.value[n.memberKey].map((o) => o.value))
  n.memberValues = n.memberValues.map((m) => (opts.has(m.trim()) ? m : ''))
}

// 静态为默认且盘查数据异步晚到：初始立即起步一行；数据到达后仅为仍为空的匹配值
// 补建议网卡（手动输入的自定义值不在清单里，不能被清单刷新冲掉）
watch([netMode, nicOptionsByKey], ([mode]) => {
  if (mode !== 'static') return
  if (nics.value.length === 0) {
    addNic()
    return
  }
  for (const n of nics.value) {
    if (n.kind !== 'nic' || n.matchValue.trim()) continue
    const used = usedMatchValues(n)
    n.matchValue = nicOptionsByKey.value[n.matchKey].find(
      (o) => !used.has(`${n.matchKey}:${o.value.toLowerCase()}`),
    )?.value ?? ''
  }
}, { immediate: true })

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
  const image: InstallSpec['image'] = { distro: spec.image.distro, format: spec.image.format ?? 'raw.gz' }
  if (imageMode.value === 'library' && chosenImageId.value) {
    if (opts.forPlan) {
      const reg = readyImages.value.find((i) => i.id === chosenImageId.value)
      if (reg) {
        image.source = reg.source_url
        // dd 的校验和语义是未压缩镜像的 SHA256(docs/09)——试算镜像提交时
        // 的引擎解析,优先取引擎识别出的未压缩摘要;普通介质用注册件摘要
        const digest = isDD.value ? (reg.raw_sha256 || reg.sha256) : reg.sha256
        image.checksum = `sha256:${digest}`
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
  if (isDD.value) {
    // dd(docs/09):format 是通路字段(生成器把带 default 的字段标为必填,
    // 而契约本无 required——固定携带);checksum 是通路硬前置,但仅内联
    // 模式由表单携带——库镜像模式交给引擎解析(注册件识别出的未压缩摘要)
    ;(image as InstallSpec['image']).format = imageFormat.value
    if (imageMode.value === 'inline' && spec.image.checksum) image.checksum = spec.image.checksum
  }
  const out: InstallSpec = { image }

  // 存储
  if (isDD.value) {
    // dd:整盘镜像自带分区表——单目标盘 wipe,无分区声明(引擎诚实拒分区)
    out.storage = {
      alignment: '4k',
      disks: [{ select: { match: { size: 'largest' } }, wipe: true }],
    }
  } else if (isWindows.value) {
    // windows：单目标盘 NTFS，布局由方言渲染固定生成（contract: 多盘/RAID ❌）
    out.storage = {
      alignment: '4k',
      disks: [{ select: { match: { size: 'largest' } }, wipe: true }],
    }
  } else if (storageMode.value === 'standard') {
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
  } else if (storageMode.value === 'lvm') {
    // LVM 卷组档:引导盘固定声明——kickstart 族 ESP + /boot(anaconda 无法从
    // LVM 引导),其余方言仅 ESP(grub2 可读 LVM)。family 未知按 kickstart
    // 兜底:/boot 多声明无害。
    const bootPartitions: { size: string; fs: 'vfat' | 'xfs'; mount: string; flags?: string[] }[] =
      (distroFamily.value ?? 'kickstart') === 'kickstart'
        ? [
            { size: '512M', fs: 'vfat', mount: '/boot/efi', flags: ['esp'] },
            { size: '1G', fs: 'xfs', mount: '/boot' },
          ]
        : [{ size: '512M', fs: 'vfat', mount: '/boot/efi', flags: ['esp'] }]
    const lvmStorage: components['schemas']['StorageSpec'] = {
      alignment: '4k',
      disks: [{ select: { match: { size: 'largest' } }, wipe: true, partitions: bootPartitions }],
    }
    out.storage = lvmStorage
    if (vgs.value.length > 0) {
      const toMatch = (s: SelectorKind) =>
        s === 'largest' || s === 'smallest' ? { size: s } : { type: s }
      lvmStorage.lvm = vgs.value.map((g) => {
        if (g.mode === 'keep') {
          return {
            name: g.name.trim(),
            keep: 'vg' as const,
            preserve: g.preserve.map((p) => ({
              name: p.name.trim(),
              mount: p.mount.trim(),
              ...(p.fs ? { fs: p.fs as 'vfat' | 'xfs' | 'ext4' | 'swap' } : {}),
            })),
          }
        }
        return {
          name: g.name.trim(),
          // debian(partman)单目标 = 最大盘,PV 自动接线(表单无 PV 行)
          pvs: isDebian.value
            ? [{ match: { size: 'largest' } }]
            : g.pvs.map((p) => ({ match: toMatch(p.selector) })),
          logvols: g.logvols.map((l) => ({
            name: l.name.trim(),
            size: l.size.trim(),
            fs: l.fs as 'vfat' | 'xfs' | 'ext4' | 'swap',
            mount: l.mount.trim() || undefined,
          })),
        }
      })
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

  // 网络（静态）：普通网卡 + bond + vlan。
  // 批量模式下地址不落模板——以 {var:ip_*} 占位，真实值走 targets[].vars。
  if (netMode.value === 'static') {
    const colByRow = new Map(matrixColumns.value.map((c) => [c.key, c]))
    const ifaces: components['schemas']['NetworkInterface'][] = []
    for (const n of nics.value) {
      const col = colByRow.get(n.key)
      const addr = isBatchStatic.value
        ? (col ? [`{var:${col.varName}}`] : undefined)
        : (n.ip.trim() ? [n.ip.trim()] : undefined)
      const routes = n.gateway.trim() ? [{ to: 'default', via: n.gateway.trim() }] : undefined
      const dnsList = n.dns.split(/[ ,]+/).filter(Boolean)
      const nameservers = dnsList.length > 0 ? { addresses: dnsList } : undefined
      if (n.kind === 'nic') {
        const v = n.matchValue.trim()
        if (!v) continue
        ifaces.push({ match: matchByKey(n.matchKey, v), addresses: addr, routes, nameservers })
      } else {
        const members = n.memberValues.map((m) => m.trim()).filter(Boolean)
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
          bond: { interfaces: members.map((m) => ({ match: matchByKey(n.memberKey, m) })), mode: n.mode, params },
          addresses: addr,
          routes,
          nameservers,
        })
      }
    }
    for (const v of vlans.value) {
      const col = colByRow.get(v.key)
      if (isBatchStatic.value) {
        if (!v.id.trim() || !col) continue
        ifaces.push({ vlan: { id: Number(v.id), link: v.link.trim() || 'bond0' }, addresses: [`{var:${col.varName}}`] })
      } else {
        if (!v.id.trim() || !v.ip.trim()) continue
        ifaces.push({ vlan: { id: Number(v.id), link: v.link.trim() || 'bond0' }, addresses: [v.ip.trim()] })
      }
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

  if (isBatchStatic.value && batchHostnameUsed.value) {
    out.identity = { hostname_pattern: '{var:hostname}' } // 逐台显式名（矩阵主机名列）
  } else if (hostnamePattern.value.trim()) {
    out.identity = { hostname_pattern: hostnamePattern.value.trim() }
  }
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
  // installer 是 windows 专用通路（setup/agent/auto），linux 方言携带即被引擎
  // SCHEMA_INVALID_BOOT_INSTALLER 拒绝——仅 windows 序列化。生成的 BootSpec 因
  // 字段带 default 被标为必填（openapi-typescript 行为），而契约本无 required，
  // 省略合法，故断言。kernel_args / installed_kernel_args 反之：windows 引擎
  // 拒绝（WinPE 无内核命令行），仅 linux 序列化；空省略。
  const kernelArgsOut: { kernel_args?: string; installed_kernel_args?: string } = {}
  if (!isWindows.value) {
    if (spec.boot?.kernel_args) kernelArgsOut.kernel_args = spec.boot.kernel_args
    if (spec.boot?.installed_kernel_args) kernelArgsOut.installed_kernel_args = spec.boot.installed_kernel_args
  }
  out.boot = (
    isWindows.value
      ? { strategy: spec.boot?.strategy ?? 'virtual_media', installer: spec.boot?.installer ?? 'auto' }
      : { strategy: spec.boot?.strategy ?? 'virtual_media', ...kernelArgsOut }
  ) as InstallSpec['boot']
  return out
}

// ── Step2 校验与方言即时预校验 ──────────────────────────────────────────────
const REPO_NAME_OK = /^[A-Za-z0-9._-]+$/

function validateStep2(): string | null {
  if (!spec.image.distro) return '请选择发行版'
  // dd(docs/09):库镜像模式校验和/格式由引擎按注册件解析携带;内联模式
  // http(s) source 与 checksum(未压缩 SHA256)都是通路硬前置
  if (isDD.value) {
    if (imageMode.value === 'library') {
      if (!chosenImageId.value) return '镜像直写:请从镜像库选择整盘镜像,或切换为内联填写镜像地址'
    } else {
      if (!spec.image.source) return '镜像直写:请填写整盘镜像的 http(s) 地址'
      if (!/^https?:\/\//.test(spec.image.source)) return '镜像直写:source 需为 http(s) 地址(机器直连拉流)'
      if (!spec.image.checksum?.trim()) return '镜像直写:checksum(SHA256,未压缩镜像)必填——写盘流逐字节校验的基准'
    }
    if (netMode.value === 'static') {
      const bad = nics.value.some((r) => r.kind === 'bond')
      if (bad) return '镜像直写首启 seed 暂只承载平面接口——bond/vlan 请移除或改用自动(DHCP)'
    }
    return null // 其余标准段(密码强度等)照走下方通用校验
  }
  if (imageMode.value === 'library' && !chosenImageId.value) return '请从镜像库选择镜像'
  if (imageMode.value === 'inline' && !spec.image.source) return '请填写镜像 source 地址'
  if (imageMode.value === 'inline' && spec.image.source && !/^https?:\/\//.test(spec.image.source)) {
    return '镜像 source 需为 http(s) 地址'
  }
  if (rootMode.value === 'manual' && rootPassword.value.length < 6) return '手动 root 密码至少 6 位'
  const kaErr = !isWindows.value ? kernelArgsError(spec.boot?.kernel_args) : null
  if (kaErr) return kaErr
  const ikaErr = !isWindows.value ? kernelArgsError(spec.boot?.installed_kernel_args) : null
  if (ikaErr) return ikaErr
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
  const lvErr = lvmError()
  if (lvErr) return lvErr
  if (netMode.value === 'static') {
    if (isBatchStatic.value) {
      // 批量静态：行定义「匹配 + 共享网关/DNS」，地址逐台进矩阵，缺一格即拦
      for (const [i, n] of nics.value.entries()) {
        if (n.kind === 'nic') {
          if (!n.matchValue.trim()) {
            return `第 ${i + 1} 块网卡：请选择匹配值（IP 在下方逐台表格填写）`
          }
          if (isWindows.value && n.matchKey !== 'mac') {
            return 'Windows 方言静态网络仅支持 MAC 绑定'
          }
        } else {
          const members = n.memberValues.filter((m) => m.trim())
          if (members.length > 0 && members.length !== n.memberValues.length) {
            return `bond "${bondNameOf(n)}" 有未填的成员匹配值`
          }
          if (members.length === 0) {
            return `bond "${bondNameOf(n)}" 需要至少一个成员网卡`
          }
          if (n.paramsRaw.trim()) {
            try { JSON.parse(n.paramsRaw) } catch {
              return `bond "${bondNameOf(n)}" 的高级参数不是合法 JSON`
            }
          }
        }
      }
      for (const [i, v] of vlans.value.entries()) {
        if (!v.id.trim()) {
          return `第 ${i + 1} 条 VLAN：请填写 VLAN ID（IP 在下方逐台表格填写）`
        }
      }
      for (const col of matrixColumns.value) {
        for (const r of readyTargets.value) {
          if (!matrixCell(r.machine.id, col.key).trim()) {
            return `「${col.label}」列：${r.machine.id} 还没填 IP/位`
          }
        }
      }
      const hostFilled = readyTargets.value.filter((r) => (hostnameMatrix.value[r.machine.id] ?? '').trim()).length
      if (hostFilled > 0 && hostFilled < readyTargets.value.length) {
        return '主机名列要么每台都填（逐台显式名），要么全部留空（用主机名模式生成）'
      }
    } else {
      for (const [i, n] of nics.value.entries()) {
        if (n.kind === 'nic') {
          const v = n.matchValue.trim()
          if ((v && !n.ip.trim()) || (!v && n.ip.trim())) {
            return `第 ${i + 1} 块网卡的匹配值与 IP 需要成对填写`
          }
          if (v && isWindows.value && n.matchKey !== 'mac') {
            return 'Windows 方言静态网络仅支持 MAC 绑定'
          }
        } else {
          const members = n.memberValues.filter((m) => m.trim())
          if (members.length > 0 && members.length !== n.memberValues.length) {
            return `bond "${bondNameOf(n)}" 有未填的成员匹配值`
          }
          if (n.ip.trim() && members.length === 0) {
            return `bond "${bondNameOf(n)}" 需要至少一个成员网卡`
          }
          if (n.paramsRaw.trim()) {
            try { JSON.parse(n.paramsRaw) } catch {
              return `bond "${bondNameOf(n)}" 的高级参数不是合法 JSON`
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
      toast.warning(err)
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
            // 模板 + 该台 vars：替换与解析后校验都在引擎侧同一条管线完成
            body: {
              spec: buildSpec({ forPlan: true }) as never,
              vars: (machineVars(row.machine.id) ?? {}) as never,
            },
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
    const data = await unwrap(await getClient().POST('/api/v1/jobs', {
      params: { header: { 'Idempotency-Key': uuid() } },
      body: {
        type: 'install',
        confirm: false,
        targets: {
          targets: readyTargets.value.map((r) => {
            const vars = machineVars(r.machine.id)
            return { machine_id: r.machine.id as never, ...(vars ? { vars: vars as never } : {}) }
          }),
        },
        spec: buildSpec() as never,
        policy: {
          concurrency: policy.concurrency,
          on_task_failure: policy.on_task_failure,
          verify_layout: policy.verify_layout,
          task_timeout_seconds: policy.task_timeout_seconds,
          health_gate: policy.health_gate,
        },
      },
    }))
    const jobId = (data as components['schemas']['Job'] | undefined)?.id
    toast.success(t('wizard.submitted', { id: jobId }))
    void queryClient.invalidateQueries({ queryKey: jobDomain })
    router.push({ name: 'job-detail', params: { id: jobId } })
  } catch (e) {
    toast.error(errorMessage(e))
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

// 内核参数逃生口（boot.kernel_args / boot.installed_kernel_args，docs/04
// §5.4）：无人值守装机的"GRUB 按 e"替代——安装器内核挂在硬件上（典型：
// nouveau 敌对 GPU）时，有人值守可手敲内核参数解围，无人值守只能靠这里。
// 空串 = 未声明（序列化时省略，契约本无该键也可缺省）。
const kernelArgs = computed({
  get: () => spec.boot?.kernel_args ?? '',
  set: (v: string) => {
    spec.boot!.kernel_args = v.trim() ? v.trim() : undefined
  },
})
const installedKernelArgs = computed({
  get: () => spec.boot?.installed_kernel_args ?? '',
  set: (v: string) => {
    spec.boot!.installed_kernel_args = v.trim() ? v.trim() : undefined
  },
})

// 与引擎 validateBootExtras 同口径的客户端预检（SCHEMA_INVALID_BOOT 提前到
// 表单）：token 须匹配引擎同一字符集，管道自有 key（引擎已拼，重复只遮蔽
// 语义）直接点名拒绝。
const KERNEL_ARG_TOKEN_OK = /^[A-Za-z0-9._,:%/+=@^~-]+$/
const RESERVED_KERNEL_ARGS = [
  'BOOTIF', 'ip', 'console', 'modules', 'inst.ks', 'inst.repo', 'inst.syslog',
  'inst.text', 'auto', 'priority', 'preseed/file', 'seedfrom', 'ds', 'file',
  'modloop', 'alpine_repo', 'apkovl', 'mammoth_base',
]

function kernelArgsError(args: string | undefined): string | null {
  if (!args?.trim()) return null
  for (const tok of args.trim().split(/\s+/)) {
    if (!KERNEL_ARG_TOKEN_OK.test(tok)) {
      return `内核参数 ${tok} 含不支持的字符（token 只允许字母数字与 ._,:%/+=@^~-，空白分隔，不支持引号/分号）`
    }
    const key = tok.includes('=') ? tok.slice(0, tok.indexOf('=')) : tok
    if (RESERVED_KERNEL_ARGS.includes(key)) {
      return `内核参数 ${key} 由引擎自动拼装（console 走部署配置 MAMMOTH_INSTALL_CONSOLE），不能重复声明`
    }
  }
  return null
}

// 与引擎 validateLvmShape 同口径的客户端预检（storage.lvm，docs/04 §5.1.1）：
// 提前到表单的确定性规则。选择器→盘的解析、快照绑定与逐机重叠留给试算
// （install-plan 逐机报 LAYOUT_VG_NOT_FOUND / LAYOUT_VG_EXISTS / 重叠码）。
const LVM_NAME_OK = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/

function lvmError(): string | null {
  if (storageMode.value !== 'lvm') return null
  if (vgs.value.length === 0) return 'LVM 卷组档至少声明一个卷组'
  const seenVg = new Set<string>()
  let hasRoot = false
  for (const [gi, g] of vgs.value.entries()) {
    const vgName = g.name.trim()
    if (!LVM_NAME_OK.test(vgName)) {
      return `卷组 ${gi + 1}：名称需字母开头、字母数字与 ._ 组合（禁 -，/dev/mapper 会双写），≤64 字符`
    }
    if (seenVg.has(vgName)) return `卷组 "${vgName}" 重复声明`
    seenVg.add(vgName)
    if (isDebian.value && g.mode === 'keep') {
      return `卷组 "${vgName}"：Debian（partman）无法保留既有卷组（keep:vg），请改用新建`
    }
    if (g.mode === 'keep') {
      const seenLv = new Set<string>()
      for (const [pi, p] of g.preserve.entries()) {
        if (!p.name.trim()) return `卷组 "${vgName}" 保留挂载 ${pi + 1}：请填写既有 LV 名`
        if (seenLv.has(p.name.trim())) return `卷组 "${vgName}"：保留挂载 "${p.name}" 重复`
        seenLv.add(p.name.trim())
        const m = p.mount.trim()
        if (!m) return `卷组 "${vgName}" 保留挂载 "${p.name}"：请填写挂载点`
        if (m === '/' || m === '/boot' || m === '/boot/efi') {
          return `卷组 "${vgName}" 保留挂载 "${p.name}"：挂载点不能是 ${m}（引导关键路径需全新安装）`
        }
        if (p.fs && !FS_OPTIONS.includes(p.fs)) return `卷组 "${vgName}" 保留挂载 "${p.name}"：fs 不合法`
      }
      continue
    }
    if (!isDebian.value && g.pvs.length === 0) return `卷组 "${vgName}"：至少一个 PV`
    if (g.logvols.length === 0) return `卷组 "${vgName}"：至少一个逻辑卷`
    const lvNames = new Set<string>()
    const lvMounts = new Set<string>()
    let restCount = 0
    for (const lv of g.logvols) {
      const n = lv.name.trim()
      if (!LVM_NAME_OK.test(n)) return `卷组 "${vgName}"：逻辑卷名需字母开头、字母数字与 ._ 组合（禁 -）`
      if (lvNames.has(n)) return `卷组 "${vgName}"：逻辑卷 "${n}" 重复`
      lvNames.add(n)
      if (!lv.size.trim()) return `卷组 "${vgName}"：逻辑卷 "${n}" 未填大小（rest = 占满卷组剩余）`
      if (lv.size.trim() === 'rest' && ++restCount > 1) {
        return `卷组 "${vgName}"：rest 大小的逻辑卷至多一个`
      }
      if (!FS_OPTIONS.includes(lv.fs)) return `卷组 "${vgName}"：逻辑卷 "${n}" fs 不合法`
      if (isDebian.value && lv.fs === 'xfs') {
        return `卷组 "${vgName}"：Debian netinst 不支持 xfs 逻辑卷（用 ext4）`
      }
      const m = lv.mount.trim()
      if (m === '/boot/efi' || m === '/boot') {
        return `卷组 "${vgName}"：逻辑卷不能挂 ${m}（本档已固定声明引导分区）`
      }
      if (m && m !== 'swap') {
        if (lvMounts.has(m)) return `卷组 "${vgName}"：挂载点 ${m} 重复声明`
        lvMounts.add(m)
        if (m === '/') hasRoot = true
      }
    }
  }
  if (isDebian.value && vgs.value.length > 1) {
    return 'Debian（partman）仅支持一个卷组（单 VG 单 PV，PV 自动接线最大盘）'
  }
  if (!hasRoot) return 'LVM 卷组档需要一个挂载为 / 的逻辑卷（根分区建在卷组上）'
  // 「引导盘同盘」= 引擎分区切出 PV（docs/04 §5.1.1）：引导盘的剩余空间只
  // 供一个卷组，声明两次必然在试算被拒——这里提前点名。
  const largestHolders = vgs.value.filter(
    (g) => g.mode === 'fresh' && g.pvs.some((p) => p.selector === 'largest'),
  ).length
  if (largestHolders > 1) return '「引导盘同盘」的 PV 只能属于一个卷组（系统盘剩余空间只有一份）'
  return null
}

const KEEP_LABEL = computed<Record<string, string>>(() => ({
  full: t('wizard.keepAll'),
  partial: t('settings.pxePartial'),
  none: t('wizard.keepNone'),
}))

const HEALTH_GATE_DESC = computed<Record<string, string>>(() => ({
  off: t('wizard.gateOffDesc'),
  report: t('wizard.gateReportDesc'),
  block: t('wizard.gateBlockDesc'),
}))

</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">{{ t('wizard.title') }}</h2>
        <p class="text-sm text-muted-foreground">{{ t('wizard.subtitle') }}</p>
      </div>
    </div>

    <Card>
      <CardContent class="py-6">
        <ol class="flex w-full items-start">
          <li
            v-for="(st, i) in [t('wizard.stepTargets'), t('wizard.stepIntent'), t('wizard.stepPlan'), t('wizard.stepPolicy')]"
            :key="st"
            class="relative flex min-w-0 flex-1 flex-col items-center gap-1.5"
          >
            <div
              v-if="i > 0"
              class="absolute right-1/2 top-3 h-0.5 w-full"
              :class="i < step ? 'bg-primary' : 'bg-border'"
            />
            <div
              class="relative z-10 grid size-7 place-items-center rounded-full text-xs font-medium"
              :class="i + 1 < step
                ? 'bg-primary text-primary-foreground'
                : i + 1 === step
                  ? 'border-2 border-primary text-primary'
                  : 'border border-border bg-muted text-muted-foreground'"
            >
              {{ i + 1 }}
            </div>
            <div
              class="text-xs font-medium"
              :class="i + 1 === step ? 'text-foreground' : 'text-muted-foreground'"
            >
              {{ st }}
            </div>
          </li>
        </ol>
      </CardContent>
    </Card>

    <!-- Step 1 -->
    <Card v-if="step === 1">
      <CardContent class="flex flex-col gap-3">
        <Alert v-if="targetsQuery.error.value" variant="destructive">
          <AlertTitle>{{ errorMessage(targetsQuery.error.value) }}</AlertTitle>
        </Alert>
        <Skeleton v-if="targetsQuery.isFetching.value" class="h-40 w-full" />
        <div v-else class="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="min-w-[160px]">{{ t('wizard.colMachine') }}</TableHead>
                <TableHead class="w-24">{{ t('wizard.colState') }}</TableHead>
                <TableHead class="min-w-[140px]">{{ t('wizard.colBmc') }}</TableHead>
                <TableHead class="min-w-[240px]">{{ t('wizard.colBusy') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in targetRows" :key="row.machine.id">
                <TableCell><span class="font-mono text-xs">{{ row.machine.id }}</span></TableCell>
                <TableCell><StateBadge kind="machine" :state="row.machine.state" /></TableCell>
                <TableCell><span class="font-mono text-xs">{{ row.machine.bmc.address }}</span></TableCell>
                <TableCell>
                  <template v-if="row.busy">
                    <Badge variant="outline" class="rounded-md font-medium" :style="{ color: '#f59e0b', borderColor: '#f59e0b55', backgroundColor: '#f59e0b1a' }">
                      {{ t('wizard.busy') }}
                    </Badge>
                    <span class="ml-2 font-mono text-xs text-muted-foreground">{{ row.busyTaskId }}</span>
                  </template>
                  <Badge v-else variant="outline" class="rounded-md font-medium" :style="{ color: '#10b981', borderColor: '#10b98155', backgroundColor: '#10b9811a' }">
                    {{ t('wizard.idle') }}
                  </Badge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">{{ t('wizard.idleRatio', { free: readyTargets.length, total: targetRows.length }) }}</span>
          <Button size="sm" :disabled="readyTargets.length === 0" @click="step = 2">
            {{ t('wizard.nextIntent') }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 2 -->
    <Card v-else-if="step === 2">
      <CardContent class="flex flex-col gap-6">
        <div class="grid gap-1.5">
          <Label>{{ t('wizard.image') }}</Label>
          <SegmentedControl
            v-model="imageMode"
            :options="[
              { value: 'library', label: t('wizard.imageLibrary') },
              { value: 'inline', label: t('wizard.imageInline') },
            ]"
          />
          <p v-if="isDD" class="text-xs leading-relaxed text-muted-foreground">
            {{ t('wizard.ddHint') }}
            {{ imageMode === 'library' ? t('wizard.ddHintLib') : '' }}
          </p>
          <div v-if="imageMode === 'library'" class="grid gap-1.5">
            <Select v-model="chosenImageId">
              <SelectTrigger class="w-[420px]">
                <SelectValue :placeholder="t('wizard.selectReadyImage')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="i in readyImages" :key="i.id" :value="i.id">
                  {{ i.name || i.id }} · {{ formatBytes(i.size_bytes) }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              {{ t('wizard.noFit') }}
              <RouterLink to="/images" target="_blank" class="text-primary underline-offset-2 hover:underline">{{ t('wizard.openImages') }}</RouterLink>
            </p>
            <p v-if="readyImages.length === 0" class="text-xs text-amber-600 dark:text-amber-400">
              {{ t('wizard.noReadyImages') }}
            </p>
          </div>
          <div v-else class="grid gap-1.5">
            <Input
              v-model="spec.image.source"
              :placeholder="isDD ? t('wizard.inlineSourcePlaceholderDD') : t('wizard.inlineSourcePlaceholder')"
              class="font-mono"
            />
            <Input
              v-model="spec.image.checksum"
              :placeholder="isDD ? '校验和: 9f86d8... (未压缩镜像的 SHA256，必填)' : '校验和: 9f86d8... (SHA256，可选，建议填写)'"
              class="font-mono"
            />
          </div>
          <template v-if="isDD">
            <p class="text-xs leading-relaxed text-muted-foreground">
              压缩格式是机器侧运行时选解压器的依据，已按{{ imageMode === 'library' ? '注册镜像' : '镜像地址' }}扩展名预置，可手动改。
            </p>
            <Select v-model="imageFormat">
              <SelectTrigger class="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="raw.gz">raw.gz（gzip，推荐）</SelectItem>
                <SelectItem value="raw.xz">raw.xz（需扩展池）</SelectItem>
                <SelectItem value="raw">raw（未压缩）</SelectItem>
              </SelectContent>
            </Select>
          </template>
        </div>

        <div class="grid gap-1.5">
          <Label>{{ t('wizard.distro') }}</Label>
          <Select v-model="distroChoice">
            <SelectTrigger class="w-[320px]">
              <SelectValue :placeholder="t('wizard.distroPlaceholder')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="d in orderedDistros" :key="d.name" :value="d.name">
                <span class="inline-flex items-center gap-2">
                  <DistroBadge :name="d.name" :family="d.family" />
                  {{ d.name === 'dd' ? t('wizard.distroDD') : d.name }}
                  <span class="text-xs text-muted-foreground">{{ d.name === 'dd' ? t('wizard.distroDDTag') : d.family }}</span>
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="autoDistroHint" class="text-xs text-emerald-600 dark:text-emerald-400">{{ autoDistroHint }}</p>
          <p v-if="distroChoice" class="text-xs leading-relaxed text-muted-foreground">
            {{ distroChoice === 'dd' ? t('wizard.ddPathHint') : t('wizard.dialectHint', { family: distros.find((d) => d.name === distroChoice)?.family, keep: KEEP_LABEL[distros.find((d) => d.name === distroChoice)?.keep_partition_support ?? ''] ?? '—' }) }}
          </p>
        </div>

        <div class="grid gap-1.5">
          <Label>{{ t('wizard.storage') }}</Label>
          <p v-if="isDD" class="text-xs leading-relaxed text-muted-foreground">
            {{ t('wizard.storageDD') }}
          </p>
          <SegmentedControl
            v-else
            v-model="storageMode"
            :disabled="isWindows"
            :options="[
              { value: 'standard', label: isWindows ? t('wizard.storageStandardWin') : t('wizard.storageStandard') },
              ...(isWindows ? [] : [{ value: 'custom', label: t('wizard.storageCustom') }, { value: 'lvm', label: t('wizard.storageLvm') }]),
            ]"
          />
          <p v-if="storageMode === 'standard' && !isWindows" class="text-xs leading-relaxed text-muted-foreground">
            {{ t('wizard.storageStandardHint') }}
          </p>
          <p v-else-if="isWindows" class="text-xs leading-relaxed text-muted-foreground">
            {{ t('wizard.storageWinHint') }}
          </p>
          <div v-else-if="storageMode === 'lvm'" class="grid gap-2">
            <Alert class="border-blue-500/30 bg-blue-500/5">
              <AlertDescription class="text-xs leading-relaxed">
                {{ t('wizard.lvmInfo') }}
              </AlertDescription>
            </Alert>
            <Alert v-if="isDebian" class="border-amber-500/40 bg-amber-500/5">
              <AlertDescription class="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                {{ t('wizard.debianLvmWarn') }}
              </AlertDescription>
            </Alert>
            <div v-for="(g, gi) in vgs" :key="gi" class="rounded-lg border p-3">
              <div class="mb-2.5 flex items-center justify-between gap-2">
                <Input v-model="g.name" :placeholder="t('wizard.vgNamePlaceholder')" class="w-[170px] font-mono" />
                <SegmentedControl
                  v-model="g.mode"
                  :options="[
                    { value: 'fresh', label: t('wizard.vgFresh') },
                    { value: 'keep', label: t('wizard.vgKeep') },
                  ]"
                />
                <Button variant="ghost" size="icon" class="size-8 shrink-0 text-destructive hover:text-destructive" @click="vgs.splice(gi, 1)">
                  <Trash2 class="size-4" />
                </Button>
              </div>
              <template v-if="g.mode === 'fresh'">
                <div v-if="!isDebian" class="grid gap-1.5">
                  <p class="text-xs text-muted-foreground">{{ t('wizard.pvHint') }}</p>
                  <div v-for="(p, pi) in g.pvs" :key="pi" class="flex items-center gap-1.5">
                    <Badge variant="outline" class="shrink-0 text-[11px] font-medium">{{ t('wizard.pv') }}</Badge>
                    <Select v-model="p.selector">
                      <SelectTrigger class="w-[210px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="key in PV_SELECTOR_OPTIONS" :key="key" :value="key">{{ PV_SELECTOR_LABEL[key] }}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8 text-destructive hover:text-destructive"
                      :disabled="g.pvs.length === 1"
                      @click="g.pvs.splice(pi, 1)"
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  </div>
                  <Button variant="outline" size="sm" class="w-fit" @click="addPv(g)">{{ t('wizard.addPv') }}</Button>
                </div>
                <p v-else class="text-xs text-muted-foreground">{{ t('wizard.pvDebianHint') }}</p>
                <div class="mt-2.5 grid gap-1.5">
                  <p class="text-xs text-muted-foreground">{{ t('wizard.lvHint') }}</p>
                  <div v-for="(l, li) in g.logvols" :key="li" class="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" class="shrink-0 text-[11px] font-medium">{{ t('wizard.lv') }}</Badge>
                    <Input v-model="l.name" :placeholder="t('wizard.lvNamePlaceholder')" class="w-[140px] font-mono" />
                    <Input v-model="l.size" :placeholder="t('wizard.lvSizePlaceholder')" class="w-[150px] font-mono" />
                    <Select v-model="l.fs">
                      <SelectTrigger class="w-[100px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="f in FS_OPTIONS" :key="f" :value="f">{{ f }}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input v-model="l.mount" :placeholder="t('wizard.mountPlaceholder')" class="w-[170px] font-mono" />
                    <Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" @click="g.logvols.splice(li, 1)">
                      <Trash2 class="size-4" />
                    </Button>
                  </div>
                  <Button variant="outline" size="sm" class="w-fit" @click="addLv(g)">+ 添加逻辑卷</Button>
                </div>
              </template>
              <template v-else>
                <p class="mb-1.5 text-xs text-muted-foreground">{{ t('wizard.keepHint') }}</p>
                <div v-for="(p, pi) in g.preserve" :key="pi" class="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" class="shrink-0 text-[11px] font-medium">{{ t('wizard.keepMount') }}</Badge>
                  <Input v-model="p.name" :placeholder="t('wizard.keepNamePlaceholder')" class="w-[160px] font-mono" />
                  <Input v-model="p.mount" :placeholder="t('wizard.keepMountPlaceholder')" class="w-[180px] font-mono" />
                  <Select :model-value="p.fs || undefined" @update:model-value="(v: unknown) => (p.fs = v == null ? '' : String(v))">
                    <SelectTrigger class="w-[130px]">
                      <SelectValue :placeholder="t('wizard.keepFsPlaceholder')" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="f in FS_OPTIONS" :key="f" :value="f">{{ f }}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" @click="g.preserve.splice(pi, 1)">
                    <Trash2 class="size-4" />
                  </Button>
                </div>
                <Button variant="outline" size="sm" class="mt-1.5 w-fit" @click="addPreserve(g)">{{ t('wizard.addMount') }}</Button>
              </template>
            </div>
            <Button variant="outline" size="sm" class="w-fit" @click="addVg">{{ t('wizard.addVg') }}</Button>
          </div>
          <div v-else class="grid gap-2">
            <div v-for="(d, di) in disks" :key="di" class="rounded-lg border p-3">
              <div class="mb-2.5 flex items-center justify-between gap-2">
                <Select v-model="d.selector">
                  <SelectTrigger class="w-[170px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="(label, key) in SELECTOR_LABEL" :key="key" :value="key">{{ label }}</SelectItem>
                  </SelectContent>
                </Select>
                <SegmentedControl
                  v-model="d.action"
                  :options="[
                    { value: 'wipe', label: t('wizard.diskWipe') },
                    { value: 'keep_disk', label: t('wizard.diskKeep') },
                  ]"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8 shrink-0 text-destructive hover:text-destructive"
                  :disabled="disks.length === 1"
                  @click="disks.splice(di, 1)"
                />
              </div>
              <div v-if="d.action === 'wipe'" class="grid gap-1.5">
                <div v-for="(p, pi) in d.partitions" :key="pi" class="flex flex-wrap items-center gap-1.5">
                  <Input v-model="p.size" :placeholder="t('wizard.partSizePlaceholder')" class="w-[150px] font-mono" />
                  <Select v-model="p.fs">
                    <SelectTrigger class="w-[110px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="f in FS_OPTIONS" :key="f" :value="f">{{ f }}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input v-model="p.mount" :placeholder="t('wizard.mountPlaceholder')" class="w-[180px] font-mono" />
                  <Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" @click="d.partitions.splice(pi, 1)">
                    <Trash2 class="size-4" />
                  </Button>
                </div>
                <Button variant="outline" size="sm" class="w-fit" @click="addPartition(d)">{{ t('wizard.addPartition') }}</Button>
              </div>
              <p v-else class="text-xs text-muted-foreground">{{ t('wizard.keepDiskHint') }}</p>
            </div>
            <Button variant="outline" size="sm" class="w-fit" @click="addDisk">{{ t('wizard.addDisk') }}</Button>
          </div>
        </div>

        <div class="grid gap-1.5">
          <Label>{{ t('wizard.network') }}</Label>
          <SegmentedControl
            v-model="netMode"
            :options="[
              { value: 'auto', label: t('wizard.netAuto') },
              { value: 'static', label: t('wizard.netStatic') },
            ]"
          />
          <div v-if="netMode === 'static'" class="grid gap-2 pt-1">
            <div v-for="(n, i) in nics" :key="i" class="rounded-lg border p-3">
              <!-- 普通网卡 -->
              <template v-if="n.kind === 'nic'">
                <div class="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" class="shrink-0 text-[11px] font-medium">{{ t('wizard.nic') }}</Badge>
                  <Select v-model="n.matchKey" :disabled="isWindows" @update:model-value="() => onMatchKeyChange(n)">
                    <SelectTrigger class="w-[110px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="k in MATCH_KEYS" :key="k" :value="k">{{ MATCH_KEY_LABEL[k] }}</SelectItem>
                    </SelectContent>
                  </Select>
                  <ComboInput
                    v-model="n.matchValue"
                    :options="nicOptionsByKey[n.matchKey].map((o) => ({ value: o.value, detail: nicOptionDetail(n.matchKey, o) }))"
                    :placeholder="matchPlaceholder(n.matchKey)"
                    input-class="w-[260px]"
                  />
                  <Input v-if="!isBatchStatic" v-model="n.ip" :placeholder="t('wizard.nicIpPlaceholder')" class="w-[180px] font-mono" />
                  <span v-else class="shrink-0 text-xs text-muted-foreground">{{ t('wizard.nicIpPerTarget') }}</span>
                  <Input v-model="n.gateway" :placeholder="t('wizard.gatewayPlaceholder')" class="w-[160px] font-mono" />
                  <Input v-model="n.dns" :placeholder="t('wizard.dnsPlaceholder')" class="w-[180px] font-mono" />
                  <Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" @click="nics.splice(i, 1)">
                    <Trash2 class="size-4" />
                  </Button>
                </div>
              </template>
              <!-- bond -->
              <template v-else>
                <div class="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" class="shrink-0 rounded-md text-[11px] font-medium" :style="{ color: '#f59e0b', borderColor: '#f59e0b55', backgroundColor: '#f59e0b1a' }">
                    bond
                  </Badge>
                  <TooltipProvider :delay-duration="200">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Input :model-value="bondNameOf(n)" disabled class="w-[110px] font-mono" />
                      </TooltipTrigger>
                      <TooltipContent>{{ t('wizard.bondNameTip') }}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Select v-model="n.mode">
                    <SelectTrigger class="w-[170px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="m in BOND_MODES" :key="m" :value="m">{{ m }}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input v-if="!isBatchStatic" v-model="n.ip" :placeholder="t('wizard.bondIpPlaceholder')" class="w-[180px] font-mono" />
                  <span v-else class="shrink-0 text-xs text-muted-foreground">{{ t('wizard.nicIpPerTarget') }}</span>
                  <Input v-model="n.gateway" :placeholder="t('wizard.gatewayPlaceholder')" class="w-[150px] font-mono" />
                  <Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" @click="nics.splice(i, 1)">
                    <Trash2 class="size-4" />
                  </Button>
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-1.5 pl-3.5">
                  <div class="flex w-full flex-wrap items-center gap-1.5">
                    <span class="text-xs text-muted-foreground">{{ t('wizard.memberKey') }}</span>
                    <Select v-model="n.memberKey" :disabled="isWindows" @update:model-value="() => onMemberKeyChange(n)">
                      <SelectTrigger class="w-[110px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="k in MATCH_KEYS" :key="k" :value="k">{{ MATCH_KEY_LABEL[k] }}</SelectItem>
                      </SelectContent>
                    </Select>
                    <span class="text-xs text-muted-foreground">{{ t('wizard.memberKeyHint') }}</span>
                  </div>
                  <div v-for="(_m, mi) in n.memberValues" :key="mi" class="flex w-full flex-wrap items-center gap-1.5">
                    <ComboInput
                      :model-value="n.memberValues[mi] ?? ''"
                      :options="nicOptionsByKey[n.memberKey].map((o) => ({ value: o.value, detail: nicOptionDetail(n.memberKey, o) }))"
                      :placeholder="matchPlaceholder(n.memberKey)"
                      input-class="w-[300px]"
                      @update:model-value="(v: string) => { if (n.memberValues[mi] !== undefined) n.memberValues[mi] = v }"
                    />
                    <Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" @click="n.memberValues.splice(mi, 1)">
                      <Trash2 class="size-4" />
                    </Button>
                  </div>
                  <Button variant="outline" size="sm" class="w-fit" @click="n.memberValues.push('')">{{ t('wizard.addMember') }}</Button>
                  <Input v-model="n.miimon" :placeholder="t('wizard.miimonPlaceholder')" class="w-[130px] font-mono" />
                  <Input v-model="n.paramsRaw" :placeholder="t('wizard.paramsPlaceholder')" class="w-[320px] font-mono" />
                </div>
              </template>
            </div>
            <div class="flex gap-1.5">
              <Button variant="outline" size="sm" class="w-fit" @click="addNic">{{ t('wizard.addNic') }}</Button>
              <Button variant="outline" size="sm" class="w-fit" :disabled="!bondSupported || isWindows" @click="addBond">{{ t('wizard.addBond') }}</Button>
              <Button variant="outline" size="sm" class="w-fit" :disabled="!bondSupported || isWindows" @click="addVlan">{{ t('wizard.addVlan') }}</Button>
            </div>
            <p v-if="nicInventoryHint" class="text-xs text-amber-600 dark:text-amber-400">{{ nicInventoryHint }}</p>
            <p v-if="!bondSupported" class="text-xs text-amber-600 dark:text-amber-400">
              {{ t('wizard.bondUnsupportedDebian') }}
            </p>
            <p v-else-if="isWindows" class="text-xs text-amber-600 dark:text-amber-400">
              {{ t('wizard.bondUnsupportedWin') }}
            </p>
            <template v-if="vlans.length > 0">
              <p class="pt-1 text-xs text-muted-foreground">{{ t('wizard.vlanSubs') }}</p>
              <div v-for="(v, i) in vlans" :key="'v' + i" class="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" class="shrink-0 rounded-md text-[11px] font-medium" :style="{ color: '#f59e0b', borderColor: '#f59e0b55', backgroundColor: '#f59e0b1a' }">
                  {{ t('wizard.vlan') }}
                </Badge>
                <Input v-model="v.id" :placeholder="t('wizard.vlanIdPlaceholder')" class="w-[110px] font-mono" />
                <Input v-model="v.link" :placeholder="t('wizard.vlanLinkPlaceholder')" class="w-[200px] font-mono" />
                <Input v-if="!isBatchStatic" v-model="v.ip" :placeholder="t('wizard.vlanIpPlaceholder')" class="w-[180px] font-mono" />
                <span v-else class="shrink-0 text-xs text-muted-foreground">{{ t('wizard.nicIpPerTarget') }}</span>
                <Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" @click="vlans.splice(i, 1)">
                  <Trash2 class="size-4" />
                </Button>
              </div>
            </template>
            <template v-if="isBatchStatic">
              <p class="pt-1 text-xs text-muted-foreground">{{ t('wizard.matrixHint') }}</p>
              <div class="overflow-x-auto rounded-lg border">
                <Table class="min-w-[640px]">
                  <TableHeader>
                    <TableRow class="bg-muted/50 hover:bg-muted/50">
                      <TableHead class="min-w-[150px]">{{ t('wizard.colMachine') }}</TableHead>
                      <TableHead v-for="col in matrixColumns" :key="col.key" class="min-w-[170px]">{{ col.label }}</TableHead>
                      <TableHead class="min-w-[150px]">{{ t('wizard.colHostname') }}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="row in readyTargets" :key="row.machine.id">
                      <TableCell>
                        <span class="font-mono text-xs">{{ row.machine.id }}</span>
                        <div class="font-mono text-[11px] text-muted-foreground">{{ row.machine.bmc.address }}</div>
                      </TableCell>
                      <TableCell v-for="col in matrixColumns" :key="col.key">
                        <Input
                          :model-value="matrixCell(row.machine.id, col.key)"
                          :placeholder="t('wizard.matrixCellPlaceholder')"
                          class="h-8 font-mono text-xs"
                          @update:model-value="setMatrixCell(row.machine.id, col.key, String($event))"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          :model-value="hostnameMatrix[row.machine.id] ?? ''"
                          :placeholder="t('wizard.matrixHostnamePlaceholder')"
                          class="h-8 font-mono text-xs"
                          @update:model-value="hostnameMatrix[row.machine.id] = String($event)"
                        />
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <div class="flex items-center gap-2">
                <Button variant="outline" size="sm" @click="fillIncremental">{{ t('wizard.fillIncremental') }}</Button>
                <span class="text-xs text-muted-foreground">{{ t('wizard.fillIncrementalHint') }}</span>
              </div>
              <p v-if="matrixColumns.length === 0" class="text-xs text-amber-600 dark:text-amber-400">
                {{ t('wizard.noMatrixCols') }}
              </p>
            </template>
          </div>
          <p v-else class="text-xs text-muted-foreground">{{ t('wizard.netAutoHint') }}</p>
        </div>

        <div class="grid gap-1.5">
          <Label for="hostname-pattern">{{ t('wizard.hostname') }}</Label>
          <Input
            id="hostname-pattern"
            v-model="hostnamePattern"
            :disabled="isBatchStatic && batchHostnameUsed"
            :placeholder="t('wizard.hostnamePlaceholder')"
            class="w-[320px] font-mono"
          />
          <p class="text-xs leading-relaxed text-muted-foreground">
            <template v-if="isBatchStatic && batchHostnameUsed">{{ t('wizard.hostnameTaken') }}</template>
            {{ t('wizard.hostnameHint') }}
          </p>
        </div>

        <div class="grid gap-1.5">
          <Label>{{ isWindows ? t('wizard.adminPassword') : t('wizard.rootPassword') }}</Label>
          <div class="flex flex-wrap items-center gap-2">
            <SegmentedControl
              v-model="rootMode"
              :options="[
                { value: 'random', label: t('wizard.rootRandom') },
                { value: 'manual', label: t('wizard.rootManual') },
              ]"
            />
            <Input
              v-if="rootMode === 'manual'"
              v-model="rootPassword"
              type="password"
              :placeholder="isWindows ? t('wizard.adminPlaceholder') : t('wizard.rootPlaceholder')"
              class="w-[240px] font-mono"
            />
          </div>
          <p class="text-xs leading-relaxed text-muted-foreground">{{ t('wizard.rootHint') }}</p>
        </div>

        <div v-if="!isWindows" class="grid gap-1.5">
          <Label>{{ t('wizard.sshKeys') }}</Label>
          <div class="grid gap-1.5">
            <div v-for="(_k, i) in sshKeys" :key="i" class="flex items-center gap-1.5">
              <Input v-model="sshKeys[i]" :placeholder="t('wizard.sshKeyPlaceholder')" class="flex-1 font-mono" />
              <Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" @click="sshKeys.splice(i, 1)">
                <Trash2 class="size-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" class="w-fit" @click="addSshKey">{{ t('wizard.addSshKey') }}</Button>
            <p class="text-xs leading-relaxed text-muted-foreground">{{ t('wizard.sshKeysHint') }}</p>
          </div>
        </div>

        <div v-if="isWindows" class="grid gap-1.5">
          <Label>{{ t('wizard.winCaps') }}</Label>
          <div class="flex flex-wrap gap-x-5 gap-y-2">
            <label v-for="cap in [{ value: 'rdp', label: t('wizard.capRdp') }, { value: 'winrm', label: t('wizard.capWinrm') }, { value: 'ping', label: t('wizard.capPing') }]" :key="cap.value" class="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                :model-value="winCaps.includes(cap.value as 'rdp' | 'winrm' | 'ping')"
                @update:model-value="(v: boolean | 'indeterminate') => {
                  if (v === 'indeterminate') return
                  winCaps = v
                    ? [...winCaps, cap.value as 'rdp' | 'winrm' | 'ping']
                    : winCaps.filter((x) => x !== cap.value)
                }"
              />
              {{ cap.label }}
            </label>
          </div>
          <p class="text-xs leading-relaxed text-muted-foreground">{{ t('wizard.winCapsHint') }}</p>
        </div>

        <div v-if="!isWindows && !isDD" class="grid gap-1.5">
          <Label>{{ t('wizard.repos') }}</Label>
          <div class="grid gap-1.5">
            <div v-for="(r, idx) in repos" :key="idx" class="flex flex-wrap items-center gap-1.5">
              <Input v-model="r.name" :placeholder="t('wizard.repoName')" class="w-[130px] font-mono" />
              <Input v-model="r.url" :placeholder="t('wizard.repoUrl')" class="min-w-0 flex-1 font-mono" />
              <Input v-model="r.gpg_key_url" :placeholder="t('wizard.repoGpg')" class="w-[200px] font-mono" />
              <Input v-model="r.suite" :placeholder="t('wizard.repoSuite')" class="w-[90px] font-mono" />
              <Input v-model="r.components" :placeholder="t('wizard.repoComponents')" class="w-[110px] font-mono" />
              <Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" @click="removeRepo(idx)">
                <Trash2 class="size-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" class="w-fit" @click="addRepo">{{ t('wizard.addRepo') }}</Button>
          </div>
        </div>

        <div v-if="!isDD" class="grid gap-1.5">
          <Label>{{ isWindows ? t('wizard.scriptsWinLabel') : t('wizard.scripts') }}</Label>
          <div class="grid gap-2">
            <div v-for="(sc, i) in scripts" :key="i" class="rounded-lg border p-3">
              <div class="mb-2 flex items-center justify-between gap-2">
                <Select v-model="sc.stage">
                  <SelectTrigger class="w-[240px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pre_install">{{ t('wizard.stagePre') }}</SelectItem>
                    <SelectItem value="post_install">{{ t('wizard.stagePost') }}</SelectItem>
                  </SelectContent>
                </Select>
                <Select v-if="isWindows" v-model="sc.shell">
                  <SelectTrigger class="w-[170px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cmd">{{ t('wizard.shellCmd') }}</SelectItem>
                    <SelectItem value="powershell">{{ t('wizard.shellPs') }}</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" @click="scripts.splice(i, 1)">
                  <Trash2 class="size-4" />
                </Button>
              </div>
              <Textarea
                v-model="sc.content"
                :rows="4"
                class="font-mono"
                :placeholder="isWindows ? t('wizard.scriptPlaceholderWin') : t('wizard.scriptPlaceholder')"
              />
            </div>
            <Button variant="outline" size="sm" class="w-fit" @click="addScript">{{ t('wizard.addScript') }}</Button>
          </div>
        </div>

        <div class="grid gap-1.5">
          <Label>{{ t('wizard.boot') }}</Label>
          <SegmentedControl
            v-model="spec.boot!.strategy"
            :disabled="isWindows && policyDraftInstaller === 'agent'"
            :options="[
              { value: 'virtual_media', label: t('wizard.bootVmedia') },
              { value: 'pxe', label: t('wizard.bootPxe') },
            ]"
          />
          <p v-if="spec.boot?.strategy === 'pxe' && !conn.capabilities?.netboot_enabled" class="text-xs text-amber-600 dark:text-amber-400">
            {{ t('wizard.netbootOffWarn') }}
          </p>
          <p v-else-if="!isDD && spec.boot?.strategy === 'virtual_media' && imageMode === 'library'" class="text-xs leading-relaxed text-muted-foreground">
            {{ t('wizard.vmediaLibHint') }}
          </p>
          <div v-if="hasHeadlessTarget" class="grid gap-1.5">
            <p class="text-xs text-amber-600 dark:text-amber-400">{{ t('wizard.headlessWarn', { n: headlessTargets.length }) }}</p>
            <div class="flex items-center gap-3">
              <NumberInput v-model="evidenceWait" :min="60" :max="3600" :step="60" class="w-32" />
              <span class="text-xs text-muted-foreground">{{ t('wizard.evidenceWait') }}</span>
            </div>
          </div>
        </div>

        <div v-if="!isWindows" class="grid gap-1.5">
          <Label>{{ t('wizard.kernelArgs') }}</Label>
          <div class="grid gap-1.5">
            <Input
              v-model="kernelArgs"
              class="font-mono"
              :placeholder="t('wizard.kernelArgsPlaceholder')"
            />
            <Input
              v-model="installedKernelArgs"
              class="font-mono"
              :placeholder="t('wizard.installedKernelArgsPlaceholder')"
            />
            <p class="text-xs leading-relaxed text-muted-foreground">{{ t('wizard.kernelArgsHint') }}</p>
          </div>
        </div>

        <div v-if="isWindows" class="grid gap-1.5">
          <Label>{{ t('wizard.winInstaller') }}</Label>
          <SegmentedControl
            v-model="policyDraftInstaller"
            :options="[
              { value: 'auto', label: t('wizard.installerAuto') },
              { value: 'setup', label: t('wizard.installerSetup') },
              { value: 'agent', label: t('wizard.installerAgent') },
            ]"
          />
          <p class="text-xs leading-relaxed text-muted-foreground">
            {{ t('wizard.installerHint', {
              smb: conn.capabilities?.windows_smb_share ? t('wizard.smbConfigured') : t('wizard.smbNotConfigured'),
              agent: conn.capabilities?.windows_agent_installer ? t('wizard.agentAvailable') : t('wizard.agentUnavailable'),
            }) }}
          </p>
        </div>

        <div class="mt-5 flex items-center justify-between">
          <Button variant="outline" @click="back">{{ t('wizard.prev') }}</Button>
          <Button @click="next">{{ t('wizard.nextPlan') }}</Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 3 -->
    <Card v-else-if="step === 3">
      <CardContent>
        <div v-if="planning" class="flex flex-col items-center gap-3 py-10">
          <Skeleton class="h-4 w-64" />
          <p class="text-sm text-muted-foreground">{{ t('wizard.planning', { n: readyTargets.length }) }}</p>
        </div>
        <template v-else>
          <div class="flex flex-col gap-4">
            <div v-for="r in planResults" :key="r.machineId">
              <div class="mb-2 flex items-center gap-2.5">
                <span class="font-mono text-sm">{{ r.machineId }}</span>
                <Badge
                  v-if="r.ok"
                  variant="outline"
                  class="rounded-md font-medium"
                  :style="{ color: '#10b981', borderColor: '#10b98155', backgroundColor: '#10b9811a' }"
                >
                  {{ t('wizard.planOk') }}
                </Badge>
                <Badge v-else variant="outline" class="rounded-md font-medium" :style="{ color: '#ef4444', borderColor: '#ef444455', backgroundColor: '#ef44441a' }">
                  {{ t('wizard.planFail') }}
                </Badge>
              </div>
              <template v-if="r.ok && r.plan">
                <Alert v-for="(w, i) in r.plan.warnings ?? []" :key="i" class="mb-2 border-amber-500/40 bg-amber-500/5">
                  <AlertDescription>{{ w }}</AlertDescription>
                </Alert>
                <div class="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow class="bg-muted/50 hover:bg-muted/50">
                        <TableHead class="w-28">{{ t('wizard.colDevice') }}</TableHead>
                        <TableHead class="min-w-[150px]">{{ t('wizard.colSerial') }}</TableHead>
                        <TableHead class="w-28">{{ t('machineDetail.colSize') }}</TableHead>
                        <TableHead class="w-20">{{ t('wizard.colKeep') }}</TableHead>
                        <TableHead class="min-w-[200px]">{{ t('wizard.colPlanned') }}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow v-for="row in r.plan.resolved_disks" :key="row.device">
                        <TableCell><span class="font-mono text-xs">{{ row.device }}</span></TableCell>
                        <TableCell><span class="font-mono text-xs">{{ row.serial || '—' }}</span></TableCell>
                        <TableCell class="text-muted-foreground">{{ formatBytes(row.size_bytes) }}</TableCell>
                        <TableCell class="text-muted-foreground">{{ row.keep ? '✓' : '—' }}</TableCell>
                        <TableCell>
                          <span class="font-mono text-[11px]">
                            {{ (row.planned_partitions || []).map((p: { number: number; mount: string }) => `${p.number}:${p.mount}`).join(' ') }}
                          </span>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </template>
              <Alert v-else-if="!r.ok" variant="destructive" class="mb-2">
                <AlertTitle>{{ r.error }}</AlertTitle>
              </Alert>
            </div>
            <div class="flex items-center justify-between">
              <Button variant="outline" @click="back">{{ t('wizard.prev') }}</Button>
              <Button :disabled="!planAllOk" @click="step = 4">{{ t('wizard.nextPolicy') }}</Button>
            </div>
          </div>
        </template>
      </CardContent>
    </Card>

    <!-- Step 4 -->
    <Card v-else-if="step === 4">
      <CardContent class="flex flex-col gap-5">
        <div class="grid max-w-[560px] gap-5">
          <div class="grid gap-1.5">
            <Label for="policy-concurrency">{{ t('wizard.concurrency') }}</Label>
            <NumberInput id="policy-concurrency" v-model="policy.concurrency" :min="1" :max="100" class="w-32" />
          </div>
          <div class="grid gap-1.5">
            <Label>{{ t('wizard.onTaskFailure') }}</Label>
            <SegmentedControl
              v-model="policy.on_task_failure"
              :options="[
                { value: 'continue', label: t('wizard.failContinue') },
                { value: 'abort_batch', label: t('wizard.failAbort') },
              ]"
            />
          </div>
          <div class="grid gap-1.5">
            <Label for="policy-timeout">{{ t('wizard.timeout') }}</Label>
            <NumberInput id="policy-timeout" v-model="policy.task_timeout_seconds" :min="60" :step="300" class="w-40" />
          </div>
          <div class="grid gap-1.5">
            <Label>{{ t('wizard.healthGate') }}</Label>
            <SegmentedControl
              v-model="policy.health_gate"
              :options="[
                { value: 'off', label: t('wizard.gateOff') },
                { value: 'report', label: t('wizard.gateReport') },
                { value: 'block', label: t('wizard.gateBlock') },
              ]"
            />
            <p class="text-xs leading-relaxed text-muted-foreground">{{ HEALTH_GATE_DESC[policy.health_gate] }}</p>
          </div>
        </div>
        <div class="mt-1 flex items-center justify-between">
          <Button variant="outline" @click="back">{{ t('wizard.prev') }}</Button>
          <Button :disabled="submittingJob" @click="submit">
            <LoaderCircle v-if="submittingJob" class="size-4 animate-spin" />
            {{ t('wizard.submitN', { n: readyTargets.length }) }}
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

