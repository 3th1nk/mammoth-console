<script setup lang="ts">
import { ref } from 'vue'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { registerConfirmHost, type ConfirmOptions } from '@/composables/confirm'
import { cn } from '@/lib/utils'

// 全局确认弹窗宿主:命令式 confirm() 的唯一挂载点(ConsoleLayout)。
// 动作/取消用普通 Button 显式 settle——不用 reka 的 AlertDialogAction:
// 它的自动 dismiss(update:open=false)会先于业务 @click 落地,把 Promise
// 以 false 结掉(注销/删除确认从未真正执行的根因)。answered 守卫保证
// 只 settle 一次;ESC/点遮罩经 update:open 兜底为 false。
const open = ref(false)
const opts = ref<ConfirmOptions | null>(null)
let resolve: ((v: boolean) => void) | null = null
let answered = false

registerConfirmHost((o) => {
  opts.value = o
  answered = false
  open.value = true
  return new Promise((r) => {
    resolve = r
  })
})

function settle(v: boolean) {
  if (answered || !open.value) return
  answered = true
  open.value = false
  resolve?.(v)
  resolve = null
}

function onOpenChange(v: boolean) {
  if (!v) settle(false)
}
</script>

<template>
  <AlertDialog :open="open" @update:open="onOpenChange">
    <AlertDialogContent>
      <!-- anywhere 而非 break-word:同时修正 grid 子项 min-content 尺寸,
           SHA/URL 等无空格长串才会在容器内换行而非撑破对话框 -->
      <AlertDialogHeader class="min-w-0">
        <AlertDialogTitle class="[overflow-wrap:anywhere]">{{ opts?.title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="opts?.description" class="[overflow-wrap:anywhere]">
          {{ opts.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <Button variant="outline" @click="settle(false)">
          {{ opts?.cancelText ?? '取消' }}
        </Button>
        <Button
          :class="cn(opts?.destructive && 'bg-destructive text-white hover:bg-destructive/90')"
          @click="settle(true)"
        >
          {{ opts?.confirmText ?? '确认' }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
