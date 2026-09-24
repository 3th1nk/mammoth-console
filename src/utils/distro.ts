/**
 * 发行版族归一：引擎按 distro+版本注册（rocky9/rocky10、debian12/13…），
 * UI 按"族"聚合展示与匹配 logo。归一规则与 assets/logos/MANIFEST.md 的
 * 素材键一致；匹配不到按 family 兜底，最后落 generic。
 */
export type DistroFamilyKey =
  | 'rocky' | 'centos' | 'kylin' | 'uos' | 'ubuntu'
  | 'debian' | 'windows' | 'alpine' | 'generic'

const RULES: Array<[RegExp, DistroFamilyKey]> = [
  [/rocky/, 'rocky'],
  [/centos/, 'centos'],
  [/kylin/, 'kylin'],
  [/uniontech|uos/, 'uos'],
  [/ubuntu/, 'ubuntu'],
  [/debian/, 'debian'],
  [/win/, 'windows'],
  [/alpine/, 'alpine'],
]

const FAMILY_FALLBACK: Partial<Record<string, DistroFamilyKey>> = {
  autoinstall: 'ubuntu',
  preseed: 'debian',
  agent: 'windows',
}

export function resolveDistroKey(name?: string, family?: string): DistroFamilyKey {
  const n = (name ?? '').toLowerCase()
  for (const [re, k] of RULES) {
    if (re.test(n)) return k
  }
  return FAMILY_FALLBACK[family ?? ''] ?? 'generic'
}

export const FAMILY_LABELS: Record<DistroFamilyKey, string> = {
  rocky: 'Rocky',
  centos: 'CentOS',
  kylin: '银河麒麟',
  uos: 'UOS（统信）',
  ubuntu: 'Ubuntu',
  debian: 'Debian',
  windows: 'Windows Server',
  alpine: 'Alpine（探针）',
  generic: '其他',
}

export function familyLabel(key: DistroFamilyKey): string {
  return FAMILY_LABELS[key] ?? key
}

// ── 镜像文件名启发式识别：Rocky-9.4-x86_64-dvd.iso → rocky/9.4 ──────────────
const FILENAME_PATTERNS: Array<[RegExp, string]> = [
  [/rocky[ _-]?(\d+(\.\d+)?)?/i, 'rocky'],
  [/centos[ _-]?(\d+(\.\d+)?)?/i, 'centos'],
  [/neo ?kylin|kylin[ _-]?v?(\d+(\.\d+)?)?/i, 'kylin'],
  [/uniontech|uos[ _-]?(\d+(\.\d+)?)?/i, 'uos'],
  [/ubuntu[ _-](\d+(?:\.\d+)?)/i, 'ubuntu'],
  [/debian[ _-]?(\d+(\.\d+)?)?/i, 'debian'],
  [/(?:windows|win)[ _-]?(?:server[ _-]?)?(\d{4})/i, 'windows'],
  [/alpine[ _-]?(\d+(\.\d+)?)?/i, 'alpine'],
]

export function detectDistroFromUrl(
  url: string,
): { name: string; distro: string; version: string } | null {
  let file = ''
  try {
    const u = new URL(url)
    file = decodeURIComponent(u.pathname.split('/').pop() ?? '')
  } catch {
    file = url.split('/').pop() ?? ''
  }
  if (!file || !/\.iso$/i.test(file)) return null
  const stem = file.replace(/\.iso$/i, '')
  for (const [re, distro] of FILENAME_PATTERNS) {
    const m = file.match(re)
    if (m) {
      return { name: stem, distro, version: (m[1] ?? '').replace(/[ _-]/g, '') }
    }
  }
  return { name: stem, distro: '', version: '' }
}
