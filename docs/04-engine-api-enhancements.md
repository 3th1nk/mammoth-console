# 04 · 引擎 API 增强（console 驱动，契约 additive 演进）

> mammoth-console 对 mammoth 引擎的 API 增强需求与契约设计。引擎契约 v1.0 已冻结、允许 additive 演进（新端点/新字段/新枚举值，不改既有语义）——本文所有提案均遵守该约束。
> console 是这些能力的第一个用户；每项都给出 console 侧消费点与验收标准。状态：**A1–A7 已全部在 mammoth 仓库落地**（契约 additive + 实现 + 测试全绿；A7 落地后 console 的文件名启发式已删除）。

## 0. 总览

| # | 提案 | 优先级 | console 消费点 | 解决的现状缺口 |
|---|---|---|---|---|
| A1 | 机器列表模糊搜索 `q=` | P0 | 顶栏全局搜索、机器列表搜索框 | machines 仅 state+labels 精确过滤，无法按序列号/BMC 地址/MAC 找机器 |
| A2 | 机器活跃任务反查 | P0 | 机器行"进行中"徽章、重装前 busy 预检（消 409）、详情页任务历史 | 无 machine 级任务反查，busy 只能靠 409 事后得知或全量扫 job 推断 |
| A3 | 零注册 sighting 事件 | P0 | 待认领页实时流入、导航徽章、认领后跳转新机器 | pending_machines 无任何事件，只能轮询 |
| A4 | 任务日志 SSE | P0 | 日志查看器从 2s 轮询升级为真尾随 | 日志只有 cursor 轮询，roadmap 标"后续可选" |
| A5 | 批量标签操作 | P1 | 机器列表多选打标签 | 无批量标签端点，只能逐机 PATCH |
| A7 | 镜像发行版自动识别 | ✅ 已落地（fetch 时嗅探回填，console 启发式已删） | 同左 | 同左 |
| A6 | 只读配置快照（脱敏） | P1 | 设置·能力面板"当前生效配置"+ 排障指引 | 配置只能看部署环境，用户排障无入口 |

明确**不做**：配置修改 API（决策见 §A7）、镜像/模板资源（console 自管）、KVM SSO（引擎二期）。

## A1. 机器模糊搜索（P0）

```
GET /api/v1/machines?q=<term>&state=&labels=&page_size=&cursor=&order_by=&order=
```

