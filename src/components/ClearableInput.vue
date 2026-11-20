<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'

/**
 * 列表过滤用的单行输入框：有内容时右侧出现清除按钮，
 * 点击清空输入并 emit clear，调用方借此重新触发过滤。
 * 非 props 属性(placeholder、class、事件监听)透传到内部 Input。
 */
defineOptions({ inheritAttrs: false })

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string]; clear: [] }>()
const { t } = useI18n()

const inputEl = ref<{ $el: HTMLInputElement } | null>(null)
const value = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

function onClear() {
  emit('update:modelValue', '')
  emit('clear')
  inputEl.value?.$el?.focus()
}
</script>

<template>
  <div class="relative inline-flex">
    <Input ref="inputEl" v-model="value" v-bind="$attrs" :class="props.modelValue ? 'pr-8' : undefined" />
    <button
      v-if="props.modelValue"
      type="button"
      :aria-label="t('common.clear')"
      class="absolute inset-y-0 right-2 my-auto grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      @click="onClear"
    >
      <X class="size-3.5" />
    </button>
  </div>
</template>
