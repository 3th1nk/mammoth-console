import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 开发期把 /api 反代到本机引擎（mammoth serve，默认 8080）；SSE 同路径透传。
// 生产同源由 Caddy/反代承担（见 docs/03-product-design.md §3.1）。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // E2E 用独立引擎实例（VITE_API_TARGET=http://127.0.0.1:8081）,
        // 日常开发走默认 8080。
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
