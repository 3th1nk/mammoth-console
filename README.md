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

## 下一步

- ~~评审 [03-product-design §11 开放决策](./docs/03-product-design.md)~~（已随开发推进关闭）。
- **M2 核心闭环**：注册/认领、电源与介质动作、装机向导（含 install-plan 试算）、任务观测（SSE+日志）、root 密码捕获、Onboarding 向导。

## 本地开发

```bash
npm install
npm run gen:api   # 从 ../mammoth/api/openapi.yaml 重新生成类型
npm run dev       # http://localhost:5173，/api 反代到 127.0.0.1:8080
npm run build     # vue-tsc 类型检查 + vite 构建
```

联调：本机起引擎（`go run ./cmd/mammoth serve --mode=all`，配 `MAMMOTH_API_TOKEN`）后，在控制台连接页 Token 填该值、地址留空（同源走 vite 代理）。发行版 logo 素材见 [assets/logos/MANIFEST.md](./assets/logos/MANIFEST.md)。
