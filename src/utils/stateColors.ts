/**
 * 全站状态色单一来源。
 *
 * 原来 Dashboard（STATE_COLORS）/StateBadge（MAP）/JobSummaryBar（SEGMENTS）
 * 三处各自硬编码默认色，新增状态要改三处；统一到 tone 语义层——徽章用
 * TONE_COLOR + alpha 变体（浅底彩字彩边：字 color、边 55、底 1a），图表与
 * 进度条直接取色值。色取 Tailwind 500 档中间调，亮暗主题都可读；shadcn
 * 灰阶纪律下彩色只服务状态语义，不参与常规界面。
 */
export type StateTone = 'success' | 'running' | 'warning' | 'danger' | 'neutral'

export const TONE_COLOR: Record<StateTone, string> = {
  success: '#10b981',
  running: '#3b82f6',
  warning: '#f59e0b',
  danger: '#ef4444',
  neutral: '#94a3b8',
}

/** tone → 动态徽章内联样式（浅底彩字彩边，亮暗通用）。 */
export function toneBadgeStyle(tone: StateTone): {
  color: string
  borderColor: string
  backgroundColor: string
} {
  const c = TONE_COLOR[tone]
  return { color: c, borderColor: `${c}55`, backgroundColor: `${c}1a` }
}

export interface StateStyle {
  label: string
  tone: StateTone
}

/** machine/job/task 三类状态机（文案映射见 docs/03-product-design.md §6.1）。 */
const STATE_MAP: Record<'machine' | 'job' | 'task', Record<string, StateStyle>> = {
  machine: {
    registering: { label: '注册中', tone: 'neutral' },
    discovering: { label: '盘查中', tone: 'running' },
    ready: { label: '就绪', tone: 'success' },
    error: { label: '异常', tone: 'danger' },
    retired: { label: '已退役', tone: 'neutral' },
  },
  job: {
    pending: { label: '排队中', tone: 'neutral' },
    running: { label: '执行中', tone: 'running' },
    succeeded: { label: '全部成功', tone: 'success' },
    partial: { label: '部分成功', tone: 'warning' },
    failed: { label: '失败', tone: 'danger' },
    canceled: { label: '已取消', tone: 'neutral' },
  },
  task: {
    pending: { label: '排队中', tone: 'neutral' },
    running: { label: '执行中', tone: 'running' },
    succeeded: { label: '成功', tone: 'success' },
    failed: { label: '失败', tone: 'danger' },
    canceled: { label: '已取消', tone: 'neutral' },
    interrupted: { label: '中断可续跑', tone: 'warning' },
  },
}

export function stateStyle(kind: 'machine' | 'job' | 'task', state: string): StateStyle {
  return STATE_MAP[kind]?.[state] ?? { label: state, tone: 'neutral' }
}

export function powerStyle(state: string): StateStyle {
  switch (state) {
    case 'on':
      return { label: '运行中', tone: 'success' }
    case 'off':
      return { label: '已关机', tone: 'neutral' }
    default:
      return { label: '电源未知', tone: 'warning' }
  }
}

/** job.summary 分段顺序（JobSummaryBar 与 Dashboard 图表共用）。 */
export const JOB_SUMMARY_SEGMENTS: {
  key: 'succeeded' | 'running' | 'pending' | 'interrupted' | 'failed' | 'canceled'
  label: string
  tone: StateTone
}[] = [
  { key: 'succeeded', label: '成功', tone: 'success' },
  { key: 'running', label: '执行中', tone: 'running' },
  { key: 'pending', label: '排队', tone: 'neutral' },
  { key: 'interrupted', label: '中断', tone: 'warning' },
  { key: 'failed', label: '失败', tone: 'danger' },
  { key: 'canceled', label: '取消', tone: 'neutral' },
]

/** 机器状态 → 图表色（Dashboard donut 等）。 */
export const MACHINE_STATE_COLOR: Record<string, string> = {
  ready: TONE_COLOR.success,
  discovering: TONE_COLOR.running,
  registering: TONE_COLOR.neutral,
  error: TONE_COLOR.danger,
}
