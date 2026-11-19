<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'

const { t } = useI18n()

/**
 * 游标分页统一组件(替代三处手写 .pager):只有「下一页」(next_cursor),
 * 用页面侧的 cursorStack 记住来路实现「上一页」。
 */
withDefaults(
  defineProps<{ hasPrev?: boolean; hasNext?: boolean; hint?: string }>(),
  { hasPrev: false, hasNext: false, hint: '' },
)
defineEmits<{ prev: []; next: [] }>()
</script>

<template>
  <div class="flex items-center justify-between pt-3">
    <span class="text-[13px] text-muted-foreground">{{ hint || t('common.pagerHint') }}</span>
    <div class="flex gap-2">
      <Button variant="outline" size="sm" :disabled="!hasPrev" @click="$emit('prev')">
        {{ t('common.prevPage') }}
      </Button>
      <Button variant="outline" size="sm" :disabled="!hasNext" @click="$emit('next')">
        {{ t('common.nextPage') }}
      </Button>
    </div>
  </div>
</template>
