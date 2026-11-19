<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, Eye, EyeOff, LoaderCircle, RefreshCcw } from 'lucide-vue-next'
import { useQuery } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { useConnectionStore } from '@/stores/connection'
import { getClient } from '@/api/client'
import { errorMessage, unwrap } from '@/api/problem'
import { configKey } from '@/api/queryKeys'
import DistroBadge from '@/components/DistroBadge.vue'
import { resolveDistroKey, familyLabel, type DistroFamilyKey } from '@/utils/distro'
import { formatVersion } from '@/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import DescriptionList from '@/components/DescriptionList.vue'
import DescriptionItem from '@/components/DescriptionItem.vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** capabilities distros 按"族"聚合（引擎按 distro+版本注册，UI 按族呈现）。 */
const conn = useConnectionStore()
const router = useRouter()

const BOOT_LABEL: Record<string, string> = { virtual_media: '虚拟介质', pxe: 'PXE 网络引导' }
const CONFIRM_LABEL: Record<string, string> = { required: '必须确认', optional: '可选确认' }

const distroGroups = computed(() => {
  const map = new Map<DistroFamilyKey, { name: string; family?: string; pxe_support?: string }[]>()
  for (const d of conn.capabilities?.distros ?? []) {
    // user_facing=false 的通路驱动(bootc 冻结/alpine agent)不上支持矩阵卡,
    // 与装机向导同一口径;引擎 API 矩阵保持全量
    if (d.user_facing === false) continue
    const key = resolveDistroKey(d.name, d.family)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push({ name: d.name, family: d.family, pxe_support: d.pxe_support })
  }
  return [...map.entries()]
    .map(([key, items]) => ({
      key,
      label: familyLabel(key),
      items: [...items].sort((a, b) => (a.name < b.name ? -1 : 1)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
})

const editing = ref(false)
const baseUrl = ref('')
const token = ref('')
const showToken = ref(false)
const probing = ref(false)

const maskedToken = computed(() => {
  if (!conn.token) return '—'
  return conn.token.length <= 8 ? '****' : `${conn.token.slice(0, 4)}****${conn.token.slice(-4)}`
})

function startEdit() {
  baseUrl.value = conn.baseUrl
  token.value = ''
  editing.value = true
}

async function save() {
  probing.value = true
  try {
    const caps = await conn.connect(baseUrl.value.trim(), token.value.trim() || conn.token)
    toast.success(`已连接引擎 ${formatVersion(caps.version)}`)
    editing.value = false
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    probing.value = false
  }
}

function disconnect() {
  conn.disconnect()
  router.push({ name: 'welcome' })
}

// ── 当前生效配置（引擎 A6，只读脱敏快照） ───────────────────────────────────
// 配置是进程生命周期的：拉一次就够（staleTime Infinity），手动刷新兜底。
const cfgQuery = useQuery({
  queryKey: configKey,
  queryFn: async () => unwrap(await getClient().GET('/api/v1/config')),
  staleTime: Infinity,
  refetchOnWindowFocus: false,
})

type ConfigRow = { key: string; value: unknown; redacted: boolean }
const configRows = computed<ConfigRow[]>(() => {
  const cfg = cfgQuery.data.value
  if (!cfg) return []
  const redacted = new Set(cfg.redacted ?? [])
  return Object.entries(cfg.config ?? {})
    .map(([key, value]) => ({ key, value, redacted: redacted.has(key) }))
    .sort((a, b) => a.key.localeCompare(b.key))
})
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div>
      <h2 class="text-2xl font-bold tracking-tight">设置</h2>
      <p class="text-sm text-muted-foreground">引擎连接、能力事实源与生效配置</p>
    </div>

    <Card>
      <CardHeader><CardTitle class="text-base">连接</CardTitle></CardHeader>
      <CardContent>
        <template v-if="!editing">
          <DescriptionList :columns="2">
            <DescriptionItem label="引擎地址" mono>{{ conn.baseUrl || '同源（随控制台访问）' }}</DescriptionItem>
            <DescriptionItem label="API Token">
              <span class="font-mono text-xs">{{ maskedToken }}</span>
              <span class="text-xs text-muted-foreground">（仅本机 localStorage 保存）</span>
            </DescriptionItem>
            <DescriptionItem label="引擎版本" mono>{{ conn.capabilities?.version ?? '—' }}</DescriptionItem>
            <DescriptionItem label="连接状态">
              <Badge
                variant="outline"
                class="rounded-md font-medium"
                :style="conn.unauthorized
                  ? { color: '#ef4444', borderColor: '#ef444455', backgroundColor: '#ef44441a' }
                  : { color: '#10b981', borderColor: '#10b98155', backgroundColor: '#10b9811a' }"
              >
                {{ conn.unauthorized ? 'Token 已失效' : '正常' }}
              </Badge>
            </DescriptionItem>
          </DescriptionList>
          <div class="mt-4 flex gap-2">
            <Button variant="outline" size="sm" @click="startEdit">更换引擎 / Token</Button>
            <Button
              variant="outline"
              size="sm"
              class="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              @click="disconnect"
            >
              断开连接
            </Button>
          </div>
        </template>

        <form v-else class="grid max-w-md gap-4" @submit.prevent="save">
          <div class="grid gap-1.5">
            <Label for="cfg-url">引擎地址</Label>
            <Input id="cfg-url" v-model="baseUrl" class="font-mono" />
          </div>
          <div class="grid gap-1.5">
            <Label for="cfg-token">API Token（留空沿用当前）</Label>
            <div class="relative">
              <Input id="cfg-token" v-model="token" :type="showToken ? 'text' : 'password'" class="pr-10" />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                @click="showToken = !showToken"
              >
                <Eye v-if="!showToken" class="size-4" />
                <EyeOff v-else class="size-4" />
              </button>
            </div>
          </div>
          <div class="flex gap-2">
            <Button type="submit" size="sm" :disabled="probing">
              <LoaderCircle v-if="probing" class="size-4 animate-spin" /> 保存并探测
            </Button>
            <Button type="button" variant="outline" size="sm" @click="editing = false">取消</Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle class="text-base">引擎能力（GET /api/v1，只读事实源）</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-4">
        <DescriptionList :columns="3">
          <DescriptionItem label="缺省引导方式">{{ BOOT_LABEL[conn.capabilities?.boot_strategy_default ?? ''] ?? conn.capabilities?.boot_strategy_default ?? '—' }}</DescriptionItem>
          <DescriptionItem label="资源注册">{{ conn.capabilities?.resources?.join('、') || '—' }}</DescriptionItem>
          <DescriptionItem label="PXE / 零注册">{{ conn.capabilities?.netboot_enabled ? '已启用' : '未启用' }}</DescriptionItem>
          <DescriptionItem label="Windows SMB 导出">{{ conn.capabilities?.windows_smb_share ? '已配置' : '未配置' }}</DescriptionItem>
          <DescriptionItem label="Windows agent 通路">{{ conn.capabilities?.windows_agent_installer ? '可用' : '不可用' }}</DescriptionItem>
          <DescriptionItem label="BIOS 修改确认">{{ CONFIRM_LABEL[conn.capabilities?.bios_set_confirm ?? ''] ?? conn.capabilities?.bios_set_confirm ?? '—' }}</DescriptionItem>
          <DescriptionItem label="擦盘确认">{{ CONFIRM_LABEL[conn.capabilities?.drive_erase_confirm ?? ''] ?? conn.capabilities?.drive_erase_confirm ?? '—' }}</DescriptionItem>
        </DescriptionList>

        <div class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2.5">
          <div v-for="g in distroGroups" :key="g.key" class="rounded-lg border bg-muted/30 p-3">
            <div class="mb-2 flex items-center gap-2.5">
              <DistroBadge :badge-key="g.key" />
              <span class="text-sm font-semibold">{{ g.label }}</span>
            </div>
            <div class="flex flex-col gap-1">
              <div v-for="v in g.items" :key="v.name" class="flex items-center justify-between gap-2">
                <span class="font-mono text-xs text-foreground/90">{{ v.name }}</span>
                <span class="inline-flex gap-1">
                  <Badge variant="secondary" class="text-[11px]">虚拟介质</Badge>
                  <Badge
                    v-if="v.pxe_support && v.pxe_support !== 'none'"
                    variant="outline"
                    class="rounded-md text-[11px] font-medium"
                    :style="v.pxe_support === 'full'
                      ? { color: '#10b981', borderColor: '#10b98155', backgroundColor: '#10b9811a' }
                      : { color: '#f59e0b', borderColor: '#f59e0b55', backgroundColor: '#f59e0b1a' }"
                  >
                    PXE{{ v.pxe_support === 'partial' ? '（部分）' : '' }}
                  </Badge>
                  <Badge v-else variant="outline" class="text-[11px] text-muted-foreground">无 PXE</Badge>
                </span>
              </div>
            </div>
          </div>
          <p v-if="(conn.capabilities?.distros ?? []).length === 0" class="text-sm text-muted-foreground">
            未注册任何发行版驱动
          </p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-base">当前生效配置<span class="ml-2 text-xs font-normal text-muted-foreground">只读快照，敏感项已脱敏</span></CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" :disabled="cfgQuery.isFetching.value" @click="() => cfgQuery.refetch()">
            <RefreshCcw class="size-4" /> 刷新
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Collapsible>
          <CollapsibleTrigger
            class="group flex w-full items-center justify-between rounded-lg border px-4 py-3 text-sm transition-colors hover:bg-muted/50"
          >
            展开查看 {{ configRows.length }} 项（env 名为键，与部署环境文件一致）
            <ChevronDown class="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent class="pt-3">
            <Skeleton v-if="cfgQuery.isPending.value" class="h-40 w-full" />
            <div v-else class="max-h-[420px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/50 hover:bg-muted/50">
                    <TableHead class="w-[380px]">环境变量</TableHead>
                    <TableHead class="min-w-[220px]">生效值</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="row in configRows" :key="row.key">
                    <TableCell>
                      <span class="font-mono text-xs">{{ row.key }}</span>
                      <Badge v-if="row.redacted" variant="outline" class="ml-2 text-[11px] text-muted-foreground">脱敏</Badge>
                    </TableCell>
                    <TableCell>
                      <template v-if="row.redacted">
                        <template v-if="row.value !== null && row.value !== undefined">
                          <span class="font-mono text-xs">***</span>
                          <span class="text-xs text-muted-foreground">（已配置）</span>
                        </template>
                        <span v-else class="text-xs text-muted-foreground">未配置</span>
                      </template>
                      <span v-else-if="row.value === null || row.value === undefined" class="text-xs text-muted-foreground">未设置</span>
                      <span v-else class="font-mono text-xs">{{ String(row.value) }}</span>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>
        <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
          修改配置请走部署层（编辑 env 文件或 compose 环境段后重启引擎）——引擎有意不提供运行时写路径，
          Token / 密钥 / 数据库地址 / SMB 与 relay 凭据等敏感项只显示已配置状态，不显示值。
        </p>
      </CardContent>
    </Card>
  </div>
</template>
