<script lang="ts">
/** 阶段步骤视图:install 流六段 / power、discover 单段流通用。 */
export interface StepView {
  name: string
  status: 'wait' | 'process' | 'finish' | 'error' | 'skip'
  description?: string
}
</script>

<script setup lang="ts">
import { Check, SkipForward, X } from 'lucide-vue-next'
import { TONE_COLOR } from '@/utils/stateColors'

/**
 * 阶段步骤条（el-steps 的替代）。状态语义与 stateColors 对齐：
 * finish=success、process=running、error=danger、wait=未执行、
 * skip=no-op 直通（引擎 stage.noop 标记，如实执行但无事可做）。
 */
defineProps<{ steps: StepView[] }>()

function dotClass(status: StepView['status']): string {
  switch (status) {
    case 'finish':
      return 'bg-[var(--st-success)] text-white'
    case 'process':
      return 'bg-[var(--st-running)] text-white ring-4 ring-[var(--st-running)]/15'
    case 'error':
      return 'bg-[var(--st-danger)] text-white'
    case 'skip':
      return 'border border-dashed border-border bg-muted text-muted-foreground'
    default:
      return 'border border-border bg-muted text-muted-foreground'
  }
}

function lineClass(status: StepView['status']): string {
  // 连接线颜色跟随左端节点：执行过即 success 色，未执行/跳过保持 border 色
  return status === 'wait' || status === 'skip' ? 'bg-border' : 'bg-[var(--st-success)]'
}

function nameClass(status: StepView['status']): string {
  return status === 'process' ? 'text-foreground' : status === 'wait' || status === 'skip' ? 'text-muted-foreground' : 'text-foreground/90'
}

// 状态色注入为 CSS 变量（动态 class 引用）
const cssVars = {
  '--st-success': TONE_COLOR.success,
  '--st-running': TONE_COLOR.running,
  '--st-danger': TONE_COLOR.danger,
} as Record<string, string>
</script>

<template>
  <ol class="flex w-full items-start" :style="cssVars">
    <li
      v-for="(s, i) in steps"
      :key="s.name"
      class="relative flex min-w-0 flex-1 flex-col items-center gap-1.5"
    >
      <div
        v-if="i > 0"
        class="absolute right-1/2 top-3 h-0.5 w-full"
        :class="lineClass(steps[i - 1]!.status)"
      />
      <div
        class="relative z-10 grid size-7 place-items-center rounded-full text-xs font-medium"
        :class="dotClass(s.status)"
      >
        <Check v-if="s.status === 'finish'" class="size-4" />
        <X v-else-if="s.status === 'error'" class="size-4" />
        <SkipForward v-else-if="s.status === 'skip'" class="size-3.5" />
        <template v-else>{{ i + 1 }}</template>
      </div>
      <div class="max-w-full text-center">
        <div
          class="truncate text-xs font-medium"
          :class="nameClass(s.status)"
          :title="s.name"
        >
          {{ s.name }}
        </div>
        <div v-if="s.description" class="text-[11px] text-muted-foreground">{{ s.description }}</div>
      </div>
    </li>
  </ol>
</template>
