<script setup lang="ts">
import { computed, ref } from 'vue'
import { LoaderCircle, Plus, RefreshCcw, Trash2 } from 'lucide-vue-next'
import { useQuery } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
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

const { t } = useI18n()
const rows = computed(() => query.data.value?.items ?? [])

function imageBadge(state: string) {
  const s = IMAGE_STATE[state] ?? { labelKey: state, tone: 'neutral' as const }
  return { label: t(s.labelKey), style: toneBadgeStyle(s.tone) }
}

// 发行版列只拼 dd 直写通路有信息量的压缩格式（raw.gz/raw.xz）。引擎嗅探器
// 对非 gzip/xz 一律恒等落 raw（含 ISO 9660，引擎 compress.go），对 ISO 无
// 信息量，拼进发行版列只是噪音（250 环境全库出现 raw 尾缀的根因）。
function distroText(row: Image): string {
  const format = row.format && row.format !== 'raw' ? row.format : ''
  return [row.distro, row.version, format].filter(Boolean).join(' ')
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
    toast.warning(t('images.regNeedUrlSha'))
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
    toast.success(t('images.regDone'))
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
    title: t('images.deleteConfirmTitle', { name: img.name || img.id }),
    description: t('images.deleteConfirmDesc'),
    confirmText: t('common.delete'),
    destructive: true,
  })
  if (!ok) return
  try {
    await unwrap(await getClient().DELETE('/api/v1/images/{id}', { params: { path: { id: img.id } } }))
    toast.success(t('common.deleted'))
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
        <h2 class="text-2xl font-bold tracking-tight">{{ t('images.title') }}</h2>
        <p class="text-sm text-muted-foreground">{{ t('images.subtitle', { n: rows.length }) }}</p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="query.refetch()">
          <RefreshCcw class="size-4" /> {{ t('common.refresh') }}
        </Button>
        <Button size="sm" @click="openRegister"><Plus class="size-4" /> {{ t('images.register') }}</Button>
      </div>
    </div>

    <Alert class="border-blue-500/30 bg-blue-500/5">
      <AlertTitle>{{ t('images.infoTitle') }}</AlertTitle>
      <AlertDescription>{{ t('images.infoDesc') }}</AlertDescription>
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
                <TableHead class="w-24">{{ t('images.colState') }}</TableHead>
                <TableHead class="min-w-[130px]">{{ t('images.colName') }}</TableHead>
                <TableHead class="w-32">{{ t('images.colDistro') }}</TableHead>
                <TableHead class="min-w-[220px]">{{ t('images.colSource') }}</TableHead>
                <TableHead class="min-w-[180px]">{{ t('images.colSha') }}</TableHead>
                <TableHead class="w-24">{{ t('images.colSize') }}</TableHead>
                <TableHead class="w-44">{{ t('images.colCreatedAt') }}</TableHead>
                <TableHead class="w-20">{{ t('machines.colActions') }}</TableHead>
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
                  <span v-if="distroText(row)" class="font-mono text-xs">
                    {{ distroText(row) }}
                  </span>
                  <span v-else-if="row.state === 'fetching'" class="text-muted-foreground" :title="t('images.identifyingTip')">
                    {{ t('images.identifying') }}
                  </span>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell>
                  <span
                    v-if="row.source_url?.startsWith('dir://')"
                    class="text-muted-foreground"
                    :title="t('images.dirImportedTip', { path: row.source_url.slice('dir://'.length) })"
                  >{{ t('images.dirImported') }}</span>
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
                    <Trash2 class="size-4" /> {{ t('common.delete') }}
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <EmptyState v-if="rows.length === 0" :description="t('images.empty')">
            <p class="max-w-[460px] text-xs leading-relaxed text-muted-foreground">
              {{ t('images.emptyHint') }}
            </p>
          </EmptyState>
        </div>

        <div class="mt-3 space-y-2">
          <Alert
            v-for="(img, i) in rows.filter((r) => r.state === 'failed')"
            :key="'failed-' + i"
            variant="destructive"
          >
            <AlertTitle>{{ t('images.fetchFailed', { name: img.name || img.source_url }) }}</AlertTitle>
            <AlertDescription>{{ img.error }}</AlertDescription>
          </Alert>
          <Alert v-for="(img, i) in rows.filter((r) => r.state === 'missing')" :key="'missing-' + i" class="border-amber-500/40 bg-amber-500/5">
            <AlertTitle>{{ t('images.missing', { name: img.name || img.sha256.slice(0, 12) }) }}</AlertTitle>
            <AlertDescription>{{ t('images.missingDesc') }}</AlertDescription>
          </Alert>
        </div>
      </CardContent>
    </Card>

    <Dialog :open="regVisible" @update:open="(v: boolean) => (regVisible = v)">
      <DialogContent class="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{{ t('images.regTitle') }}</DialogTitle>
          <DialogDescription>{{ t('images.regDesc') }}</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="submitRegister">
          <div class="grid gap-1.5">
            <Label for="img-name">{{ t('images.nameLabel') }}</Label>
            <Input id="img-name" v-model="reg.name" :placeholder="t('images.namePlaceholder')" />
          </div>
          <div class="grid gap-1.5">
            <Label for="img-url">{{ t('images.urlLabel') }}</Label>
            <Input
              id="img-url"
              v-model="reg.source_url"
              :placeholder="t('images.urlPlaceholder')"
              class="font-mono"
            />
          </div>
          <div class="grid gap-1.5">
            <Label for="img-sha">{{ t('images.shaLabel') }}</Label>
            <Input
              id="img-sha"
              v-model="reg.sha256"
              :placeholder="t('images.shaPlaceholder')"
              class="font-mono"
            />
            <p class="text-xs leading-relaxed text-muted-foreground">{{ t('images.shaHint') }}</p>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="grid gap-1.5">
              <Label for="img-distro">{{ t('images.distroLabel') }}</Label>
              <Input id="img-distro" v-model="reg.distro" :placeholder="t('images.distroPlaceholder')" />
            </div>
            <div class="grid gap-1.5">
              <Label for="img-version">{{ t('images.versionLabel') }}</Label>
              <Input id="img-version" v-model="reg.version" :placeholder="t('images.versionPlaceholder')" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="regVisible = false">{{ t('common.cancel') }}</Button>
            <Button type="submit" :disabled="registering">
              <LoaderCircle v-if="registering" class="size-4 animate-spin" /> {{ t('images.regSubmit') }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
