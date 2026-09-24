import { createRouter, createWebHistory } from 'vue-router'
import { useConnectionStore } from '@/stores/connection'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/welcome',
      name: 'welcome',
      component: () => import('@/views/WelcomeView.vue'),
      meta: { bare: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/ConsoleLayout.vue'),
      children: [
        { path: '', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
        { path: 'machines', name: 'machines', component: () => import('@/views/MachinesView.vue') },
        { path: 'machines/:id', name: 'machine-detail', component: () => import('@/views/MachineDetailView.vue'), props: true },
        { path: 'pending', name: 'pending', component: () => import('@/views/PendingView.vue') },
        { path: 'images', name: 'images', component: () => import('@/views/ImagesView.vue') },
        { path: 'credentials', name: 'credentials', component: () => import('@/views/CredentialsView.vue') },
        { path: 'install', name: 'install-wizard', component: () => import('@/views/InstallWizardView.vue') },
        { path: 'jobs', name: 'jobs', component: () => import('@/views/JobsView.vue') },
        { path: 'jobs/:id', name: 'job-detail', component: () => import('@/views/JobDetailView.vue'), props: true },
        {
          path: 'jobs/:jobId/tasks/:taskId',
          name: 'task-detail',
          component: () => import('@/views/TaskDetailView.vue'),
          props: true,
        },
        { path: 'settings', name: 'settings', component: () => import('@/views/SettingsConnectionView.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// 未连接引擎一律先走连接向导；已连接则不再进向导。
// 有存量连接时先等一次静默重水合（探活 + 恢复 capabilities），避免刷新被踢回欢迎页。
router.beforeEach(async (to) => {
  const conn = useConnectionStore()
  if (to.name === 'welcome') {
    if (conn.connected) return { name: 'dashboard' }
    await conn.rehydrate()
    return conn.connected ? { name: 'dashboard' } : true
  }
  if (!conn.connected) {
    if (!conn.rehydratedFlag) await conn.rehydrate()
    if (!conn.connected) return { name: 'welcome' }
  }
  return true
})
