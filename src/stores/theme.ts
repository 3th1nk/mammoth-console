import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

const KEY = 'mammoth.console.theme'

/**
 * 暗色主题：html.dark class 切换（Element Plus 暗色变量的官方开关形态）。
 * 首访跟随系统 prefers-color-scheme,选择持久化 localStorage。
 */
export const useThemeStore = defineStore('theme', () => {
  const saved = localStorage.getItem(KEY)
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const dark = ref(saved ? saved === 'dark' : prefersDark)

  watch(
    dark,
    (v) => {
      document.documentElement.classList.toggle('dark', v)
      localStorage.setItem(KEY, v ? 'dark' : 'light')
    },
    { immediate: true },
  )

  function toggle() {
    dark.value = !dark.value
  }
  return { dark, toggle }
})
