<script setup lang="ts">
import { ref } from 'vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { registerConfirmHost, type ConfirmOptions } from '@/composables/confirm'
import { cn } from '@/lib/utils'

// 全局确认弹窗宿主：命令式 confirm() 的唯一挂载点（ConsoleLayout）。
const open = ref(false)
const opts = ref<ConfirmOptions | null>(null)
let resolve: ((v: boolean) => void) | null = null

registerConfirmHost((o) => {
  opts.value = o
  open.value = true
  return new Promise((r) => {
    resolve = r
  })
})

function settle(v: boolean) {
  if (!open.value) return
  open.value = false
  resolve?.(v)
  resolve = null
}
</script>

<template>
  <AlertDialog :open="open" @update:open="(v: boolean) => { if (!v) settle(false) }">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ opts?.title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="opts?.description">
          {{ opts.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="settle(false)">
          {{ opts?.cancelText ?? '取消' }}
        </AlertDialogCancel>
        <AlertDialogAction
          :class="cn(opts?.destructive && 'bg-destructive text-white hover:bg-destructive/90')"
          @click="settle(true)"
        >
          {{ opts?.confirmText ?? '确认' }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
