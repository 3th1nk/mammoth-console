# 02 · 引擎能力盘点（面向前端）

> 本文档是对 mammoth 引擎（`api/openapi.yaml` v0.1.0，契约冻结=v1.0，2708 行）+ `docs/01~12` + `internal/` 的能力盘点，视角是"前端控制台能对接到什么"。所有名称均为契约/代码中的真实名称。配套阅读：[01-competitive-research](./01-competitive-research.md)、[03-product-design](./03-product-design.md)。

## 一、核心领域实体与状态机

### credential（凭证，`cred_` 前缀）
- `id / type(bmc|ssh) / name / created_at / updated_at`。
- secret（`username`+`password` 或 `private_key` PEM）**只写不可读，任何端点永不回显**——前端永远只显示元数据。
- `name` 唯一，重复创建 409。BMC 地址是机器身份锚（`machines.bmc_address` 唯一）。

### machine（机器，`mch_` 前缀）
- 字段：`labels`、`bmc{address, protocol(redfish|ipmi|auto|fake), credential_id, vendor, model, firmware_version}`、`ssh_credential_id + ssh.address`、`hardware{serial_number, cpu{model,cores}, memory_bytes, disks[](name,serial,size_bytes,medium:ssd|hdd,protocol,removable), nics[](name,mac,speed_mbps,link_up,pci_address)}`、`firmware`（仅 Redfish，IPMI 为 null）、`power_state(on|off|unknown)`。
- `hardware` 带 `coverage: full|partial` + `coverage_notes[]`——**探针盲区标注，UI 必须呈现**。
- **状态机**：`registering → discovering → ready | error`。探针成功与 verify_ready 成功都会回置 ready；前端要处理停在中间态的呈现。
- PXE 观测列：`pxe_firmware`（DHCP option 93）、`pxe_last_seen_at`——固件门禁（UEFI-only 媒体派给 BIOS 机器 → `SCHEMA_FIRMWARE_MISMATCH`）依据此观测，"无观测不门禁"。
- **注意：machine 没有 name/hostname 字段**，身份=`mch_id`+`bmc_address`+`serial_number`，可读名称只能靠 labels 约定（见产品设计"开放问题"）。

### pending_machine（零注册 sighting，非 machine 资源）
- 以 **MAC 为键**。字段：`mac / firmware(option 93 标签) / report(enroll 探针 /sys 扫描 jsonb) / first_seen_at / last_seen_at`。
- **无状态机**——只是"等认领"台账；两个供源（PXE 观测 TouchByMAC + enroll 上报 SaveReport）合流同一行；`claim` 成功即消费删除；claim 时 BMC 地址冲突 409、台账行保留。
- **无分页**，列表全量返回。

### layout（分区快照，machine 子资源，不可变追加）
- `captured_at / source(inband_ssh|ramdisk) / disks[](device, match.serial, table:gpt|mbr, partitions[](number,start_bytes,end_bytes,size_bytes,fstype,label,mountpoint,uuid))`。
- 每机保留最近 N 版（默认 10），GET 只回最新一版。**时效原则：快照只表达采集时刻事实——契约文档明确要求 UI 展示 `captured_at` 并引导刷新**。无 redfish 来源（Redfish 只出规格不出分区）。

### job（批量异步操作，`job_` 前缀）
- `type: install | power | discover`；**状态机** `pending → running → succeeded | partial | failed | canceled`（`partial` 是 job 独有：批内部分成功）。
- `summary{total,pending,running,succeeded,failed,interrupted,canceled}` 物化计数（列表页免聚合）、`machine_ids[] / spec(解析后终稿，审计用) / action / policy / created_at / finished_at`。
- **409 `JOB_MACHINE_BUSY`**：install 提交时目标机已有 pending/running/interrupted 的 install 任务 → 整单 409，problem detail 带阻塞任务/作业标识，需先 cancel 旧作业。**前端必须做 409 冲突呈现与"先取消再重跑"引导**。

### task（per-machine 子任务，只读，`tsk_` 前缀）
- **状态机** `pending → running → succeeded | failed | canceled | interrupted`（`interrupted` 是 task 独有：心跳丢失被 reaper 判定，**可 retry 从 last stage 续跑**）。
- `attempt / flow_name / answer_url / stages[] / error{code,message,retryable} / created_at / updated_at / finished_at`。
- **stage 序列**（`internal/provision/flow.go` 唯一定义源）：
  - `install`: `verify_layout → configure_raid → prepare_media → boot → install_os → verify_ready`
  - `power`: `bmc_action`；`discover`: `probe`（单 stage）
