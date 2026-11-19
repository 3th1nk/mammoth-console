<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronsUpDown } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * 可搜索、可手动输入的下拉(替代 EP 的 el-select filterable allow-create)。
 * 刻意不用 shadcn Command(Listbox 注册/过滤在这个场景会高频重渲染甚至
 * 卡死主线程,见装机向导网卡行):选项通常 ≤10 个,直接过滤普通列表。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    options: { value: string; detail?: string }[]
    placeholder?: string
    disabled?: boolean
    inputClass?: string
  }>(),
  { placeholder: '选择或输入…', disabled: false, inputClass: '' },
)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const query = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter((o) => o.value.toLowerCase().includes(q))
})

function set(v: string) {
  emit('update:modelValue', v)
  open.value = false
  query.value = ''
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        role="combobox"
        :disabled="disabled"
        class="justify-between font-normal"
        :class="inputClass"
      >
        <span
          class="truncate font-mono text-xs"
          :class="modelValue ? '' : 'text-muted-foreground font-sans text-sm'"
        >
          {{ modelValue || placeholder }}
        </span>
        <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-[320px] p-1" align="start">
      <input
        v-model="query"
        :placeholder="placeholder"
        class="h-9 w-full border-b bg-transparent px-3 pb-2 text-sm outline-hidden placeholder:text-muted-foreground"
        @keydown.enter.prevent="set(query.trim() || modelValue)"
      />
      <div class="max-h-[260px] overflow-auto py-1">
        <button
          v-if="filtered.length === 0 && query.trim()"
          class="w-full px-3 py-2 text-left text-sm text-primary"
          @click="set(query.trim())"
        >
          使用「{{ query.trim() }}」
        </button>
        <button
          v-for="o in filtered"
          :key="o.value"
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent"
          @click="set(o.value)"
        >
          <Check class="size-4" :class="modelValue === o.value ? 'opacity-100' : 'opacity-0'" />
          <span class="font-mono text-xs">{{ o.value }}</span>
          <span v-if="o.detail" class="ml-auto text-xs text-muted-foreground">{{ o.detail }}</span>
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
