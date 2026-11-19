<script setup lang="ts">
import { ref } from 'vue'
import { Check, ChevronsUpDown } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

/**
 * 可搜索、可手动输入的下拉(替代 EP 的 el-select filterable allow-create):
 * Popover + Command 本地过滤,无匹配时用输入值直接创建。
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
const search = ref('')

function set(v: string) {
  emit('update:modelValue', v)
  open.value = false
  search.value = ''
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
        <span class="truncate font-mono text-xs" :class="modelValue ? '' : 'text-muted-foreground font-sans text-sm'">
          {{ modelValue || placeholder }}
        </span>
        <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-[320px] p-0" align="start">
      <Command>
        <CommandInput v-model="search" :placeholder="placeholder" />
        <CommandList class="max-h-[260px]">
          <CommandEmpty>
            <button
              v-if="search.trim()"
              class="w-full px-3 py-2 text-sm text-primary"
              @click="set(search.trim())"
            >
              使用「{{ search.trim() }}」
            </button>
          </CommandEmpty>
          <CommandGroup>
            <CommandItem
              v-for="o in props.options"
              :key="o.value"
              :value="o.value"
              @select="set(o.value)"
            >
              <Check class="size-4" :class="modelValue === o.value ? 'opacity-100' : 'opacity-0'" />
              <span class="font-mono text-xs">{{ o.value }}</span>
              <span v-if="o.detail" class="ml-auto text-xs text-muted-foreground">{{ o.detail }}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