- stage 状态 `pending → running → succeeded | failed | skipped | canceled`，带 `attempt / started_at / finished_at / duration_ms`——**"慢在哪一步"不用查日志**。

### event（事件，观测层根基）
- `id` 单调递增（SSE `Last-Event-ID` 水位）、`resource_type(job|task|machine|credential) / resource_id / type / payload / ts`。
- 已确认的事件类型：`job.created`、`job.cancel_requested`、`job.state_changed`、`task.stage_changed`、`task.state_changed`、`task.interrupted`、**`task.root_password`**、`machine.discovered`、`machine.layout_captured`、`task.netboot_registered/released`、`task.bios_attributes`、`task.drive_erase`、`task.verify_ready_degraded`、`task.bcdboot_armed/done`。
- **`task.root_password`**：root 密码默认按任务随机生成，经此事件**一次性下发，错过即不可再取**——前端必须第一时间捕获展示。

### task_log（执行日志）
- `id(task 内单调，游标) / level(DEBUG|INFO|WARN|ERROR) / stage / message / attrs / ts`，TTL 默认 90d。
- vMedia 安装器的 syslog 通道（514/udp sink）日志也归因写入 task_logs（租约反查 + IP 注册表）。

### 其他
- `netboot_entries`：MAC 唯一的 PXE 引导项注册表（`kind: install|probe`），与介质同生命周期，终态即时注销 + 孤儿 reaper。前端一般无需感知。
- `webhook`（`wh_` 前缀）：`url / types[] / resource_id / enabled / watermark / fail_count`；secret HMAC-SHA256 **仅创建响应出现一次**。

## 二、API 端点全清单（按 tag 分组）

**认证**：`Authorization: Bearer <MAMMOTH_API_TOKEN>`——**单一静态 token，无用户/无租户/无 RBAC**。机器面端点（`/render/*`、`/netboot/*`）免 token。
**横切约定**：错误一律 RFC 9457 `application/problem+json` + 扩展 `code`（`<域>_<现象>`）与 `retryable`；创建型 POST 均支持 `Idempotency-Key`（24h 窗口）；列表游标分页 `page_size(1-200,默认50) + cursor + next_cursor`，**无 offset 深翻页**；排序仅 `order_by=created_at|updated_at`；每响应带 `X-Request-Id` / `X-Mammoth-API-Version`。

### meta
| 端点 | 用途 |
|---|---|
| GET `/healthz` / `/readyz` | 存活/就绪 |
| **GET `/api/v1`** | **能力自描述**：`version / bios_set_confirm / drive_erase_confirm / resources[] / distros[]{name,keep_partition_support,pxe_support,family} / boot_strategy_default / netboot_enabled / windows_smb_share / windows_agent_installer`——**前端特性开关的事实源，不要硬编码** |

### credentials
`POST /api/v1/credentials`（409 同名）、`GET /credentials/{id}`（永不回 secret）、`DELETE /credentials/{id}`（409=有机器引用）。

### machines
| 端点 | 用途 |
|---|---|
| `POST /machines` | 注册（`labels + bmc{address,protocol,credential_id} + ssh_credential_id + ssh.address`），注册即自动盘查 |
| `GET /machines` | 列表；过滤仅 `state` + `labels`（可重复精确匹配）；分页+排序；**无模糊搜索** |
| `GET/PATCH/DELETE /machines/{id}` | 详情 / 改 labels·bmc·ssh / 注销 |
| **`POST /machines/{id}/install-plan`** | **只读试算**：body=InstallSpec → `driver / resolved_disks[]{device,matched_by,serial,size_bytes,keep,planned_partitions[]} / boot_drive / warnings[]`；422 与真实提交同源校验。**spec 表单实时预览的官方支点** |
| `GET /machines/{id}/layout` | 最新分区快照（404=尚无） |
| `GET /machines/{id}/bios` | 活读 BIOS 属性（同步 BMC，502=BMC 错） |
| `GET /machines/{id}/drives` | 活读物理盘表（serial 即 erase_drives 身份） |
| `GET /machines/{id}/console` | 一次性 KVM URL——**真机现状恒 502 `BMC_UNSUPPORTED`**，前端须能力降级 |
| `POST /machines/{id}/actions` | 单机动作统一入口，恒 202+Job。`type` 判别：`discover(probe: auto\|redfish\|inband_ssh\|ramdisk + boot)`、`power_on/power_off/soft_off/reboot/hard_reboot/cycle`、`set_boot_device(device: pxe\|disk\|cdrom\|bios, once 默认true)`、`mount_media(image_url, eject_after)`、`eject_media`、`set_bios_attributes(attributes, confirm)`、`erase_drives(serials[]\|all, confirm)` |

