# Mammoth Console

> [mammoth](https://github.com/3th1nk/mammoth) 裸金属装机引擎的官方 Web 控制台——开箱即用的整套前端方案。引擎保持 backend-only / API-first，本项目是其官方集成前端。

**状态：M1 已落地（骨架可看）**。Vue 3 + TypeScript + Element Plus + TanStack Query；API 类型由引擎契约生成（`npm run gen:api`）。设计文档在 [docs/](./docs/)：

| 文档 | 内容 |
|---|---|
| [01-competitive-research](./docs/01-competitive-research.md) | 竞品调研：MAAS / Tinkerbell / Foreman / Ironic / Cobbler / Equinix Metal / RackN / 云厂商控制台，行业惯例与差异化机会 |
| [02-engine-capabilities](./docs/02-engine-capabilities.md) | 引擎能力盘点：实体与状态机、API 端点全集、关键工作流、前端视角的现成/缺失/翻译门槛 |
| [03-product-design](./docs/03-product-design.md) | 产品设计：定位、架构决策（SPA+伴生反代）、技术栈建议、信息架构、状态系统、关键流程（Onboarding/装机向导/任务观测）、里程碑与开放决策 |

## 设计原则（摘要）

1. 引擎是唯一事实源：UI 无私有后端，能力边界全部由 `GET /api/v1` capabilities 驱动。
2. 状态驱动操作：机器/任务状态决定可用动作，不可用灰置并说明原因。
3. 异步无处不在：一切动作 202+Job，反馈即"已受理 + 任务链接"。
4. 渲染即预览：装机意图提交前经 `install-plan` 试算，所见即所装。
5. API-first 可视化：UI 全走公开 API，每个操作面板提供 Copy as cURL。

## 部署交付（deploy/）

```bash
docker compose -f deploy/compose.yaml up -d --build   # 引擎同网络（服务名 mammoth）
# 或引擎在宿主机：
MAMMOTH_UPSTREAM=http://host.docker.internal:8080 docker compose -f deploy/compose.yaml up -d --build
```

打开 `http://<host>:8081`，连接页填引擎 token、地址留空。镜像为多阶段构建
（node 构建 → Caddy 托管 + `/api` 反代，SSE `flush_interval -1` 实时透传）；
契约升级后先 `npm run gen:api` 重新生成类型并提交再构建。

## 下一步

- ~~评审 [03-product-design §11 开放决策](./docs/03-product-design.md)~~（已随开发推进关闭）。
- ~~M2 核心闭环~~ ✅；~~M2b 装机向导+镜像库~~ ✅；~~M2c 健康面~~ ✅；~~M3 快赢项~~ ✅。
- 剩余：Onboarding ✅（总览开箱向导）；M3 尾巴 i18n(en)；M4 全局搜索/暗色/E2E。
- 引擎侧 P1（见 docs/04）：A5 批量标签、A6 只读配置快照、A7 镜像发行版自动识别。

## 商标声明

Linux 发行版名称与 logo（Rocky、CentOS、银河麒麟、UOS、Ubuntu、Debian、Alpine）与
Windows 均为其各自所有者的商标，仅作"指示支持该发行版"的展示使用；
mammoth-console 与这些项目不存在隶属或背书关系。Windows 是 Microsoft 的商标。

## 本地开发

```bash
npm install
npm run gen:api   # 从 ../mammoth/api/openapi.yaml 重新生成类型
npm run dev       # http://localhost:5173，/api 反代到 127.0.0.1:8080
npm run build     # vue-tsc 类型检查 + vite 构建
```

联调：本机起引擎（`go run ./cmd/mammoth serve --mode=all`，配 `MAMMOTH_API_TOKEN`）后，在控制台连接页 Token 填该值、地址留空（同源走 vite 代理）。发行版 logo 素材见 [assets/logos/MANIFEST.md](./assets/logos/MANIFEST.md)。
