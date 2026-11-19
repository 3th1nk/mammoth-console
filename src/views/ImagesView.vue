<script setup lang="ts">
import { computed, ref } from 'vue'
import { LoaderCircle, Plus, RefreshCcw, Trash2 } from 'lucide-vue-next'
import { useQuery } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { imagesKey } from '@/api/queryKeys'
import { confirm } from '@/composables/confirm'
import type { components } from '@/api/types.gen'
import { IMAGE_STATE, toneBadgeStyle } from '@/utils/stateColors'
import { formatBytes, formatTime } from '@/utils/format'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import EmptyState from '@/components/EmptyState.vue'

type Image = components['schemas']['Image']

// 镜像有后台拉取（fetching→ready/failed），有 fetching 行时 3s 轮询跟进；
// missing（缓存文件被移出媒体目录）由引擎扫描器自动恢复（周期 60s），15s 轮询跟进；
// 列表无分页（契约：newest first 全量返回）
const query = useQuery({
  queryKey: imagesKey,
  queryFn: async () => unwrap(await getClient().GET('/api/v1/images')),
  refetchInterval: (q) => {
    const items = q.state.data?.items ?? []
    if (items.some((i) => i.state === 'fetching')) return 3000
    return items.some((i) => i.state === 'missing') ? 15000 : false
  },
})

const rows = computed(() => query.data.value?.items ?? [])

function imageBadge(state: string) {
  const s = IMAGE_STATE[state] ?? { label: state, tone: 'neutral' as const }
  return { label: s.label, style: toneBadgeStyle(s.tone) }
}

// ── 注册对话框 ──────────────────────────────────────────────────────────────
const regVisible = ref(false)
const reg = ref({ name: '', source_url: '', sha256: '', distro: '', version: '' })
const registering = ref(false)

function openRegister() {
  reg.value = { name: '', source_url: '', sha256: '', distro: '', version: '' }
  regVisible.value = true
}

async function submitRegister() {
  const sha = reg.value.sha256.trim().toLowerCase()
  if (!reg.value.source_url.trim() || !/^[0-9a-f]{64}$/.test(sha)) {
    toast.warning('请填写镜像 URL 与 SHA256')
    return
  }
  registering.value = true
  try {
    await unwrap(
      await getClient().POST('/api/v1/images', {
        body: {
          name: reg.value.name.trim() || undefined,
          source_url: reg.value.source_url.trim(),
          sha256: sha,
          distro: reg.value.distro.trim() || undefined,
          version: reg.value.version.trim() || undefined,
        },
      }),
    )
    toast.success('已注册，引擎正在拉取镜像（distro/version 留空时引擎会自动识别）')
    regVisible.value = false
    void query.refetch()
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    registering.value = false
  }
}