### 零注册
`GET /pending-machines`（无分页）、`GET /pending-machines/{mac}`、`POST /pending-machines/{mac}/claim`（body=MachineCreate，201 消费台账；409 地址冲突；422 校验失败）。

### jobs / 观测
| 端点 | 用途 |
|---|---|
| `POST /jobs` | 提交（202+Job）。`type + targets{machine_ids[], overrides{mch_id: spec 片段浅合并}} + spec + action + policy{concurrency 默认10, on_task_failure: continue\|abort_batch, verify_layout 默认true, task_timeout_seconds 默认3600}`。**409=JOB_MACHINE_BUSY**；404 机器不存在；422 语义校验 |
| `GET /jobs` / `GET /jobs/{id}` | 列表（过滤 type/state）/ 详情+summary |
| `POST /jobs/{id}/cancel` | 取消（停调度+补偿：弹介质/恢复引导序；409 已终态） |
| `GET /jobs/{id}/tasks` / `.../tasks/{taskId}` | 任务列表（过滤 state）/ 详情（stages 明细） |
| `GET /jobs/{id}/tasks/{taskId}/logs` | **执行日志**，游标按 log id；**近实时靠轮询，日志 SSE 未做（roadmap 标"后续可选"）** |
| `POST .../tasks/{taskId}/retry` | 重试（仅 failed/interrupted，从 last stage 续跑；409 非法状态） |
| **`GET /jobs/{id}/events`** | **job 级 SSE**（`text/event-stream`，Bearer 适用，`Last-Event-ID` 断线续传） |
| **`GET /events/stream`** | **全局 SSE**（查询参数 `resource=job_x9k2` 可过滤单资源） |
| `GET /events` | 事件查询（审计+backlog）：过滤 resource_type/resource_id/type，游标分页 |
| `POST/GET /webhooks` 等 | webhook 管理（secret 仅创建时显示一次） |

### 机器面端点（免 token，前端不直调）
`/render/{token}/{file}`、`POST /render/{token}/probe-report`、`POST /render/{token}/complete`、`/netboot/script?mac=&arch=`、`/netboot/files/{token}/{file}`、`POST /netboot/enroll/{token}?mac=`、`/netboot/enroll-file/{name}`。

### 错误码 → 前端文案映射素材
域前缀 `SCHEMA / CREDENTIAL / BMC / LAYOUT / MEDIA / INSTALL / NETWORK / JOB`。已确认：`BMC_UNREACHABLE`(retryable) / `BMC_AUTH_FAILED`(不可重试) / `BMC_UNSUPPORTED` / `BMC_PROTOCOL_ERROR`、`CREDENTIAL_AUTH_FAILED`、`NETWORK_UNREACHABLE`、`LAYOUT_DRIFT`（执行时现场校验防装错盘）/ `LAYOUT_DISK_NOT_FOUND` / `LAYOUT_SNAPSHOT_REQUIRED` / `LAYOUT_PARSE_FAILED`、`SCHEMA_INVALID_STORAGE` / `SCHEMA_UNSUPPORTED_BOOT_STRATEGY` / `SCHEMA_FIRMWARE_MISMATCH` / `SCHEMA_NOT_FOUND` / `SCHEMA_NOT_READY`、`SELECT_AMBIGUOUS`、`INSTALL_TIMEOUT` / `INSTALL_NOT_REACHABLE` / `INSTALL_INTERNAL`、`MEDIA_MOUNT_FAILED`、`JOB_CONFLICT` / `JOB_IDEMPOTENCY_CONFLICT` / `JOB_MACHINE_BUSY`、`BIOS_CONFIRM_REQUIRED` / `BIOS_ATTRIBUTE_UNKNOWN`、`DRIVE_ERASE_CONFIRM_REQUIRED` / `DRIVE_SERIAL_UNKNOWN`、`RENDER_FAILED`。**高危确认类是 422（提交期拒绝不建 job），busy 是 409**。

