/**
 * 全站状态色单一来源。
 *
 * 原来 Dashboard（STATE_COLORS）/StateBadge（MAP）/JobSummaryBar（SEGMENTS）
 * 三处各自硬编码默认色，新增状态要改三处；统一到 tone 语义层——徽章用
 * TONE_COLOR + alpha 变体（浅底彩字彩边：字 color、边 55、底 1a），图表与
 * 进度条直接取色值。label 存 i18n key（states.*），显示时经 t() 翻译。
 * 色取 Tailwind 500 档中间调，亮暗主题都可读；shadcn 灰阶纪律下彩色只
 * 服务状态语义，不参与常规界面。
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
  labelKey: string
  tone: StateTone
}

/** machine/job/task 三类状态机（文案 key 指向 locales 的 states 域）。 */
const STATE_MAP: Record<'machine' | 'job' | 'task', Record<string, StateStyle>> = {
  machine: {
    registering: { labelKey: 'states.machineRegistering', tone: 'neutral' },
    discovering: { labelKey: 'states.machineDiscovering', tone: 'running' },
    ready: { labelKey: 'states.machineReady', tone: 'success' },
    error: { labelKey: 'states.machineError', tone: 'danger' },
    retired: { labelKey: 'states.machineRetired', tone: 'neutral' },
  },
  job: {
    pending: { labelKey: 'states.jobPending', tone: 'neutral' },
    running: { labelKey: 'states.jobRunning', tone: 'running' },
    succeeded: { labelKey: 'states.jobSucceeded', tone: 'success' },
    partial: { labelKey: 'states.jobPartial', tone: 'warning' },
    failed: { labelKey: 'states.jobFailed', tone: 'danger' },
    canceled: { labelKey: 'states.jobCanceled', tone: 'neutral' },
  },
  task: {
    pending: { labelKey: 'states.taskPending', tone: 'neutral' },
    running: { labelKey: 'states.taskRunning', tone: 'running' },
    succeeded: { labelKey: 'states.taskSucceeded', tone: 'success' },
    failed: { labelKey: 'states.taskFailed', tone: 'danger' },
    canceled: { labelKey: 'states.taskCanceled', tone: 'neutral' },
    interrupted: { labelKey: 'states.taskInterrupted', tone: 'warning' },
  },
}

export function stateStyle(kind: 'machine' | 'job' | 'task', state: string): StateStyle {
  return STATE_MAP[kind]?.[state] ?? { labelKey: state, tone: 'neutral' }
}

export function powerStyle(state: string): StateStyle {
  switch (state) {
    case 'on':
      return { labelKey: 'states.powerOn', tone: 'success' }
    case 'off':
      return { labelKey: 'states.powerOff', tone: 'neutral' }
    default:
      return { labelKey: 'states.powerUnknown', tone: 'warning' }
  }
}

/** job.summary 分段顺序（JobSummaryBar 与 Dashboard 图表共用）。 */
export const JOB_SUMMARY_SEGMENTS: {
  key: 'succeeded' | 'running' | 'pending' | 'interrupted' | 'failed' | 'canceled'
  labelKey: string
  tone: StateTone
}[] = [
  { key: 'succeeded', labelKey: 'states.sumSucceeded', tone: 'success' },
  { key: 'running', labelKey: 'states.sumRunning', tone: 'running' },
  { key: 'pending', labelKey: 'states.sumPending', tone: 'neutral' },
  { key: 'interrupted', labelKey: 'states.sumInterrupted', tone: 'warning' },
  { key: 'failed', labelKey: 'states.sumFailed', tone: 'danger' },
  { key: 'canceled', labelKey: 'states.sumCanceled', tone: 'neutral' },
]

/** 机器状态 → 图表色（Dashboard donut 等）。 */
export const MACHINE_STATE_COLOR: Record<string, string> = {
  ready: TONE_COLOR.success,
  discovering: TONE_COLOR.running,
  registering: TONE_COLOR.neutral,
  error: TONE_COLOR.danger,
}

/** 镜像状态（拉取中/就绪/失败/文件缺失）。 */
export const IMAGE_STATE: Record<string, StateStyle> = {
  fetching: { labelKey: 'states.imgFetching', tone: 'running' },
  ready: { labelKey: 'states.imgReady', tone: 'success' },
  failed: { labelKey: 'states.imgFailed', tone: 'danger' },
  missing: { labelKey: 'states.imgMissing', tone: 'warning' },
}
