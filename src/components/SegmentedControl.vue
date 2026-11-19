<script setup lang="ts">
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/**
 * 分段选择控件(模式切换用,shadcn 无 radio-button group 的对等物:
 * ToggleGroup 单选 + TabsList 观感)。适用于互斥"模式/视图"切换;
 * 各选项带说明文字的表单单选请继续用 RadioGroup 纵排。
 */
withDefaults(
  defineProps<{
    modelValue: string
    options: { value: string; label: string; title?: string }[]
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <ToggleGroup
    type="single"
    :model-value="modelValue"
    :disabled="disabled"
    class="bg-muted rounded-lg p-1"
    @update:model-value="(v: unknown) => { if (v != null) emit('update:modelValue', String(v)) }"
  >
    <ToggleGroupItem
      v-for="o in options"
      :key="o.value"
      :value="o.value"
      :title="o.title"
      class="h-7 rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
    >
      {{ o.label }}
    </ToggleGroupItem>
  </ToggleGroup>
</template>
