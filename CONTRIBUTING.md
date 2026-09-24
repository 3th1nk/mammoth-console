# 贡献指引

欢迎 issue 与 PR。开工前请先读 [README](./README.zh-CN.md) 与 [docs/03-product-design](./docs/03-product-design.md)——console 的边界与"不做什么"都定义在那里。

## 约定

- **文档与交流用中文；代码、标识符、API 字段用英文。**
- **引擎是唯一事实源**：UI 不硬编码能力边界，一切以 `GET /api/v1` capabilities 为准；需要引擎新能力时先在 [docs/04](./docs/04-engine-api-enhancements.md) 提案，契约 additive 演进后再接 UI。
- API 类型由引擎契约生成（`npm run gen:api`），**不要手改 `src/api/types.gen.ts`**。
- Element Plus 组件保持既有用法；样式变量用 EP CSS 变量（暗色模式依赖变量化，勿写死颜色——语义色/图表色除外）。

## 提交与验证

```bash
npm run gen:api   # 契约变更后重新生成
npm run build     # vue-tsc 严格类型检查 + vite 构建,提交前必须全绿
npm run e2e       # Playwright 关键流程;改动交互链路时必须跑
```

提交信息用中文、一行说清动机与结果（参考 `git log` 既有风格）；一次提交做一件事。

## E2E 环境

`npm run e2e` 会自动拉起隔离引擎（独立数据库 + 8081 端口）与独立 vite（5174），不占用日常 dev 环境。数据库凭据从 `E2E_PG_*` 环境变量读取，需要你本地有一个一次性 PostgreSQL 容器（见 `e2e/engine.sh` 头部注释）。
