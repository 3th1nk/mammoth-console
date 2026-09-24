import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import { router } from './router'
import './styles.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(VueQueryPlugin, {
  queryClientConfig: {
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
    },
  },
})
app.use(ElementPlus)
app.mount('#app')
