<p align="center">
  <img src="public/mammoth.svg" width="72" alt="mammoth-console" />
</p>

<h1 align="center">Mammoth Console</h1>

<p align="center">
  <a href="https://github.com/3th1nk/mammoth">Mammoth</a>——自包含裸金属装机引擎——的官方 Web 控制台。<br/>
  <a href="./README.md">English</a>
</p>

Mammoth 的输入最小化到一个带外地址和一份凭证，产出即是一台装好系统的服务器。引擎保持 backend-only / API-first，本仓库是其官方前端：一个只与引擎公开 API 通信的单页控制台，除此之外无任何私有后端。

## 特性

- **无私有后端**——引擎是唯一事实源。所有能力边界由 `GET /api/v1`（capabilities）驱动，零硬编码。
- **机器全生命周期**——注册（内联新建凭证）、自动盘查、电源/介质/启动动作、健康与 SEL 实时视图、磁盘与 BIOS 面板（两段式确认向导）、注销。
- **装机向导**——四步声明式装机：机器选择（busy 预检）→ 发行版镜像（镜像库/内联二选一）→ 图形化存储（RAID）与网络（bond/VLAN）→ 软件源/脚本，提交前 install-plan 试算预览，所见即所装。
- **任务实时观测**——job/task SSE、日志流（回放+尾随+终态收流）、重试/取消、root 密码一次性捕获。
- **零注册入门**——待认领机器实时流入 + 导航徽章 + 认领流程；引擎未启用 PXE 时给出醒目指引。
- **为运维而生**——事件审计（资源/类型过滤）、HMAC 签名 webhook 订阅（分组可搜索类型选择器）、全局命令面板（⌘K）、暗色模式、全量中文界面。

## 界面预览

**总览**——机器状态分布、进行中任务、开箱向导。

![总览](docs/screenshots/dashboard.png)

**机器列表**——状态徽章、标签、行内电源动作、模糊搜索、全局命令面板（⌘K）。

![机器列表](docs/screenshots/machines.png)

**机器详情**——探针采集的硬件规格（磁盘/网卡）、BMC 实时健康与 SEL 视图。

![机器详情](docs/screenshots/machine-detail.png)

**装机向导**——声明式意图：镜像、存储、网络、主机名、凭据，提交前 install-plan 试算预览。

![装机向导](docs/screenshots/install-wizard.png)

**任务**——批量进度条、SSE 实时任务观测、日志流（回放+尾随）、重试/取消。

![任务](docs/screenshots/jobs.png)

**暗色模式**——Element Plus 暗色变量，偏好持久化。

![暗色模式](docs/screenshots/dashboard-dark.png)

## 快速开始（Docker）

```bash
# 引擎同 docker 网络（服务名 mammoth）：
docker compose -f deploy/compose.yaml up -d --build

# 引擎在宿主机：
MAMMOTH_UPSTREAM=http://host.docker.internal:8080 docker compose -f deploy/compose.yaml up -d --build
```

打开 `http://<host>:8081`，连接页粘贴引擎的 `MAMMOTH_API_TOKEN`、地址留空（同源走内置 Caddy 反代，SSE 实时透传）。契约升级后先 `npm run gen:api` 重新生成类型再构建。

## 本地开发

```bash
npm install
npm run gen:api   # 从 ../mammoth/api/openapi.yaml 重新生成类型
npm run dev       # http://localhost:5173，/api 反代到 127.0.0.1:8080
npm run build     # vue-tsc 类型检查 + vite 构建
```

连接任意引擎：连接页填其 API Token、地址留空（同源走 vite 代理）。发行版 logo 素材见 [assets/logos/MANIFEST.md](./assets/logos/MANIFEST.md)。

## 端到端测试

```bash
npm run e2e       # 自动拉起隔离引擎（独立数据库、8081 端口）
                  # + vite 5174，跑 Playwright，退出即清理
```

覆盖连接/重水合、机器全生命周期（注册→详情→批量标签→命令面板→注销）、开箱向导、webhook 订阅流程。隔离引擎环境见 `e2e/engine.sh`——数据库凭据从 `E2E_PG_*` 环境变量读取，套件设计为跑在你自己的一次性 PostgreSQL 容器上。

## 设计文档

| 文档 | 内容 |
|---|---|
| [01-competitive-research](./docs/01-competitive-research.md) | 竞品调研：MAAS / Tinkerbell / Foreman / Ironic / Cobbler / Equinix Metal，行业惯例与差异化 |
| [02-engine-capabilities](./docs/02-engine-capabilities.md) | 引擎能力盘点：实体与状态机、API 端点全集、前端视角的翻译门槛 |
| [03-product-design](./docs/03-product-design.md) | 产品设计：定位、架构（SPA+伴生反代）、信息架构、关键流程、里程碑 |
| [04-engine-api-enhancements](./docs/04-engine-api-enhancements.md) | console 驱动的引擎 API 增强（A1–A7，已全部在引擎落地） |

## 技术栈

Vue 3 + TypeScript + Element Plus + TanStack Query · openapi-fetch（契约生成类型）· 原生 SSE 封装 · Vite + vue-tsc · Playwright · 生产容器用 Caddy。

## 许可与商标

Apache-2.0，见 [LICENSE](./LICENSE)。Linux 发行版名称与 logo（Rocky、CentOS、银河麒麟、UOS、Ubuntu、Debian、Alpine）与 Windows 均为其各自所有者的商标，仅作"指示支持该发行版"的展示使用；mammoth-console 与这些项目不存在隶属或背书关系。Windows 是 Microsoft 的商标。另见 [NOTICE](./NOTICE)。
