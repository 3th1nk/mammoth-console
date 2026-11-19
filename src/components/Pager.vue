<script setup lang="ts">
import { Button } from '@/components/ui/button'

/**
 * 游标分页统一组件(替代三处手写 .pager):只有「下一页」(next_cursor),
 * 用页面侧的 cursorStack 记住来路实现「上一页」。
 */
withDefaults(
  defineProps<{ hasPrev?: boolean; hasNext?: boolean; hint?: string }>(),
  { hasPrev: false, hasNext: false, hint: '游标分页 · 仅支持前后翻页' },
)
defineEmits<{ prev: []; next: [] }>()
</script>

<template>
  <div class="flex items-center justify-between pt-3">
    <span class="text-[13px] text-muted-foreground">{{ hint }}</span>
    <div class="flex gap-2">
      <Button variant="outline" size="sm" :disabled="!hasPrev" @click="$emit('prev')">
        上一页
      </Button>
      <Button variant="outline" size="sm" :disabled="!hasNext" @click="$emit('next')">
        下一页
      </Button>
    </div>
  </div>
</template>
