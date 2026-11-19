<script setup lang="ts">
import { Input } from '@/components/ui/input'

/** 数字输入（el-input-number 的替代）：min/max 夹逼。 */
const props = withDefaults(
  defineProps<{ modelValue: number; min?: number; max?: number; step?: number }>(),
  { min: undefined, max: undefined, step: 1 },
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
  <Input
    type="number"
    :value="String(props.modelValue)"
    :min="props.min"
    :max="props.max"
    :step="props.step"
    @input="onInput"
  />
</template>
