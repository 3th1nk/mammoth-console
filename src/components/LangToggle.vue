<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { LOCALES, setLocale, type Locale } from '@/i18n'

// 语言切换:与主题按钮同尺寸的圆形 icon 按钮,内容为切换目标的代号
// (中文界面显示 EN,英文界面显示 中);locale/持久化/html lang 由
// i18n/index.ts setLocale 处理。
const { locale } = useI18n()

const next = computed<Locale>(() => (locale.value === 'zh-CN' ? 'en' : 'zh-CN'))
const label = computed(() =>
  next.value === 'en' ? 'EN' : LOCALES.find((l) => l.value === next.value)?.label.slice(0, 1) ?? '中',
)
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    class="rounded-full text-xs font-semibold"
    :title="label === 'EN' ? 'Switch to English' : '切换到中文'"
    @click="setLocale(next)"
  >
    {{ label }}
    <span class="sr-only">切换语言</span>
  </Button>
</template>
