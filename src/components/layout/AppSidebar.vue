<script setup lang="ts">
import type { Component } from 'vue'
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
} from '@/components/ui/sidebar'
import { Badge } from '@/components/ui/badge'
import { useConnectionStore } from '@/stores/connection'
import { formatVersion } from '@/utils/format'

/** 应用侧栏(inset 形态,⌘B 折叠为图标栏)。E2E 依赖 .engine-version 类名。 */
const props = defineProps<{ pendingCount: number }>()
const conn = useConnectionStore()
const route = useRoute()
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
      <div class="flex items-center gap-2.5 px-2 py-1.5">
        <img src="/mammoth.svg" alt="mammoth" class="size-7 shrink-0" />
        <div class="min-w-0">
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
          {{ t('nav.engine', { version: formatVersion(conn.capabilities.version) }) }}
        </Badge>
        <Badge v-else variant="outline" class="border-destructive/40 bg-destructive/10 text-destructive">
          {{ t('nav.engineDown') }}
        </Badge>
      </div>
    </SidebarFooter>
  </Sidebar>
</template>
