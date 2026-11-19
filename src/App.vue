<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner'

// Toaster 挂在根级:welcome(连接页)不在 ConsoleLayout 内,错误提示
// (token 失败等)也必须可见
</script>

<template>
  <Toaster position="bottom-right" rich-colors close-button />
  <router-view />
</template>
