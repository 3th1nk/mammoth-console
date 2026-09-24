import { defineConfig } from '@playwright/test'

/**
 * console E2E:连接独立引擎实例(e2e/engine.sh,8081/独立库)与独立 vite
 * (5174,代理目标由 VITE_API_TARGET 指向 8081),不占用日常 dev(5173/8080)。
 * 全新库 → 开箱向导/注册/装机链路都从零状态走。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1, // 共享一台引擎,串行跑避免相互干扰
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    locale: 'zh-CN',
  },
  webServer: [
    {
      command: 'bash e2e/engine.sh',
      url: 'http://127.0.0.1:8081/healthz',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { VITE_API_TARGET: 'http://127.0.0.1:8081' },
    },
  ],
})