- `q`：1~200 字符，大小写不敏感**子串**匹配，与既有过滤条件 AND 组合；缺省/空串视为未提供。
- 匹配字段（**v1 落地范围**）：
  - `mch_id`（子串，支持粘 ID 片段搜索）
  - `bmc_address`
  - `serial_number`
  - `vendor` / `model`
  - `labels` 的 key 与 value（jsonb 文本化匹配）
  - LIKE 元字符（`%`/`_`/`\`）一律按字面处理，不作为通配符
  - **MAC 暂不在 v1 范围**：NIC MAC 存于 `hardware` JSONB 数组内，无标量列；文本化整列匹配会误命中（如把 PCI 地址当 MAC），留待后续以表达式索引或归一化列实现
- 响应结构不变（仍是 MachineList 分页）；游标键随 `order_by` 走（本次顺带修齐了契约已声明但实现忽略的 `order_by=updated_at`）。

**验收**：按序列号片段、BMC IP 片段、MAC（任意分隔符风格）、label 值四类输入均能命中；`q` 与 `state` 可叠加；空 `q` 等价于无参。

## A2. 机器活跃任务反查（P0）

```
GET /api/v1/machines/{id}/current-tasks
200 {"items": [TaskRef]}        # 无活跃任务时 items 为空数组
404 机器不存在
```

`TaskRef`：`{task_id, job_id, flow_name, state, attempt, started_at}`，按创建时间升序。**返回全部非终态任务**（`pending|running|interrupted`）而非单条——引擎只对 install×install 互斥（409 JOB_MACHINE_BUSY），power/discover 可与 install 并行，单数语义不成立。

**验收**：提交 install 后该端点立刻可见 install task；cancel/终态后清空；unknown machine 404。

## A3. 零注册 sighting 事件（P0）

事件流扩展（additive，**已落地**）：

- `resource_type` 枚举新增 **`pending`**（resource_id = 归一化 MAC，与台账键一致），顺带收编了实现已在用但契约未收的 `webhook`。
- 事件类型（落地命名）：
  - `pending.sighted`——**仅首见**（台账行创建）时发一次；PXE DISCOVER 重试风暴不产生事件（`TouchByMAC` 返回是否新建，服务端据此发射）；
  - `pending.reported`——enroll 探针报告落库时发（每次探针启动至多一次，非洪泛路径），payload 含盘数；
  - 认领事件**复用既有的 `machine.claimed`**（payload 含 mac/firmware，console 收到后把 sighting 行变为"已认领 → 查看机器"），不新增重复事件。
- `GET /api/v1/events` 的 `resource_type` 过滤与全局 SSE 均可消费新类型。

**验收**：插电一台未知机器 → 全局 SSE 收到 `sighted`；探针上报后收到 `reported`；claim 后收到 `machine.claimed`；反复 PXE 重试不产生新事件。

## A4. 任务日志 SSE（P0）

```
GET /api/v1/jobs/{id}/tasks/{taskId}/logs/stream?after=<log_id>
Content-Type: text/event-stream
```

- 语义与现有 events SSE 对齐：Bearer 认证；`Last-Event-ID` 头 = 最后收到的日志 id，**优先于** `after` 查询参数（断线续传）；事件 id = 日志 id（单调）。
- 行为（**已落地**）：连接后先按 id 升序**回放** `after` 之后的存量日志（立即分批 flush），再持续推送新日志（帧事件名 `log`）；任务进入终态（succeeded/failed/canceled）且回放排空后发 `event: eos` 并关闭——客户端据此停止重连；`interrupted` 不收流（重试续跑同一任务，流直接接上新日志）。
- **顺带的全局改善**：事件流与日志流共用新的 SSE 循环，空闲期每 15s 发 `: keepalive` 注释帧——修复了原实现无事件时零字节、会被生产代理（nginx 默认 60s read timeout）掐断的问题。
- 无 `level` 过滤参数（与既有 logs 查询端点一致，前端过滤）。

**验收**：装机中打开流 ≤2s 内开始出历史日志；断开 30s 重连后从断点续传、不重不漏；任务成功后收到 eos 且连接自行关闭。

## A5. 批量标签操作（P1）

```
POST /api/v1/machines/batch-labels
{"machine_ids": ["mch_..."], "add": {"env": "prod"}, "remove": ["tmp"]}
200 {"machines": [Machine]}     # 返回受影响机器的最新快照
404 任一 machine_id 不存在（整单拒绝，全有或全无）
422 add 与 remove 冲突（同 key 同时增删）
```

- 同步语义（标签是纯元数据，不值得起 job）；支持 `Idempotency-Key`；单事务提交。
- `add`/`remove` 至少一项非空；`remove` 按 key 删。

## A7. 镜像发行版自动识别（P1）

镜像库的 `distro/version` 字段目前是纯登记信息，靠注册者手工填写；漏填则装机向导无法按镜像自动选择发行版驱动。**建议在 fetch worker 下载完成、sha256 门禁通过后做一次 ISO 内容识别，自动回填空缺的 distro/version**：

- **识别手段（纯 Go，无需外部工具——API 容器是 distroless，不能依赖 xorriso/isoinfo）**：解析 ISO 9660 Primary Volume Descriptor（扇区 16）取卷标 + 根目录记录，按目录/文件指纹判族：
  - `.treeinfo`（内容含 `family = Rocky Linux` / 版本）→ rocky/centos/kylin/uniontechos 等 anaconda 系；
  - `.disk/info`（"Debian GNU/Linux 12 …"）→ debian；`casper/` → ubuntu live；
  - `sources/install.wim` → windows；`apks/` + `.alpine-release` → alpine。
- **契约零变更**：`ImageCreate.distro/version` 本就是可选信息性字段，引擎"注册者未填则自动回填"完全 additive；可在 `Image` 上加只读 `detected: true` 表明来源（可选）。
- **可选探测端点**（注册前/内联场景）：`POST /api/v1/images/detect`，body `{source_url}` → 引擎以 HTTP Range 只拉 PVD（扇区 16）+ 根目录 extent + 标记文件内容，共 **3~4 个请求、传输 <100KB**（镜像源普遍支持 Range；不支持则降级拉头部 1MB；仍识别不出/超时返回 unknown），返回 `{distro, version}`。**耗时约束：5s 超时上限**——识别是锦上添花，绝不阻断表单（前端非阻塞调用，超时/unknown 即由用户手选）。覆盖两类场景：注册对话框粘贴 URL 即时预填；装机向导内联 source（不经镜像库、无登记记录可回填）的识别。注意：库内镜像的识别搭在全量下载（sha256 门禁）上，边际成本为零，探测端点只服务绕过镜像库的场景。
- **console 收益**：识别全部下沉引擎后，console 的文件名启发式删除——注册表单三字段免填；向导内联/库两条路径都自动带出发行版。联动逻辑（按镜像 distro/version 自动选驱动）console 已实现，等引擎落地即全自动。
- console 侧现状：文件名启发式预填已实现（`Rocky-9.4-x86_64.iso` → rocky/9.4，库/内联两路径），**作为引擎识别落地前的过渡，落地后删除**。

## A6. 只读配置快照（P1）——回答"是否提供查看/修改引擎配置"

**查看：提供，但只读且脱敏。**

```
GET /api/v1/config
200 {"config": {"MAMMOTH_HTTP_ADDR": ":80", "MAMMOTH_EXTERNAL_URL": "https://...",
                "MAMMOTH_API_TOKEN": "***", "MAMMOTH_MASTER_KEY": "***", ...},
     "redacted": ["MAMMOTH_API_TOKEN", "MAMMOTH_MASTER_KEY", "MAMMOTH_DATABASE_URL",
                  "MAMMOTH_PXE_ENROLL_TOKEN", "MAMMOTH_WINDOWS_INSTALL_SMB_UNC"]}
