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