## 三、关键工作流（前端要引导用户走完的流程）

### 1. 注册机器（"人找机器"）
```
POST /credentials（BMC 账密 → cred_id）
→ POST /machines {bmc:{address, protocol, credential_id}}   # protocol=auto：先 Redfish 后降级 IPMI
→ 自动盘查：state registering→discovering
→ 轮询/SSE 观察 state=ready + hardware/firmware 回填
→ (可选) 配 ssh 凭证+address 或 POST actions{type:discover} 补分区快照
```
`protocol=fake` 可做演示模式。

### 2. 零注册（"机器找平台"）
前提：引擎部署开启 `MAMMOTH_PXE_ENABLED` + `MAMMOTH_PXE_ENROLL`（token 必配）。
```
未知机器 PXE 广播 → proxyDHCP 旁路应答
→ ① option 93 观测：MAC+固件写入 pending_machines（只需 PXE 一次）
→ ② iPXE 分派 enroll 脚本 → alpine 内存环境 /sys 扫描 → POST /netboot/enroll → report 落同一台账行 → 探针自断电
→ 管理员：GET /pending-machines 看 MAC/固件/盘查报告/首见时间
→ 按序列号认出机器、取得 BMC 账密 → POST .../claim {bmc:...}
→ 201：注册+固件观测迁入+第一份 layout 快照迁移+台账消费
```
UI 要点：sighting 是"等认领"不是任务；report 可能为 null（机器只 PXE 了一次没进探针）；**claim body 与建机器完全一致——表单可复用**。

### 3. 探针三条路径
| 路径 | 触发 | 粒度 | UI 呈现 |
|---|---|---|---|
| `redfish` | 注册自动 + 随时 discover 刷新 | 规格级 | hardware 展示；`coverage:partial` 时展示 coverage_notes |
| `inband_ssh` | 配 ssh 凭证+address 时随 auto | **分区级** | layout + `captured_at` 时效提示（契约明确要求） |
| `ramdisk` | `actions{type:discover, probe:ramdisk}`，需 RAMDISK_ENABLED | 分区级 | discover 任务 probe stage → `machine.layout_captured` 事件 → 刷新 layout |

### 4. 装机主流程
```
① InstallSpec：image(source+checksum+distro) / storage / network / identity / access / scripts / boot
② POST install-plan 只读试算 → resolved_disks(逐盘 matched_by 可解释)/boot_drive/warnings
③ POST /jobs {type:install, targets, spec, policy} → 202
④ 六阶段流水线：verify_layout(选择器解析+keep 绑定快照) → configure_raid → prepare_media(渲染+重打包 ISO 或 PXE 树)
   → boot(vMedia 一次性引导 / PXE+上电) → install_os(%pre 现场校验，LAYOUT_DRIFT 显式失败) → verify_ready(SSH 探活+装后快照)
⑤ 终态：succeeded / failed(error.code) / interrupted(可 retry)
```
四种安装器方言（`distros[].family`）：`kickstart`（rocky/centos/kylin/UOS）、`autoinstall`（ubuntu 22.04/24.04）、`preseed`（debian 12/13）、`unattend/agent`（windows 2019，**UEFI-only**；`boot.installer: setup|agent|auto` 双通路）。**方言差异在渲染期显式拒绝**（`RENDER_FAILED`；如 debian 无 bond/vlan、windows 无 RAID）——前端应在选 distro 后按矩阵即时预校验。
进度/日志：stages（状态+duration_ms）+ job 级 SSE + task_logs cursor 轮询 + syslog 归因日志。**root 密码**缺省按任务随机 → 监听 `task.root_password` 一次性弹出。

### 5. 原子操作与两段式确认
全部 `POST /machines/{id}/actions` → 202+Job，**无同步 BMC 端点**（统一异步）。高危两个：`set_bios_attributes`、`erase_drives`——**两段式确认**（`confirm:true` 缺省 422；策略经 capabilities 导出；runner 活表二次校验永在）。erase_drives 需要"先读 `/drives` 选 serial 再擦"的强引导。

### 6. pre/post 脚本（spec.scripts）
`{stage: pre_install|post_install, shell: cmd|powershell(仅 windows), content_base64|url, expected_exit_codes[]}`。Linux post_install 走 %post+回调；windows post_install=引擎托管首启链，pre_install=仅 setup 通路 WinPE RunSynchronous（限 cmd+inline）、agent 通路渲染即拒。声明式管辖的启动盘脚本不得触碰（schema 拒）。

