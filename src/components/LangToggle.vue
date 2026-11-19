<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { LOCALES, setLocale, type Locale } from '@/i18n'

// 语言切换:显示另一种语言的代号(中文界面显示 EN,英文界面显示 中),
// 点击循环切换;locale/持久化/html lang 由 i18n/index.ts setLocale 处理。
const { locale } = useI18n()

const next = computed<Locale>(() => (locale.value === 'zh-CN' ? 'en' : 'zh-CN'))
const label = computed(() => LOCALES.find((l) => l.value === next.value)?.label ?? 'EN')
</script>

<template>
  <Button
    variant="ghost"
    size="sm"
    class="h-8 rounded-full px-2 font-medium"
    :title="label"
    @click="setLocale(next)"
  >
    {{ label }}
  </Button>
</template>
