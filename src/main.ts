import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { router } from './router'
import { ConsoleApiError } from './api/problem'
import i18n from './i18n'
import './styles/index.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)
app.use(VueQueryPlugin, {
  queryClientConfig: {
    defaultOptions: {
      queries: {
        // 4xx 是确定性失败（401 未授权 / 404 不存在 / 422 校验拒绝），重试
        // 只会白等并拉长 loading；超时、网络错误、5xx 才值得再试一次。
        retry: (failureCount, error) => {
          if (error instanceof ConsoleApiError && error.status >= 400 && error.status < 500) return false
          return failureCount < 1
        },
        refetchOnWindowFocus: false,
        staleTime: 5_000,
      },
    },
  },
})
app.mount('#app')
