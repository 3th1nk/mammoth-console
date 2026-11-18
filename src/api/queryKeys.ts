import type { QueryKey } from '@tanstack/vue-query'

/**
 * TanStack Query queryKey 工厂：层级化命名，同域查询共用前缀，
 * invalidateQueries 失效前缀即可联动整个域——['pending'] 一次命中
 * 徽标/待认领列表/Dashboard；['job', jobId] 命中作业详情/任务列表/子任务
 * 详情（事件失效与手动刷新都不再需要逐个 key 枚举）。
 *
 * 约定：
 * - 第一段为资源域，第二段为形态（list/detail/…），其后是过滤参数；
 * - 失效/刷新一律引用本文件导出的常量或工厂，不再手写字面量 key；
 * - BMC 活读（health/sel）刻意不挂 ['machine'] 前缀——事件驱动的失效
 *   不应引发同步 BMC 遍历风暴（见 MachineDetailView 的活读注释）。
 */

// ── 待认领域 ──────────────────────────────────────────────────────────────
// 徽标（ConsoleLayout）/列表页（PendingView）/Dashboard 同一 endpoint
// GET /pending-machines：共用一个 key，缓存共享、失效联动。
export const pendingListKey: QueryKey = ['pending', 'list']
export const pendingDomain: QueryKey = ['pending']

// ── 机器域 ────────────────────────────────────────────────────────────────
export const machineDomain: QueryKey = ['machine']
export const machineListKey = (...f: unknown[]): QueryKey => ['machine', 'list', ...f]
export const machineKey = (id: string): QueryKey => ['machine', 'detail', id]
export const machineLayoutKey = (id: string): QueryKey => ['machine', 'layout', id]
export const machineAcceptanceKey = (id: string): QueryKey => ['machine', 'acceptance', id]
export const machineDecommissionKey = (id: string): QueryKey => ['machine', 'decommission', id]
// 活读面（60s AbortSignal，慢控制器下代价高）：独立前缀，不随事件失效。
export const machineHealthKey = (id: string): QueryKey => ['machine-health', id]
export const machineSelKey = (id: string): QueryKey => ['machine-sel', id]
export const machineWizardTargetsKey = (ids: unknown[]): QueryKey => ['machine', 'wizard-targets', ids]

// ── 任务域：['job', jobId] 前缀失效覆盖该 job 的 detail/tasks/task ─────────
export const jobDomain: QueryKey = ['job']
export const jobListKey = (...f: unknown[]): QueryKey => ['job', 'list', ...f]
// 单个 job 的全部查询挂在 ['job', jobId] 之下（jobId 由引擎生成，不会与
// 'list' 碰撞）：job 级 SSE 失效 / 手动刷新用 jobScopeKey 一次命中
export const jobScopeKey = (id: string): QueryKey => ['job', id]
export const jobKey = (id: string): QueryKey => ['job', id, 'detail']
export const jobTasksKey = (id: string): QueryKey => ['job', id, 'tasks']
export const taskKey = (jobId: string, taskId: string): QueryKey => ['job', jobId, 'tasks', taskId]

// ── 其他台账 ──────────────────────────────────────────────────────────────
export const credentialDomain: QueryKey = ['credential']
export const credentialsKey: QueryKey = ['credential', 'list']
export const imageDomain: QueryKey = ['image']
export const imagesKey: QueryKey = ['image', 'list']
export const imageWizardKey: QueryKey = ['image', 'wizard']
export const biosProfileDomain: QueryKey = ['bios-profile']
export const biosProfilesKey: QueryKey = ['bios-profile', 'list']
export const eventDomain: QueryKey = ['event']
export const eventsListKey = (...f: unknown[]): QueryKey => ['event', 'list', ...f]
export const webhookDomain: QueryKey = ['webhook']
export const webhooksKey: QueryKey = ['webhook', 'list']

// ── 聚合/设置 ─────────────────────────────────────────────────────────────
export const dashboardDomain: QueryKey = ['dashboard']
export const dashboardKey = (s: string): QueryKey => ['dashboard', s]
export const configKey: QueryKey = ['config']