## 四、配置与运维面（决定 console 的部署形态）

- **引擎配置**：12-factor `MAMMOTH_*`（70+ 项，权威源 `internal/config/config.go`）。关键：`HTTP_ADDR(:80)`、`EXTERNAL_URL`（机器侧回调基地址）、`DATABASE_URL`（PostgreSQL≥14 **唯一强依赖**）、`API_TOKEN`、`MASTER_KEY`（凭证静态加密，轮换即作废存量凭证）、`MEDIA_DIR/WORKDIR/BASE_URI`（介质仓库+NFS）、PXE 族（`PXE_ENABLED/MODE(builtin|external)/NEXT_SERVER/DHCP_POOL/ENROLL/ENROLL_TOKEN`）、探针族、windows 族、高危确认策略、观测族。
- **部署形态**：单二进制多模式 `serve --mode=all|api|runner|builder|prober`；双镜像 `mammoth`（distroless）+ `mammoth-builder`（alpine+xorriso）；deploy/ 提供 all-in-one、faceted（1 api + N runner + 1 builder）、TLS（Caddy）三套 compose。PXE 需容器在装机 L2 上。
- **引擎无静态资源目录、无反代托管前端的现成机制**——console 的部署形态需自行定义（Caddyfile 可参考）。
- **认证/多租户/RBAC：没有**。单一静态 Bearer token，契约注明"首版静态 token，预留外部 IdP 适配点"。console 若要多用户必须自建认证层。
- **可观测**：`/metrics` Prometheus（job/task 计数、stage 耗时直方图、bmc 时延、队列深度）；结构化 JSON 日志；OTel span；审计事件全落 events。
- **CLI 已存在**（cobra+goreleaser：批量注册/盘查/安装提交/watch 跟踪）——console 的交互参照物；契约生成 TypeScript SDK 是官方推荐接入方式。

## 五、roadmap 与 UI 的关系

- roadmap **没有任何 UI/控制台规划**——"引擎保持纯粹，界面属于集成方"是有意为之（01 §2 明确列为"不提供"）。mammoth-console 就是那个官方集成方。
- v1.0 契约冻结、仅新增演进——**console 可放心以当前契约为地基**。
- 与前端直接相关的后续项：**logs SSE（标"后续可选"，console 是它的第一候选用户）**；KVM SSO 直链（待二期，现状真机不可用）；多机 RAID/LVM 拓扑编排（spec 面扩展）；arm64 引导链。

## 六、前端视角：现成 / 缺失 / 翻译门槛

### 现成的（直接对接）
- 观测三件套：job 级 SSE + 全局 SSE（Last-Event-ID 续传）+ 事件查询；stage 粒度状态与耗时；结构化 task_logs。**观测层信息架构可直接建在 event.type 枚举上**。
- `install-plan` 试算：配置向导确认页的官方支点（resolved_disks 逐盘 matched_by 可解释）。
- capabilities 自描述：功能开关/菜单显隐全部由它驱动。
- 幂等、游标分页、RFC 9457 结构化错误 + `retryable` 标志。
- 零注册全链三端点齐全，claim 复用注册表单。

### 缺失的（v1 需绕行，建议反馈引擎）
1. **无批量打标签/批量删除/批量 retry**——批量只有 job（install/power/discover 三种），其余需前端逐个调用。
2. **machines 无模糊搜索**（仅 state+labels 精确过滤）；按 serial/MAC/IP 搜机器需前端缓存过滤或反馈引擎加 `q=`。
3. **无日志/事件 SSE**——进度条可用 job SSE，日志尾随只能 cursor 轮询。
4. **无 images/templates 资源**——spec 模板复用"由客户端管理"，console 需自建"安装方案"存储层（v1 本地，v2 后端化）。
5. **`task.root_password` 一次性事件**——console 需即时捕获展示；是否持久化敏感数据要想清楚（v1 建议不持久化）。
6. **无 machine 级"当前任务"反查**——判断 busy 需查 job 列表推断；前端应订阅全局 SSE 维护 busy 缓存做预检，避免重装按钮频繁吃 409。
7. **KVM 真机不可用**——按 capabilities 降级呈现，不做常驻入口。

