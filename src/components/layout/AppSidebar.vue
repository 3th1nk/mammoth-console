<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Bell, Cpu, FileText, KeyRound, LayoutDashboard, List, Package, Server, Settings } from 'lucide-vue-next'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useConnectionStore } from '@/stores/connection'
import { formatVersion } from '@/utils/format'

/** 应用侧栏(inset 形态,⌘B 折叠为图标栏)。E2E 依赖 .engine-version 类名。 */
const props = defineProps<{ pendingCount: number }>()
const conn = useConnectionStore()
const route = useRoute()
const { state: sidebarState } = useSidebar()
// 收缩(图标栏)态:品牌文字隐藏、引擎徽章收敛为状态圆点
const isIconCollapsed = computed(() => sidebarState.value === 'collapsed')
const { t } = useI18n()

interface NavItem {
  name: string
  titleKey: string
  icon: Component
}

const GROUPS: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: 'nav.platform',
    items: [
      { name: 'dashboard', titleKey: 'nav.dashboard', icon: LayoutDashboard },
      { name: 'machines', titleKey: 'nav.machines', icon: Server },
      { name: 'pending', titleKey: 'nav.pending', icon: Bell },
      { name: 'jobs', titleKey: 'nav.jobs', icon: List },
      { name: 'events', titleKey: 'nav.events', icon: FileText },
    ],
  },
  {
    labelKey: 'nav.resources',
    items: [
      { name: 'images', titleKey: 'nav.images', icon: Package },
      { name: 'credentials', titleKey: 'nav.credentials', icon: KeyRound },
      { name: 'bios-profiles', titleKey: 'nav.biosProfiles', icon: Cpu },
    ],
  },
  {
    labelKey: 'nav.system',
    items: [{ name: 'settings', titleKey: 'nav.settings', icon: Settings }],
  },
]
</script>

<template>
  <Sidebar collapsible="icon" variant="inset">
    <SidebarHeader>
      <!-- 收缩为图标栏时只留 logo,文字隐藏 -->
      <div class="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <img src="/mammoth.svg" alt="mammoth" class="size-7 shrink-0" />
        <div class="min-w-0 group-data-[collapsible=icon]:hidden">
          <div class="truncate text-sm font-semibold leading-tight">Mammoth Console</div>
          <div class="truncate text-xs text-muted-foreground">{{ t('nav.brandSub') }}</div>
        </div>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup v-for="g in GROUPS" :key="g.labelKey">
        <SidebarGroupLabel>{{ t(g.labelKey) }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in g.items" :key="item.name">
              <SidebarMenuButton as-child :is-active="route.name === item.name" :tooltip="t(item.titleKey)">
                <RouterLink :to="{ name: item.name }">
                  <component :is="item.icon" />
                  <span>{{ t(item.titleKey) }}</span>
                </RouterLink>
              </SidebarMenuButton>
              <!-- 实底徽章文字色必须自持:基类 peer-data-[active]/peer-hover 会把
                   文字强制成 sidebar-accent-foreground(=accent-foreground,与
                   bg-primary 同为深色),选中/悬停行时数字隐形——! 压过 peer 规则 -->
              <SidebarMenuBadge
                v-if="item.name === 'pending' && props.pendingCount > 0"
                class="rounded-full bg-primary px-1.5 font-medium text-primary-foreground!"
              >
                {{ props.pendingCount > 99 ? '99+' : props.pendingCount }}
              </SidebarMenuBadge>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <!-- 收缩为图标栏时收敛为状态圆点(悬停显示版本),展开显示完整徽章 -->
      <div class="engine-version flex px-2 pb-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <TooltipProvider :delay-duration="200">
          <Tooltip>
            <TooltipTrigger as-child>
              <Badge
                v-if="isIconCollapsed"
                variant="outline"
                class="size-5 justify-center rounded-full p-0"
                :class="conn.capabilities
                  ? 'border-transparent bg-emerald-500/15'
                  : 'border-destructive/40 bg-destructive/10'"
              >
                <i
                  class="inline-block size-2 rounded-full"
                  :class="conn.capabilities ? 'bg-emerald-500' : 'bg-destructive'"
                />
              </Badge>
              <Badge
                v-else-if="conn.capabilities"
                variant="outline"
                class="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                {{ t('nav.engine', { version: formatVersion(conn.capabilities.version) }) }}
              </Badge>
              <Badge v-else variant="outline" class="border-destructive/40 bg-destructive/10 text-destructive">
                {{ t('nav.engineDown') }}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="right">
              {{ conn.capabilities
                ? t('nav.engine', { version: formatVersion(conn.capabilities.version) })
                : t('nav.engineDown') }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </SidebarFooter>
  </Sidebar>
</template>
