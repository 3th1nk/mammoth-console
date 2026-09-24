# 01 · 竞品调研：裸金属装机控制台

> 调研日期：2026-09-24。目的：为 mammoth-console（mammoth 裸金属装机引擎的官方 Web 控制台）确立设计参照系——行业惯例是什么、用户默认期待什么、哪些差异点值得放大。
> 结论先行见 [§9 横向小结](#9-横向小结)，对 mammoth 的落地启示见 [§10](#10-对-mammoth-console-的启示)。

## 1. Canonical MAAS（业界标杆）

**定位**：Metal as a Service——把物理数据中心变成类云裸金属资源池。开源 + Canonical 商业支持，目标用户是企业/云基础设施团队。

**机器生命周期状态模型**（官方已验证枚举）：`New → Commissioning → Ready → Allocated → Deploying → Deployed`（部署后状态列直接显示 OS 名），失败态 `Failed Commissioning / Failed Deployment / Broken`，救援态三态，另有 `Locked` 挂锁叠加任意状态防误操作。关键设计：**状态决定可用操作**（只有 Ready 可改网卡/存储，不可用动作灰置）。

**信息架构**：机器入口 `Hardware > Machines`，单机 `/machine/<SYSTEM_ID>/summary`。模块域可从 API 对象面反推：machines、devices、controllers、pods（KVM）、images、网络全家桶（fabric/vlan/subnet/dhcpsnippet）、tag、zone、resource-pool、discovery。

**装机交互**：以列表为中心——多选机器 → Take action 菜单（Commission/Deploy/Release…）→ 选 OS 镜像。运维惯例"Commission before deploy"（先体检再装机）。搜索条是亮点：帮用户生成可复制的搜索语法（如 `pod:!cattle`）。

**批量/分组**：多选批量、tag、resource pool、availability zone 标配。

**UI 技术栈**（canonical/maas-ui 已验证）：React + Redux Toolkit + TypeScript + Vite，样式用 Canonical Vanilla Framework；数据层**双通道：TanStack Query 走 REST + Redux 走 WebSocket**；OpenAPI 生成 TypeScript 客户端；Storybook + Vitest + Cypress + Playwright。

**亮点与槽点**：亮点是状态-操作耦合、搜索语法、双通道实时刷新、Commissioning 先行理念。槽点是十年 AngularJS→React（经 single-spa 微前端）迁移，全品类最大的前端技术债案例；文档站改版后大量旧 URL 断链。

## 2. Tinkerbell（CNCF，与 mammoth 同定位的引擎）

**定位**：裸金属 provisioning 引擎——BMC 交互（Redfish/IPMI）、DHCP/iPXE（smee）、metadata service（Hegel）、内存盘安装环境（Hook）、workflow 引擎（tink）。

**UI 现状（关键事实）**：tinkerbell org 下**已无独立 UI 仓库**；当前 UI 内嵌主仓库 `/ui` 目录、随主二进制一起编译（go:embed）。技术栈：**templ（Go 编译型模板，服务端渲染）+ Tailwind CSS**。已验证功能：暗/亮模式、移动端响应式、全局搜索、可折叠导航。信息架构以四类资源为中心：Hardware / BMC / Templates / Workflows，与 CRD 模型一一对应。

**Workflow 观测**：workflow 是一等资源有列表/详情页；串口 over SSH 作为装机现场观测通道。

**亮点与槽点**：亮点是 UI 与引擎同生命周期（单二进制交付，与 mammoth 定位完全一致）、SSR 选型极轻（无 Node 构建税）。槽点是 UI 长期缺位、反复（独立 UI 仓库消失、社区插件补位）——**backend 引擎的 UI 若不随主仓库交付就很难存活**，对 mammoth 是直接前车之鉴。

## 3. Foreman

**定位**：全生命周期服务器管理（provisioning + 配置管理 + Katello 内容管理），物理虚拟通吃，强 Puppet/Ansible 集成。当前版本 5.0。

**核心建模**：Hosts / **Host Groups**（参数与模板继承树）/ Provisioning Templates（ERB 渲染 kickstart/preseed）/ Media / Smart Proxies / **Organizations & Locations 双维多租户**。

**发现/认领交互**（Discovery 15.0 手册已验证）：未注册机器 PXE 进 Discovery Image → 自动上报 Facter 事实 → 出现在 Discovered Hosts 页 → 点 Provision 跳转主机编辑页并**自动回填发现数据** → 保存后改写 PXE 重启装机。另有 Discovery rules：按条件自动认领（默认关闭）。——这与 mammoth 零注册认领是同构物，交互范式已被市场验证。

**UI 技术栈与现状**（2025-11 社区帖已验证原文）：Rails 后端 + React + PatternFly，插件以独立 React 插件懒加载。痛点：Enzyme 快照测试卡死 React 18 升级；社区在反思"一个最多 10 个并发会话的工具是否需要 React"；共识方向是通用表格/show 页组件 + **UI 专用 API endpoint**（"UI is stateful… should not use the same endpoint as the official API"）。

**亮点与槽点**：亮点是 host group 继承树、Discovery rules、双维多租户。槽点是安装运维复杂度高、前端 React 技术债深。

## 4. OpenStack Ironic / OpenShift Assisted Installer（红帽系）

**Ironic**：API 服务，**无官方独立 Web UI**，仅 ironic-ui（Horizon 插件）查看 node/port/driver。裸金属一般经云管平台消费，UI 体验取决于上层。

**OpenShift Assisted Installer**（红帽装机 UI 代表思路，2026 版文档已验证章节结构）：托管在 console.redhat.com，**向导式**——集群详情 → 发现 ISO（USB / Redfish vMedia / iPXE 三种启动）→ 主机配置（角色/安装盘）→ 网络（**静态网络同时提供 form view 与 YAML view，双视图是明确的产品决策**）→ manifests → 安装。防错是核心设计：**Preflight validations 分 host/cluster 两级、blocking 与 non-blocking 两类**，配专属排障文档。

**启示**：装机 UI 可以做成"托管向导 + 密集校验"而非资源列表——当对象是"一次性交付"而非"常驻机器池"时。

## 5. Cobbler（cobbler-web）——反面的教训

事实链（均已验证）：旧 Django 版 web UI 与内部实现强耦合，官方自认"preventing needed change inside the internals"；2022-11 路线图在 3.3.x **直接移除旧 UI 而新 UI 未就绪**，用户一度没有任何 Web 界面；新 cobbler-web 是独立 Angular 应用（活跃，含 Playwright E2E、独立 Docker 部署）。

教训四条：
1. UI 与后端内部 schema 强耦合 = 双向枷锁；
2. 先删旧 UI 再上新 UI 透支信任；
3. 对象 CRUD 列表 ≠ 装机生命周期工作流——Cobbler 用户长期依赖 CLI 完成真实流程；
4. 前端拆独立仓库的部署税，对单二进制项目尤其沉重。

## 6. Equinix Metal（商业裸金属门户）

**重大事实**：2024-11 停止新售，2026-06-30 正式停服；控制台文档已撤下。底层自动化正是其开源的 Tinkerbell。

已验证的结构：Organization → Projects 层级；Project 内以 "Bare Metal Servers" 交付，惯例为 **Metro（区域）→ 机型 → OS** 三步部署；能力域含设备详情（Overview/Network/Storage/Hardware/Events）、VLAN、BGP、SSH keys、SOS 串口。

**启示**：metro-机型-OS 三步交付是商业裸金属的黄金交互；"控制台只是 API 的皮"（API 用户与控制台用户并存）是其被验证的路线；同时 SaaS 托管 UI 的厂商停服风险由客户承担——self-hosted 交付是裸金属工具的正确姿势。

## 7. RackN / Digital Rebar

**事实澄清**：公开互联网查不到名为"RackN 数字引力"的国内独立产品；RackN 是美国公司（Digital Rebar/DRP 引擎）。国内可类比的带 UI 开源项目是 FIT2CLOUD 的 **RackShift**（发现/带外/RAID/装机，已长期不活跃）。

**官方 UI：RackN Portal**（docs.rackn.io 已验证）：**SaaS 托管 SPA**，经 REST + WebSocket 连接用户自己的 DRP endpoint（URL 路由多端点）。UI 组件：side navigation、table views、bulk actions、inspector views、wizards。特色：Trigger Buttons（预置操作一键化）、**UX Views（按角色换肤的定制视图）**、内置快速过滤 `uxv-failed-machines / uxv-failed-jobs`——**把"失败机器/失败任务"做成一级过滤入口**，值得直接借鉴。

**槽点**：UI 托管在厂商 SaaS 而非随引擎交付，气隙环境要专门适配；社区版/商业版边界以 license 门槛卡功能。

## 8. 云厂商裸金属控制台（阿里云 EBM / 华为云 BMS）

- 阿里云：裸金属是 ECS 实例的一种规格，**完全融入 ECS 控制台**，不存在独立裸金属控制台。
- 华为云 BMS：状态枚举为运行中/关机（稳定态）+ 创建中/重启中/重装操作系统中/删除中（中间态），中间态下部分操作禁止；API 层区分 SOFT/HARD 重启。

**公共云惯例**：状态 = 供电/运行而非装机状态；操作列 + "更多"菜单；地域/资源组两个全局过滤器；标签体系与监控打通。云厂商把"装机"从用户视野中完全抹掉——那是公共云商业模式决定的，不是 self-contained 引擎该学的。

## 9. 横向小结

### 9.1 行业惯例清单（用户默认期待，缺了就是缺陷）

1. **机器列表是默认首页**：列含状态、电源、厂商/型号、分组、OS；多选批量操作。
2. **生命周期状态模型**：稳定态 + 过渡态 + 失败态三分，徽章呈现；**状态驱动操作菜单**（不可用动作灰置/锁定）。
3. **自动发现 → 人工认领**的标准链路：新机器"自己出现"在待认领区（MAAS enlist、Foreman Discovery、Tinkerbell auto-discovery），用户补凭据/归属后认领。
4. **装机 = 选中机器 + 动作菜单（选镜像/参数）**；参数靠群组/模板/标签继承，不逐台填写。
5. **每任务步骤状态 + 日志流**观测进度，配合 WebSocket/SSE 实时刷新。
6. **镜像/模板管理是一级模块**。
7. **电源/BMC 原子操作**（on/off/cycle、boot device、vMedia）与装机并列进动作菜单，高危操作有确认与防误锁。
8. 分组用 tag / pool / zone 之一即可起步；多租户 RBAC 可后置。
9. 网络基础（DHCP/PXE）要么是一级模块，要么显式声明交给上游。

### 9.2 常见差异点/争议点

| 争议点 | 各家选择 | 备注 |
|---|---|---|
| 向导式 vs 列表+动作式 vs 声明式 | Assisted Installer=向导+密集校验；MAAS/Foreman=列表+动作；Tinkerbell/DRP=声明式 workflow | 两种心智对应两种场景（一次性交付 vs 常驻机器池），混用会拧巴 |
| 表单 vs YAML | Assisted Installer 静态网络给 **form + YAML 双视图** | 对"两类用户"的正式妥协方案，已被验证是对的 |
| UI 走不走公开 API | Foreman 社区 2025 仍在争论 UI 专用 endpoint；MAAS 用 REST+WebSocket 双通道 | API-first 项目必须显式决策 |
| UI 交付形态 | 同进程（MAAS）/ 独立仓库独立部署（cobbler-web）/ SaaS 托管（RackN Portal）/ **内嵌主二进制 SSR（Tinkerbell templ）** | 最后一种是近两年新趋势，与 mammoth 定位最吻合 |
| 前端技术栈 | MAAS/Foreman/OpenShift console 全是 React 系；cobbler-web Angular；Tinkerbell Go templ | 品类通病是前端技术债；教训一致：UI 层别与后端 schema 强耦合，选型考虑十年可维护性 |

### 9.3 竞品都没做好、值得 mammoth 放大的点

- **装机意图的"渲染结果预览"**：Foreman 藏在 ERB 模板里，MAAS 藏在 curtin 里——用户从来看不到将写进机器的最终应答文件。mammoth 有 `POST /machines/{id}/install-plan` 只读试算 + 四方言渲染，天然能做出"所见即所装"的确认页，这是全品类最薄弱的点。
- **失败即一级视图**：只有 DRP 把 failed-machines/failed-jobs 做成一级过滤入口，MAAS/Foreman 都藏在列表过滤里。
- **API-first 的可视化**：没有一家在 UI 上提供 "Copy as cURL"。mammoth 以 API-first 为卖点，控制台可以把它变成可感知的差异化。

## 10. 对 mammoth-console 的启示

**必须做（行业默认期待）**：机器列表 + 三态徽章 + 状态驱动动作菜单；电源/启动设备/vMedia 原子操作进动作菜单；单机详情（硬件探针产出、layout、任务历史、日志）；**待认领区做成一等公民**（范式已被 MAAS/Foreman 验证，直接沿用降低学习成本）；装机表单 + 渲染预览；job 步骤可视化 + 失败任务一级过滤；镜像/模板、设置页；标签 + 批量。

**可以砍（竞品有但定位不需要）**：KVM 虚拟机托管、DNS/DHCP 全套网络服务管理、内容管理/订阅、复杂多租户 RBAC 与多站点、云厂商式"抹掉装机"的抽象。

**差异化放大**：
1. **单二进制 + 内嵌/伴生 UI**（学 Tinkerbell `/ui`、避开 cobbler-web 拆分税与 RackN SaaS 信任税），首启 Onboarding 向导把"开箱即用"变成可感知的 15 分钟体验；
2. **API-first 的可视化**：UI 全走公开 API，每个操作面板配 "Copy as cURL"；声明式意图给 form + YAML 双视图；
3. **零注册认领做成标志性流程**：首页实时"新机器出现"流，把竞品藏在菜单深处的 enlist/discovery 提到门面上；
4. **install-plan 试算预览**："所见即所装"的装机确认页；
5. **技术选型保守而轻**，避免重型状态管理与快照测试依赖（Foreman 之鉴）；路由/文档 URL 结构一次定好（MAAS 之鉴）。

## 附：信息来源

- MAAS：discourse.maas.io/t/concepts-and-terms/785、canonical.com/maas/docs/how-to-manage-machines、github.com/canonical/maas-ui（docs/MAASUI.md）
- Tinkerbell：github.com/tinkerbell/tinkerbell（含 /ui 目录）、github.com/tinkerbell/hook、CNCF LFX Mentorship 2026（Headlamp 插件）
- Foreman：docs.theforeman.org（5.0）、theforeman.org/plugins/foreman_discovery/15.0、community.theforeman.org/t/44860
- 红帽系：github.com/openstack/ironic-ui、docs.redhat.com（Assisted Installer 2026）
- Cobbler：cobbler.readthedocs.io、cobbler.github.io（2022-11 路线图）、github.com/cobbler/cobbler-web
- Equinix Metal：docs.equinix.com（残留文档与 sunset 公告）、datacenterdynamics/sdxcentral 报道
- RackN：docs.rackn.io/stable/operators/portal/（含 ux-views）、github.com/fit2cloud/rackshift
- 云厂商：help.aliyun.com（EBM 融入 ECS）、support.huaweicloud.com/bms
