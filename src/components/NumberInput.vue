<script setup lang="ts">

/**
 * 数字输入（el-input-number 的替代）：min/max 夹逼。
 * 直接渲染原生 input——shadcn <Input> 内部 defineModel 的空串默认值会
 * 覆盖只传 :value 的初始数字（并发数/超时显示为空的根因）。
 */
const props = withDefaults(
  defineProps<{ modelValue: number; min?: number; max?: number; step?: number; id?: string }>(),
  { min: undefined, max: undefined, step: 1, id: undefined },
)
const emit = defineEmits<{ 'update:modelValue': [number] }>()

function onInput(e: Event) {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isNaN(n)) {
    emit('update:modelValue', Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, n)))
  }
}
</script>

<template>
  <input
    :id="props.id"
    type="number"
    :value="String(props.modelValue)"
    :min="props.min"
    :max="props.max"
    :step="props.step"
    class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:border-input"
    @input="onInput"
  />
</template>
