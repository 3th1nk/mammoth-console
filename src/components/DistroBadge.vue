<script setup lang="ts">
import { computed } from 'vue'
import { resolveDistroKey } from '@/utils/distro'

/**
 * 发行版徽标：素材键由 utils/distro 的归一规则解析
 * （assets/logos/MANIFEST.md），彩色官方 mark 直出，定高自适应宽。
 */
const props = withDefaults(
  defineProps<{
    name?: string
    family?: string
    /** 显式指定素材键（族分组场景），跳过 name 归一 */
    badgeKey?: string
  }>(),
  { name: '', family: '', badgeKey: '' },
)

const files = import.meta.glob<string>('../../assets/logos/*.{svg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
})

const assetUrl = (key: string): string | undefined =>
  files[`../../assets/logos/${key}.svg`] ?? files[`../../assets/logos/${key}.png`]

const key = computed(() =>
  props.badgeKey || resolveDistroKey(props.name, props.family),
)

const url = computed(() => assetUrl(key.value) ?? assetUrl('generic'))
const label = computed(() => props.name || key.value)
const alt = computed(() => `${label.value}（${key.value}）`)
</script>

<template>
  <img
    v-if="url"
    :src="url"
    :alt="alt"
    :title="alt"
    class="distro-badge"
  />
  <span v-else class="distro-badge-text" :title="alt">{{ label }}</span>
</template>

<style scoped>
.distro-badge {
  display: inline-block;
  height: 26px;
  width: auto;
  max-width: 96px;
  object-fit: contain;
  vertical-align: middle;
}
.distro-badge-text {
  font-size: 12px;
  color: #8a94a0;
}
</style>
