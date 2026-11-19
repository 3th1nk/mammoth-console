<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useThemeStore } from '@/stores/theme'

// 亮暗切换(Sun/Moon 交叉旋转,与 shadcn-admin 同款微动效)。
// 仅 icon 按钮:hover 提示交给原生 title,避免 tooltip 组件依赖。
const theme = useThemeStore()
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    class="rounded-full"
    :title="theme.dark ? '切到亮色' : '切到暗色'"
    @click="theme.toggle()"
  >
    <Sun class="size-[1.1rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
    <Moon class="absolute size-[1.1rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    <span class="sr-only">切换主题</span>
  </Button>
</template>
