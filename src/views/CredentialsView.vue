<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { LoaderCircle, Plus, RefreshCcw, Trash2 } from 'lucide-vue-next'
import { useQuery } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { credentialsKey } from '@/api/queryKeys'
import { confirm } from '@/composables/confirm'
import type { components } from '@/api/types.gen'
import { formatTime } from '@/utils/format'
import { Alert, AlertTitle } from '@/components/ui/alert'
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
import SegmentedControl from '@/components/SegmentedControl.vue'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import EmptyState from '@/components/EmptyState.vue'

type Credential = components['schemas']['Credential']

const query = useQuery({
  queryKey: credentialsKey,
  queryFn: async () => unwrap(await getClient().GET('/api/v1/credentials')),
})

const rows = computed(() => query.data.value?.items ?? [])

const TYPE_LABEL: Record<string, string> = { bmc: 'BMC（带外）', ssh: 'SSH（带内）' }

// ── 新建对话框 ──────────────────────────────────────────────────────────────
const visible = ref(false)
const submitting = ref(false)
const form = reactive({
  name: '',
  type: 'bmc' as 'bmc' | 'ssh',
  username: '',
  password: '',
  private_key: '',
})

function openCreate() {
  Object.assign(form, { name: '', type: 'bmc', username: '', password: '', private_key: '' })
  visible.value = true
}

async function submit() {
  if (!form.name.trim() || !form.username.trim()) {
    toast.warning('请填写名称与用户名')
    return
  }
  if (form.type === 'bmc' && !form.password) {
    toast.warning('BMC 凭证需要密码')
    return
  }
  submitting.value = true
  try {
    const secret: components['schemas']['CredentialSecret'] = { username: form.username }
    if (form.password) secret.password = form.password
    if (form.type === 'ssh' && form.private_key.trim()) secret.private_key = form.private_key
    await unwrap(
      await getClient().POST('/api/v1/credentials', {
        body: { name: form.name.trim(), type: form.type, secret },
      }),
    )
    toast.success('凭证已创建（secret 仅此一次提交，之后不可查看）')
    visible.value = false
    void query.refetch()
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}

async function remove(c: Credential) {
  const ok = await confirm({
    title: `删除凭证 ${c.name}`,
    description: '删除后引用它的机器将无法带外操作（引擎会拒绝仍被引用的凭证）。确定删除？',
    confirmText: '删除',
    destructive: true,
  })
  if (!ok) return
  try {
    await unwrap(await getClient().DELETE('/api/v1/credentials/{id}', { params: { path: { id: c.id } } }))
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
        <h2 class="text-2xl font-bold tracking-tight">凭证</h2>
        <p class="text-sm text-muted-foreground">
          带外（BMC）与带内（SSH）访问凭据 · 共 {{ rows.length }} 条
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="query.refetch()">
          <RefreshCcw class="size-4" /> 刷新
        </Button>
        <Button size="sm" @click="openCreate"><Plus class="size-4" /> 新建凭证</Button>
      </div>
    </div>

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
                <TableHead class="w-32">类型</TableHead>
                <TableHead class="min-w-[180px]">名称</TableHead>
                <TableHead class="min-w-[180px]">ID</TableHead>
                <TableHead class="w-44">创建时间</TableHead>
                <TableHead class="w-20">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in rows" :key="row.id">
                <TableCell>
                  <Badge :variant="row.type === 'bmc' ? 'secondary' : 'outline'">
                    {{ TYPE_LABEL[row.type] ?? row.type }}
                  </Badge>
                </TableCell>
                <TableCell class="font-medium">{{ row.name }}</TableCell>
                <TableCell><span class="font-mono text-xs">{{ row.id }}</span></TableCell>
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
          <EmptyState v-if="rows.length === 0" description="还没有凭证">
            <p class="max-w-[440px] text-xs leading-relaxed text-muted-foreground">
              凭证是只写资源：secret 一经创建不可查看。BMC 凭证用于带外操作，
              SSH 凭证用于带内分区级盘查。
            </p>
          </EmptyState>
        </div>
      </CardContent>
    </Card>

    <Dialog :open="visible" @update:open="(v: boolean) => (visible = v)">
      <DialogContent class="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>新建凭证</DialogTitle>
          <DialogDescription>secret 仅在创建响应中出现一次，之后不可查看。</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="submit">
          <div class="grid gap-1.5">
            <Label for="cred-name">名称（唯一）</Label>
            <Input id="cred-name" v-model="form.name" placeholder="如 bmc-rack01" />
          </div>
          <div class="grid gap-1.5">
            <Label>类型</Label>
            <SegmentedControl
              v-model="form.type"
              :options="[
                { value: 'bmc', label: 'BMC（带外）' },
                { value: 'ssh', label: 'SSH（带内）' },
              ]"
            />
          </div>
          <div class="grid gap-1.5">
            <Label for="cred-user">用户名</Label>
            <Input id="cred-user" v-model="form.username" class="font-mono" />
          </div>
          <div class="grid gap-1.5">
            <Label for="cred-pass">{{ form.type === 'bmc' ? '密码' : '密码（密钥认证时可留空）' }}</Label>
            <Input id="cred-pass" v-model="form.password" type="password" class="font-mono" />
          </div>
          <div v-if="form.type === 'ssh'" class="grid gap-1.5">
            <Label for="cred-key">私钥 PEM（可选；留在引擎侧作带内 SSH 认证，不会写入装机系统）</Label>
            <Textarea
              id="cred-key"
              v-model="form.private_key"
              :rows="4"
              class="font-mono"
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="visible = false">取消</Button>
            <Button type="submit" :disabled="submitting">
              <LoaderCircle v-if="submitting" class="size-4 animate-spin" /> 创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