async function remove(img: Image) {
  const ok = await confirm({
    title: `删除镜像 ${img.name || img.id}`,
    description:
      '删除后已引用该镜像的既有任务不受影响（job spec 在提交时已快照），但后续装机不能再选择它。确定删除？',
    confirmText: '删除',
    destructive: true,
  })
  if (!ok) return
  try {
    await unwrap(await getClient().DELETE('/api/v1/images/{id}', { params: { path: { id: img.id } } }))
    toast.success('已删除')
    void query.refetch()
  } catch (e) {
    toast.error(errorMessage(e))
  }
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">镜像库</h2>
        <p class="text-sm text-muted-foreground">装机镜像注册与拉取状态 · 共 {{ rows.length }} 个</p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="query.refetch()">
          <RefreshCcw class="size-4" /> 刷新
        </Button>
        <Button size="sm" @click="openRegister"><Plus class="size-4" /> 注册镜像</Button>
      </div>
    </div>

    <Alert class="border-blue-500/30 bg-blue-500/5">
      <AlertTitle>SHA256 是门禁不是元数据</AlertTitle>
      <AlertDescription>
        拉取时边流边校验，不符即弃、不落缓存；相同摘要的镜像共享同一份缓存文件。
        把 ISO 直接拷进引擎媒体目录的 images/ 子目录也可以——目录扫描器每分钟自动导入（含
        distro/version 识别），无需注册。
      </AlertDescription>
    </Alert>

    <Alert v-if="query.error.value" variant="destructive">
      <AlertTitle>{{ errorMessage(query.error.value) }}</AlertTitle>
    </Alert>

    <Card>
      <CardContent>
        <Skeleton v-if="query.isPending.value" class="h-56 w-full" />
        <div v-else class="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="w-24">状态</TableHead>
                <TableHead class="min-w-[130px]">名称</TableHead>
                <TableHead class="w-32">发行版</TableHead>
                <TableHead class="min-w-[220px]">来源</TableHead>
                <TableHead class="min-w-[180px]">SHA256</TableHead>
                <TableHead class="w-24">大小</TableHead>
                <TableHead class="w-44">注册时间</TableHead>
                <TableHead class="w-20">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in rows" :key="row.id">
                <TableCell>
                  <Badge variant="outline" class="rounded-md font-medium" :style="imageBadge(row.state).style">
                    {{ imageBadge(row.state).label }}
                  </Badge>
                </TableCell>
                <TableCell class="font-medium">{{ row.name || '—' }}</TableCell>
                <TableCell>
                  <span v-if="row.distro || row.version || row.format" class="font-mono text-xs">
                    {{ [row.distro, row.version, row.format].filter(Boolean).join(' ') }}
                  </span>
                  <span v-else-if="row.state === 'fetching'" class="text-muted-foreground" title="引擎识别后将自动展示">
                    识别中
                  </span>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell>
                  <span
                    v-if="row.source_url?.startsWith('dir://')"
                    class="text-muted-foreground"
                    :title="`引擎从媒体目录自动导入：${row.source_url.slice('dir://'.length)}`"
                  >媒体目录（自动导入）</span>
                  <span v-else class="break-all font-mono text-xs">{{ row.source_url }}</span>
                </TableCell>
                <TableCell>
                  <span class="block max-w-[200px] truncate font-mono text-[11px] text-muted-foreground" :title="row.sha256">
                    {{ row.sha256 }}
                  </span>
                </TableCell>
                <TableCell class="text-muted-foreground">{{ row.size_bytes ? formatBytes(row.size_bytes) : '—' }}</TableCell>
                <TableCell class="text-muted-foreground">{{ formatTime(row.created_at) }}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-8 text-destructive hover:text-destructive"
                    @click.stop="remove(row)"
                  >
                    <Trash2 class="size-4" /> 删除
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <EmptyState v-if="rows.length === 0" description="镜像库是空的">
            <p class="max-w-[460px] text-xs leading-relaxed text-muted-foreground">
              注册一个 http(s) 镜像地址与其 SHA256，引擎会在后台拉取并校验——
              装机时直接从库里选择，不必再手工粘贴校验和。
              也可以把 ISO 直接拷进引擎媒体目录的 images/ 子目录，每分钟自动扫描导入。
            </p>
          </EmptyState>
        </div>

        <div class="mt-3 space-y-2">
          <Alert
            v-for="(img, i) in rows.filter((r) => r.state === 'failed')"
            :key="'failed-' + i"
            variant="destructive"
          >
            <AlertTitle>拉取失败：{{ img.name || img.source_url }}</AlertTitle>
            <AlertDescription>{{ img.error }}</AlertDescription>
          </Alert>
          <Alert v-for="(img, i) in rows.filter((r) => r.state === 'missing')" :key="'missing-' + i" class="border-amber-500/40 bg-amber-500/5">
            <AlertTitle>文件缺失：{{ img.name || img.sha256.slice(0, 12) }}</AlertTitle>
            <AlertDescription>
              缓存文件被移出了媒体目录。把文件放回（换成任意文件名的同一副本亦可），引擎会在下个扫描周期自动恢复为就绪，无需重新注册。
            </AlertDescription>
          </Alert>
        </div>
      </CardContent>
    </Card>

    <Dialog :open="regVisible" @update:open="(v: boolean) => (regVisible = v)">
      <DialogContent class="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>注册镜像</DialogTitle>
          <DialogDescription>引擎在后台拉取并校验 SHA256，完成后可在装机向导中选择。</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="submitRegister">
          <div class="grid gap-1.5">
            <Label for="img-name">名称（可选；粘贴地址后自动按文件名预填）</Label>
            <Input id="img-name" v-model="reg.name" placeholder="如 rocky9.4-qa" />
          </div>
          <div class="grid gap-1.5">
            <Label for="img-url">镜像地址（http/s，引擎可达）</Label>
            <Input
              id="img-url"
              v-model="reg.source_url"
              placeholder="https://mirror.example.com/rocky9.iso"
              class="font-mono"
            />
          </div>
          <div class="grid gap-1.5">
            <Label for="img-sha">SHA256</Label>
            <Input
              id="img-sha"
              v-model="reg.sha256"
              placeholder="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
              class="font-mono"
            />
            <p class="text-xs leading-relaxed text-muted-foreground">
              引擎按它做拉取门禁：不符即弃、不落缓存。发行版与版本留空时，拉取完成后自动识别。
              整盘镜像（直写通路 dd）无 ISO 结构、发行版不会被识别——注册时请显式填
              distro=<code class="font-mono">dd</code>；压缩格式（raw/raw.gz/raw.xz）与未压缩校验和引擎会按缓存文件自动识别，无需填写。
            </p>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="grid gap-1.5">
              <Label for="img-distro">发行版</Label>
              <Input id="img-distro" v-model="reg.distro" placeholder="rocky" />
            </div>
            <div class="grid gap-1.5">
              <Label for="img-version">版本</Label>
              <Input id="img-version" v-model="reg.version" placeholder="9.4" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="regVisible = false">取消</Button>
            <Button type="submit" :disabled="registering">
              <LoaderCircle v-if="registering" class="size-4 animate-spin" /> 注册并拉取
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