```

- 键 = env 变量名（12-factor 事实源的原样投影），值统一字符串化；脱敏键**恒出现在映射中**：已配置为 `"***"`，未配置为 `null`——console 能呈现"已配置/未配置"状态而不泄露值。
- 脱敏为**显式 denylist**（上表 + 实现 时按 `internal/config` 全量字段复核一遍），宁可多脱不漏脱；`DATABASE_URL` 整体脱敏而非只遮密码段，避免拼接方式差异泄漏。
- console 设置·能力面板用它渲染"当前生效配置"表 + 每行附"如何修改"提示（env 名 → `deploy/mammoth.env.example` 锚点）。

**修改：不提供 API，是有意决策，理由：**

1. **单一事实源**：引擎是 12-factor env 配置，引入运行时写路径 = 出现第二配置源 + 持久化/重启语义问题（改了 env 还是内存？重启丢吗？），这是 Cobbler 旧 UI "UI 与内部强耦合阻碍演进"教训的现代版。
2. **安全面**：写配置的 API 等于把 PXE 网段、enroll token、SMB 路径的控制权暴露给持 token 者，而引擎认证只是单一静态 token，无审计主体、无 RBAC——收益与风险不成比例。
3. **品类事实**：MAAS/Foreman 的设置 UI 都以 DB 化 settings 存储为前提（它们是平台）；mammoth 有意不做 settings 子系统，console 不该反向逼引擎长出这个。
4. 排障真正需要的是"看到现在生效了什么"——A6 的只读快照已覆盖；改动走 env/compose 重启，与引擎"部署方管理"的立场一致。

若未来出现确需运行时可调的窄集合（如探针等待预算），再议**白名单式** `PATCH /api/v1/config`，且仍要求落盘可见——本期不做。

## 附：console 侧联动更新

- 03-product-design §7.3 待认领实时性：从"15s 轮询"升级为 A3 事件驱动（保留轮询兜底）。
- §7.5 日志查看器：A4 落地后从 2s 轮询切 SSE，eos 即停。
- §6.2 busy 缓存：叠加 A2 端点做详情页/提交前强校验，SSE 缓存仅作列表徽章的加速。
- §11 开放决策 D5/D6/D7 随本文档关闭。
