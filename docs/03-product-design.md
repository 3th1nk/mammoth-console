# 03 · mammoth-console 产品设计

> mammoth 官方 Web 控制台的产品设计稿。依据：[01-competitive-research](./01-competitive-research.md)（行业惯例与差异化）、[02-engine-capabilities](./02-engine-capabilities.md)（引擎真实能力面）。
> 状态：**草案（待评审）**。开放决策见 [§11](#十一开放决策待拍板)。

## 一、定位与目标用户

**一句话**：mammoth 裸金属装机引擎的官方开箱即用控制台——不引入引擎之外的常驻服务，部署完引擎后十五分钟内可见、可操作、可交付。

**目标用户**（按优先级）：
1. **机房/基础设施运维**：日常看机器、执行电源/介质操作、跑装机、处理失败任务。UI 的主用户。
2. **平台工程师**：写 spec、建模板、批量交付机器。期待声明式与可复制性（Copy as cURL、YAML 视图）。
3. **管理者/旁观者**：看总览大盘。最低优先级。

**明确不做**（来自竞品调研 §10 的"可以砍"）：多租户 RBAC、DNS/DHCP 网络服务管理、镜像仓库管理（引擎按 URL 拉取镜像，无内置仓库）、KVM 虚拟机托管、云厂商式"抹掉装机"抽象。

## 二、产品原则

1. **引擎是唯一事实源**。UI 无私有后端逻辑、无私有 API；一切能力边界（distro 支持矩阵、netboot 开关、高危确认策略）从 `GET /api/v1` capabilities 动态获取，不硬编码。
2. **状态驱动操作**（MAAS 验证的范式）：机器/任务状态决定可用动作，不可用动作灰置并给出原因，而不是点了才报错。
3. **异步无处不在**：引擎所有动作恒 202+Job（BMC 响应慢一个量级）。UI 一切操作反馈都是"已受理 + 任务链接"，不做同步等待假象。
4. **危险操作走契约同构的两段式确认**：读活表 → 选目标 → 显式 confirm，与 API 的 422 确认机制一一对应。
5. **渲染即预览**：装机意图在提交前必须可见（install-plan 试算 + 应答文件预览），填补全品类"所见即所装"空白。
6. **API-first 可视化**：每个操作面板提供 Copy as cURL；UI 全走公开 API 是卖点不是妥协。

## 三、架构决策：交付形态与认证

### 3.1 v1 形态：纯静态 SPA + 伴生反代（推荐，已定）

```
┌────────────────────── docker compose ──────────────────────┐
│  caddy        :8080                                        │
│   ├── /          → 静态 dist（console 构建产物）             │
│   └── /api, /events/stream → 反代 mammoth:80（SSE 透传）     │
│  mammoth      （现有引擎，all-in-one 或 faceted 均可）        │
│  postgres                                                  │
└────────────────────────────────────────────────────────────┘
```

- **理由**：同源反代天然免 CORS；SSE 经 Caddy 透传（`flush_interval -1`）；console 保持零常驻服务（Caddy 只是静态托管+反代，无状态、无数据）；交付物是 `compose.yaml` + 静态目录，符合"开箱即用"。
- 浏览器到引擎走同源 `/api`，console 侧不需要任何后端进程。
- **认证模型 v1**：设置页填引擎地址（默认同源）+ API token，存 localStorage；请求统一注入 Bearer。**token 即引擎管理员权限，console 不做二次鉴权——这是有意简化，部署方通过引擎侧网络边界控制访问**（与 kubectl kubeconfig 同一信任模型）。
- 备选形态（不采用，仅记录）：Tinkerbell 式 go:embed 内嵌主二进制——需引擎侧配合且违背引擎"保持纯粹"的立场，作为远期提案反馈，不承诺。

### 3.2 v2 预留：轻量 BFF（可选增强，暂不做）

若未来需要多用户、模板服务端存储、root 密码安全托管、机器搜索代理，再引入 console BFF（Go 单二进制，代理引擎 + 自有用户表）。v1 的 API 层（生成的 TypeScript client）与页面解耦，保证届时迁移成本可控。

## 四、技术栈建议（待拍板，见 §11-D1）

**推荐方案 A：Vue 3 + TypeScript + Element Plus**（默认）

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Vue 3.5+ / `<script setup>` / TypeScript | 国内运维工具生态主流；单文件组件对"表格+表单+抽屉"密集型控制台效率高 |
| 构建 | Vite | 事实标准 |
| UI | Element Plus | 表格/表单/树/级联密度高，运维后台组件覆盖最全；暗色模式内置 |
| 服务端状态 | TanStack Query（vue-query） | 列表缓存、cursor 分页、轮询（logs tail）、失效重取与 SSE 事件联动 |
| 全局状态 | Pinia（轻用） | 只放连接配置、capabilities、busy 缓存等少量全局态 |
| SSE | @microsoft/fetch-event-source | 原生 EventSource 不能带 Bearer header；该库支持 header + Last-Event-ID 自动重连 |
| 类型与 API | openapi-typescript + openapi-fetch | 契约已冻结（v1.0=当前 openapi.yaml），类型直出，零手写 client |
| 校验 | zod（复用 openapi-typescript 生成类型做 spec 表单校验） | 方言差异矩阵的前端预校验 |
| 图表 | ECharts | 总览分布图 |
| i18n | vue-i18n | zh-CN 为主语言，预留 en |
| 测试 | Vitest + Playwright | 组件单测 + 关键流程 E2E |

**备选方案 B：React 18 + Ant Design 5**——品类先例更多（MAAS maas-ui、OpenShift console、Foreman 插件全 React 系），TanStack Query 原生支持更成熟；其余同构。两者都满足"保守而轻"原则（竞品教训：避免 Redux 式重状态管理 + Enzyme 式快照测试依赖）。

## 五、信息架构

### 5.1 导航树（一级模块 + 里程碑标记）

```
顶栏：引擎地址/连接状态徽章 · 引擎版本 · 全局搜索(Ctrl+K) · 主题切换 · 语言
左侧导航：
├── 总览            /dashboard                M1
├── 机器            /machines                 M1
│   └── 机器详情     /machines/:id             M1(只读) M2(操作+向导)
├── 待认领          /pending                  M2（导航常驻，徽章=数量，SSE 实时）
├── 任务            /jobs                     M2
│   ├── 任务详情     /jobs/:id
│   └── 子任务详情   /jobs/:id/tasks/:taskId
├── 安装方案        /templates                M3
├── 事件审计        /events                   M3
└── 设置            /settings                 M1(连接) M3(webhooks/能力面板)
```

未连接引擎时整站替换为 Onboarding 向导（§7.1）。

### 5.2 页面清单

| 页面 | 内容要点 | API | 里程碑 |
|---|---|---|---|
| 总览 | 机器状态分布（环形图）· 待认领实时卡片 · 进行中 job 列表 · **最近失败任务一级入口**（学 DRP `uxv-failed-jobs`）· 引擎能力健康面板（netboot/vMedia/windows 通路/确认策略） | `GET /api/v1`、`GET /machines`、`GET /jobs?state=running`、`GET /pending-machines`、全局 SSE | M1 |
| 机器列表 | 列：状态徽章 / BMC 地址 / 厂商型号 / 序列号 / CPU·内存 / 电源 / 标签 / **进行中任务徽章** / 最近任务。多选批量：电源族、discover、重装、打标签。过滤：state、labels（chips）。行内动作菜单（§6） | `GET /machines`、`POST /machines/{id}/actions`、全局 SSE | M1 |
| 机器详情·概览 | 硬件清单（三路径产出，`coverage:partial` 显示 coverage_notes）· BMC/凭证信息（secret 不回显）· 电源状态 + 动作 · KVM 按钮（capabilities 降级）· 标签编辑 | `GET /machines/{id}` | M1 |
| 机器详情·分区 | layout 树状可视化（盘→分区表）· **captured_at 时效横幅**（"快照仅代表采集时刻，点击刷新触发 discover"）· source 标注 | `GET /machines/{id}/layout` | M2 |
| 机器详情·BIOS/固件 | BIOS 属性活读表（同步 BMC，502 显式报错）· 控制器固件清单 · set_bios 两段式入口 | `GET /machines/{id}/bios|drives` | M3 |
| 机器详情·任务历史 | 该机关联 job/task 时间线（经 events 反查 + jobs 列表过滤推断）· retry 入口 | `GET /events?resource_id=` | M2 |
| 待认领 | sighting 列表（MAC/固件/盘查报告/首见·最近见时间）· report JSON 查看器 · **认领向导**（复用注册表单）· 空态用"登记本"叙事 | `GET /pending-machines`、`POST .../claim` | M2 |
| 任务列表 | 列：类型/状态徽章/summary 计数条（mini 进度）/目标数/创建·结束时间。过滤 type/state。失败置顶快捷过滤 | `GET /jobs` | M2 |
| 任务详情 | summary 大计数条 · tasks 表（状态过滤、失败置顶）· 整单 cancel（附补偿说明）· spec 审计视图（只读 YAML）· SSE 实时 | `GET /jobs/{id}`、`GET /jobs/{id}/tasks`、job SSE | M2 |
| 子任务详情 | **stage 时间线**（六阶段步骤条 + duration_ms）· error 卡片（code→中文文案、retryable 标志、retry 按钮）· **日志查看器**（cursor 轮询 2s tail、level/stage 过滤、虚拟滚动）· answer_url 展示 · root_password 捕获弹层（§7.5） | `GET .../tasks/{taskId}`、`.../logs`、task retry | M2 |
| 安装方案 | spec 模板库（console 自管，见 §8.3）：列表/编辑器（表单+YAML 双视图）/导入导出 JSON/克隆 | 本地存储 v1 | M3 |
| 事件审计 | 事件表：resource_type/resource_id/type 过滤 · payload JSON 展开 · 游标分页 | `GET /events` | M3 |
| 镜像库 | 注册（name/source_url/sha256）/列表（状态 fetching/ready/failed、大小、失败原因）/删除；sha256 门禁语义提示 | `/images` CRUD | M2b |
| 设置·连接 | 引擎地址 + token · 连接测试（capabilities 探测）· 主题/语言 | 本地 | M1 |
| 设置·Webhooks | 列表/创建/删除 · **secret 仅创建时展示一次**的强提示 · fail_count 呈现 | `/webhooks` | M3 |
| 设置·能力 | capabilities 只读面板（引擎版本/distro 支持矩阵/netboot/windows 通路/确认策略/介质仓库路径） | `GET /api/v1` | M2 |

## 六、状态系统设计

### 6.1 徽章映射（全局统一组件）

| 实体.状态 | 语义（中文文案） | 视觉 |
|---|---|---|
| machine `registering` | 注册中 | 蓝·脉冲 |
| machine `discovering` | 盘查中 | 蓝·脉冲 |
| machine `ready` | 就绪 | 绿 |
| machine `error` | 异常 | 红 |
| job `pending/running` | 排队/执行中 | 灰/蓝·脉冲 |
| job `succeeded` | 全部成功 | 绿 |
| job `partial` | 部分成功 | 橙 |
| job `failed` / `canceled` | 失败 / 已取消 | 红 / 灰 |
| task `interrupted` | 中断（可续跑） | 橙 + retry 提示 |
| task `failed` | 失败 | 红 |
| power_state `on/off/unknown` | 运行中/已关机/未知 | ⏻ 绿/灰/问号 |

### 6.2 状态驱动动作矩阵（机器行/详情动作菜单）

可用性 = f(machine.state, busy 缓存, capabilities)：

- 电源族（on/off/soft_off/reboot/hard_reboot/cycle）：恒可用（unknown 也允许，失败由任务报错）。
- set_boot_device / mount_media / eject_media：恒可用。
- discover：`ready|discovering` 可用；RAMDISK probe 选项仅在 `MAMMOTH_RAMDISK_ENABLED` 时显示。
- 重装（install 向导）：`ready` 且 busy=false；busy=true 显示锁定态 + 阻塞任务链接（避免 409）。
- erase_drives / set_bios：`ready` 可用，进两段式向导。
- 删除/注销：恒可用，二次确认（提示关联凭证不删）。

**busy 缓存**：订阅全局 SSE（`job.state_changed`/`task.stage_changed`），前端维护 machine→running install task 映射；页面加载时用 `GET /jobs?state=pending|running` 兜底重建。

## 七、关键流程详设

### 7.1 首次使用 Onboarding（M2，差异化主打）

```
① 连接：输入引擎地址+token → GET /api/v1 探测 → 展示版本+能力健康
② 检查零注册前提：netboot_enabled=false 且用户想要 → 提示"在引擎侧开启
   MAMMOTH_PXE_ENABLED/ENROLL"（console 无配置 API，只能指引，给出文档链接）
③ 建第一个 BMC 凭证 → ④ 注册第一台机器 或 跳转待认领等机器出现
⑤ 跑第一次装机（预置最小 spec 模板）
```

### 7.2 注册机器

表单：BMC 地址 → 协议（auto/redfish/ipmi/fake，auto 默认并解释降级行为）→ 选择/新建凭证（密码字段标注"仅提交不可回显"）→ 可选 SSH 带内（凭证+地址，附"用于分区级盘查"说明）→ 标签。提交后直接跳机器详情，观察 `registering→discovering→ready`（SSE）。

### 7.3 零注册认领（标志性流程，M2）

- 待认领页顶部实时流：新 sighting 出现时 toast + 行高亮（SSE：`pending` 无事件类型？——v1 用 15s 轮询 `GET /pending-machines`，列表无分页成本低；引擎若加事件再切 SSE）。
- 行展开显示 report JSON（盘/CPU/内存/网卡）+ "report 未上报"空态解释（机器只 PXE 了一次）。
- 认领按钮 → 向导：step1 确认机器（对照序列号去机房认机）→ step2 复用注册表单（BMC+凭证）→ 提交 claim → 201 后台账行消失、跳转新机器详情；409（BMC 地址已注册）明确提示"该 BMC 已在管，台账已保留"。

### 7.4 装机向导（核心流程，M2）

```mermaid
flowchart LR
    A[1 选择目标机<br>多选·busy 预检] --> B[2 安装意图 spec<br>模板/表单 + YAML 双视图]
    B --> C[3 试算预览<br>install-plan<br>逐盘 matched_by]
    C --> D[4 执行策略 policy<br>并发/失败策略/超时]
    D --> E[提交 202<br>Idempotency-Key] --> F[job 详情实时观测]
```

- **Step2 表单分区**（对应 InstallSpec）：镜像（**二选一：从镜像库选择 `image.id`（引擎 sha256 门禁兜底）/ 内联 source+checksum**；distro 下拉由 capabilities `distros[]` 驱动并标注 family/keep_partition_support/pxe_support）→ 存储（三档语义单选：整盘擦除 / 保留盘跳过指定盘 / 保留分区+preserved 标注；盘选择器用 layout 快照可视化；带内不可达时禁用 keep:partitions 并解释）→ 网络（DHCP 默认 / 静态；debian 选中时禁用 bond/vlan 并给方言提示）→ 身份（hostname/时区）→ 访问（root 密码：留空=按任务随机，显著提示"将经一次性事件下发，请留意弹窗"）→ 脚本（pre/post，windows 通路限制即时提示）→ 软件源（`package_source.repos[]` 列表编辑器：name/url/gpg_key_url/suite/components；suite 缺省按发行版代号自动提示；windows 方言选中时整区禁用并提示"渲染即拒"）→ 启动（virtual_media/pxe，默认取 capabilities `boot_strategy_default`；windows 自动标 UEFI-only 并对 `pxe_firmware=BIOS` 观测的机器前置报 `SCHEMA_FIRMWARE_MISMATCH` 警告）。
- **表单 ↔ YAML 双视图**（Assisted Installer 验证过的妥协方案）：右上角切换，双向同步（表单为源，YAML 可编辑回写，zod 校验）。
- **方言即时预校验**：distro 选择后按文档 04 §5.3 矩阵在前端禁用不兼容项（debian 无 bond/vlan、windows 无 RAID/必须 UEFI、agent 通路无 pre_install）——把 `RENDER_FAILED` 从提交后错误提前到配置时提示。
- **Step3 试算页**：调 `install-plan`，逐盘卡片展示 `device / matched_by（为什么选中这块盘）/ serial / size / keep / planned_partitions`，boot_drive 高亮，warnings 逐条呈现（可解释性是该页的灵魂）；单机提交失败（422）就地显示同源错误文案。
- **Step4 policy**：并发（默认 10）、on_task_failure（continue/abort_batch）、task_timeout、verify_layout 开关（默认开，附解释）、**health_gate 三档**（off 缺省 / report"坏盘进试算警告" / block"坏盘拦在擦盘前，422点名 serial"；附探针健康数据来源说明）。
- **提交**：生成 Idempotency-Key；409 `JOB_MACHINE_BUSY` 弹阻塞作业标识 + "查看/取消旧作业"引导；成功跳 job 详情。

### 7.5 任务观测

- **job 详情**：summary 计数条（total/pending/running/succeeded/failed/interrupted/canceled 六色）实时走 job 级 SSE；tasks 表状态过滤。
- **子任务详情**：六阶段步骤条（`verify_layout → configure_raid → prepare_media → boot → install_os → verify_ready`）+ 每段 duration；日志查看器 2s cursor 轮询（`after=<last id>`），level/stage 过滤，来自 syslog 通道的行带来源标注。
- **root_password 一次性捕获**：SSE 收到 `task.root_password` → 模态弹层（密码 + 复制 + "此密码仅显示这一次，关闭后无法再次获取"）+ 会话内"装机产物"侧栏保留副本（仅内存，不落 localStorage）。
- **retry**：仅 failed/interrupted 显示；interrupted 附"从断点续跑"解释。
- **cancel**：job 详情常驻；确认框说明补偿行为（弹介质/恢复引导序）。

### 7.6 高危操作两段式（erase_drives 为例，M3）

① 读 `/machines/{id}/drives` 活表（不可用快照）→ ② 勾选目标盘（serial 为身份，显示型号/容量/协议）→ ③ 输入确认（如键入目标盘数）→ 提交带 `confirm:true` → 202 + 任务链接。capabilities `drive_erase_confirm=optional` 时可跳第③步。set_bios 同构（活读 bios 表 → 改属性 → confirm）。

## 八、API 对接策略

1. **类型与 client 全量生成**：`openapi-typescript` 从 `api/openapi.yaml` 生成类型 + `openapi-fetch` 薄封装；升级引擎 = 重新生成 + diff 检查（契约冻结，成本低）。
2. **数据层分工**：TanStack Query 管一切请求型数据（缓存键含过滤参数）；SSE 只做**失效信号**（收到事件 → `queryClient.invalidateQueries`）+ 少数实时直渲染面（job summary、日志、root_password）；避免 Redux/EventSource 双写状态。
3. **轮询面**：task logs 2s cursor 轮询；pending-machines 15s；连接健康 30s（`/healthz`）。全部带页面隐藏暂停（`refetchOnWindowFocus` + `visibilitychange`）。
4. **错误呈现统一组件**：解析 RFC 9457 problem + `code`/`retryable` → 内置错误码→中文文案映射表（02 文档 §二清单）；`retryable=true` 给"重试"按钮，`BMC_AUTH_FAILED` 直链凭证编辑。
5. **幂等**：一切创建型 POST（jobs、claim、credentials、actions）自动注入 Idempotency-Key（存请求上下文，失败重试复用同 key）。
6. **分页**：游标语义（只有"下一页"，无跳页）；表格用"加载更多 + 虚拟滚动"而非页码——这是引擎游标分页的正确 UI 形态。
7. **Copy as cURL**：每个操作面板右上角；从生成 client 的请求对象序列化（token 打码为 `$MAMMOTH_API_TOKEN`）。

## 九、差异化功能清单（优先级序）

1. install-plan 试算预览页（所见即所装）——全品类空白。
2. 零注册实时待认领区 + 一键认领向导。
3. Copy as cURL / API-first 可视化。
4. 失败任务/机器一级过滤视图。
5. 表单 ↔ YAML 双视图 + 方言即时预校验。
6. Onboarding 向导（15 分钟从零到装机）。
7. stage 级耗时时间线（引擎能力，竞品普遍只有整任务状态）。

## 十、里程碑

| 里程碑 | 内容 | 出口标准 |
|---|---|---|
| **M0 设计定稿** | 本组文档评审拍板（技术栈、IA、开放决策） | 文档定稿 |
| **M1 骨架可看** | 脚手架 + SDK 生成 + 连接设置 + 总览 + 机器列表/详情（只读）+ 状态徽章/动作菜单框架 | 连真实引擎可浏览全部机器与硬件信息 |
| **M2a 核心闭环（观测+动作）** | 注册/认领/电源介质动作/任务观测（SSE+日志+retry+cancel）——✅ 已落地 | 已达成 |
| **M2b 装机向导 + 镜像库** | 装机向导（族→版本选择、spec 表单+YAML 双视图、镜像库选择/内联 source 二选一、package_source 软件源编辑、health_gate 三档、install-plan 试算预览）/ root_password 捕获 / Onboarding / 镜像库页面（注册/状态/删除） | 纯 UI 走通"注册→装机→观测→重装"全流程 |
| **M2c 健康面** | 机器详情"硬件健康"卡片（overall 徽章+传感器表）+ "SEL 硬件日志"卡片 + 磁盘表 health 徽章（仅 Redfish 机器，IPMI 422 降级） | 硬件健康可视化闭环 |
| **M3 完善** | 安装方案库、批量、事件审计、webhooks、BIOS/擦盘两段式、KVM 降级、i18n(en) | 覆盖 openapi 全部面向管理员的端点 |
| **M4 打磨** | 全局搜索(Ctrl+K)、命令面板、暗色、E2E、compose 伴生包发布 | 一键 compose 交付验收 |

## 十一、开放决策（待拍板）

| # | 决策 | 默认建议 | 影响 |
|---|---|---|---|
| D1 | 技术栈 Vue3+Element Plus vs React+AntD | 方案 A（Vue） | 全部代码 |
| D2 | 机器可读名称：约定 label（如 `name`）vs 反馈引擎加 display_name | v1 约定 label `name`，列表缺省回退 `bmc_address` | 列表/详情呈现、搜索体验 |
| D3 | 安装方案模板存储：v1 localStorage+导入导出 vs 直接上 BFF | v1 本地 | M3 范围 |
| D4 | root 密码是否持久化 | 不持久化（安全优先），仅会话内 | 观测体验 |
| D5 | 待认领实时性：轮询 vs 推动 engine 加 pending 事件 | **已决策**：引擎加 sighting 事件（04 文档 A3），v1 轮询兜底、事件可用即切 | 实时体验 |
| D6 | 是否向引擎提需求清单（机器模糊搜索 `q=`、批量标签、logs SSE、pending 事件） | **已升级为契约文档并落地**：[04-engine-api-enhancements](./04-engine-api-enhancements.md)，P0 四项已在引擎侧实施 | 引擎排期联动 |
| D7 | 是否提供查看/修改引擎配置的能力 | **已决策**：只读脱敏快照 `GET /api/v1/config`（04 文档 A6）进设置·能力面板；**不提供修改 API**（12-factor 单一事实源 + 单 token 无 RBAC 下的安全面考虑），修改走 env/compose | 设置面板、排障体验 |

## 十三、素材资产

- **发行版 logo**：按 capabilities `distros[].family` 归一化键匹配（`rocky/centos/kylin/uos/ubuntu/debian/windows` + 探针环境 `alpine` + `generic` 兜底），素材为离线整理的一套同风格彩色官方矢量，键值映射见 [`assets/logos/MANIFEST.md`](../assets/logos/MANIFEST.md)；UI 封装 `<DistroBadge family>` 组件统一降级。

## 十二、风险

1. **引擎 API 的前端缺口**（搜索/批量/logs SSE）在 v1 只能绕行——绕行方案的体验上限就是 UI 的上限，需尽快推动 D6。
2. **单 token 无审计主体**：console 不做二次鉴权，若部署方直接暴露端口，任何人持 token 即全权——文档必须写清部署边界（建议 compose 默认只绑内网/加 Caddy basic auth 示例）。
3. **契约演进**：虽冻结，`windows_agent_installer` 等能力仍在活跃变更——SDK 生成 + capabilities 驱动开关可把影响压到重生成级别。
4. **SSE 基础设施**：浏览器直连要求反代正确透传（Caddy `flush_interval -1`）；`fetch-event-source` 的 Last-Event-ID 行为需要 E2E 覆盖。
