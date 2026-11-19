<script setup lang="ts">
import type { Component } from 'vue'
import { useRoute } from 'vue-router'
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
} from '@/components/ui/sidebar'
import { Badge } from '@/components/ui/badge'
import { useConnectionStore } from '@/stores/connection'
import { formatVersion } from '@/utils/format'

/** 应用侧栏(inset 形态,⌘B 折叠为图标栏)。E2E 依赖 .engine-version 类名。 */
const props = defineProps<{ pendingCount: number }>()
const conn = useConnectionStore()
const route = useRoute()

interface NavItem {
  name: string
  title: string
  icon: Component
}

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: '平台',
    items: [
      { name: 'dashboard', title: '总览', icon: LayoutDashboard },
      { name: 'machines', title: '机器', icon: Server },
      { name: 'pending', title: '待认领', icon: Bell },
      { name: 'jobs', title: '任务', icon: List },
      { name: 'events', title: '事件', icon: FileText },
    ],
  },
  {
    label: '资源',
    items: [
      { name: 'images', title: '镜像库', icon: Package },
      { name: 'credentials', title: '凭证', icon: KeyRound },
      { name: 'bios-profiles', title: 'BIOS 基线', icon: Cpu },
    ],
  },
  {
    label: '系统',
    items: [{ name: 'settings', title: '设置', icon: Settings }],
  },
]
</script>

<template>
  <Sidebar collapsible="icon" variant="inset">
    <SidebarHeader>
      <div class="flex items-center gap-2.5 px-2 py-1.5">
        <img src="/mammoth.svg" alt="mammoth" class="size-7 shrink-0" />
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold leading-tight">Mammoth Console</div>
          <div class="truncate text-xs text-muted-foreground">裸金属装机控制台</div>
        </div>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup v-for="g in GROUPS" :key="g.label">
        <SidebarGroupLabel>{{ g.label }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in g.items" :key="item.name">
              <SidebarMenuButton as-child :is-active="route.name === item.name" :tooltip="item.title">
                <RouterLink :to="{ name: item.name }">
                  <component :is="item.icon" />
                  <span>{{ item.title }}</span>
                </RouterLink>
              </SidebarMenuButton>
              <SidebarMenuBadge
                v-if="item.name === 'pending' && props.pendingCount > 0"
                class="rounded-full bg-primary px-1.5 font-medium text-primary-foreground"
              >
                {{ props.pendingCount > 99 ? '99+' : props.pendingCount }}
              </SidebarMenuBadge>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <div class="engine-version px-2 pb-1">
        <Badge
          v-if="conn.capabilities"
          variant="outline"
          class="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        >
          引擎 {{ formatVersion(conn.capabilities.version) }}
        </Badge>
        <Badge v-else variant="outline" class="border-destructive/40 bg-destructive/10 text-destructive">
          未连接
        </Badge>
      </div>
    </SidebarFooter>
  </Sidebar>
</template>