### 概念翻译门槛（文案层）
- **快照时效**：layout 带"可能过期，点击刷新（触发 discover）"。
- **三档存储语义**（wipe / keep:disk / keep:partitions+preserve）与"带内不可达只支持 keep:disk"、`LAYOUT_DRIFT` 的含义需要专门解释。
- **两段式确认**天然做成"读活表→选目标→显式 confirm"三步向导，与契约同构。
- **机器状态 ≠ 任务状态**：`machine.state=ready` 不代表没有进行中的任务；`interrupted`（可重试）vs `failed` 文案要区分；job 的 `partial`=批次半成功。
- **windows 两段式启动**（boot one/two、SMB 前置）需要可视化解释。
- **零注册叙事**：pending 列表空态文案可用 docs/11 的"登记本"比喻。
- **PXE 排障**：装机失败会涌来 PXE-E53/E55/E32 类问题，建议做"装机网络健康"引导内容。

## 七、2026-09-24 引擎新增能力（commit b21700f）

四项新特性全部面向前端可用，类型已随 `npm run gen:api` 进入 `types.gen.ts`。

### 7.1 BMC 健康面（活读，仅 Redfish；IPMI → 422 BMC_UNSUPPORTED）

| 端点 | 返回 |
|---|---|
| `GET /machines/{id}/health` | `HealthView`：`power_state` + `health`（ok/warning/critical/unknown，全机 worst-of）+ `sensors[]{name, reading?, unit(RPM\|Celsius\|Watts\|Volts\|Percent), state}` |
| `GET /machines/{id}/sel` | `SELView.entries[]`（倒序、截断 500）：`{id, timestamp?, severity(ok/warning/critical/unknown), message}` |

同步活读端点（同 bios/drives），不可进列表批量拉取；读不到的传感器 state=unknown，不拖累整体结论。

### 7.2 镜像工件库（新资源，images）

| 端点 | 语义 |
|---|---|
| `POST /images` | 注册：`name? + source_url(http/s) + sha256(64hex 必填) + distro?/version?`（信息性） |
| `GET /images`、`GET /images/{id}`、`DELETE /images/{id}` | 游标分页 / 详情 / 删除 |

- `Image.state: fetching → ready | failed`（failed 带 error：校验和不符 / 源不可达）；ready 后 `size_bytes` 可用。
- sha256 是**门禁**不是元数据：下载边流边哈希，不符不落缓存；同 digest 多注册共享缓存文件。
- 装机意图新引用方式：`spec.image.id` 指向注册件，**与 `spec.image.source` 互斥**（校验与解析都在引擎侧完成）。

### 7.3 装后软件源渲染（spec.package_source）

`package_source.repos[]: {name, url, gpg_key_url?, suite?, components?}`：
- `name` 即文件名，字符集限定 `[A-Za-z0-9._-]`；url 限 http(s)；
- `suite` 缺省按发行版代号自动取（jammy/noble/bookworm/trixie）；
- 四方言渲染（anaconda repo 指令 + %post、autoinstall deb822、d-i sources.list.d）；**windows 渲染即拒**。

### 7.4 装前硬件健康门禁

- 内存盘探针逐盘采集 smartctl/nvme 健康读数 → **layout 快照 `disks[].health: pass\|fail`**（工具缺失/不报则留空，无证据不下结论）。
- `policy.health_gate: off（缺省）\| report \| block`：
  - report：坏盘进 install-plan `warnings`，不拦截；
  - block：提交期 422 `HEALTH_GATE_FAILED`（problem detail 点名坏盘 serial）；无快照/无健康数据的机器照常装机。

### 7.5 对 console 的影响速查

| 新能力 | console 落点 | 里程碑 |
|---|---|---|
| 镜像库 | 新一级页面（列表/注册/删除/状态轮询）；向导镜像步骤改"库选择（image.id）/内联 source"二选一 | M2b |
| package_source | 向导 Step2 软件源编辑区；windows 方言前端即拒 | M2b |
| health_gate | 向导 Step4 policy 三档选择；`HEALTH_GATE_FAILED` 错误码文案（含坏盘 serial 名单） | M2b |
| 磁盘健康 | 机器详情磁盘表 health 徽章（pass/fail/无数据） | M2c |
| BMC 健康面 | 机器详情"硬件健康"卡片（overall 徽章 + 传感器表） | M2c |
| SEL | 机器详情"硬件日志"卡片（severity 着色） | M2c |
