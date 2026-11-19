<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { LoaderCircle, Plus, RefreshCcw, Trash2 } from 'lucide-vue-next'
import { useQuery } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
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

const { t } = useI18n()

const query = useQuery({
  queryKey: credentialsKey,
  queryFn: async () => unwrap(await getClient().GET('/api/v1/credentials')),
})

const rows = computed(() => query.data.value?.items ?? [])

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
    toast.warning(t('credentials.nameUserRequired'))
    return
  }
  if (form.type === 'bmc' && !form.password) {
    toast.warning(t('credentials.bmcPassRequired'))
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
    toast.success(t('credentials.created'))
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
    title: t('credentials.deleteConfirmTitle', { name: c.name }),
    description: t('credentials.deleteConfirmDesc'),
    confirmText: t('common.delete'),
    destructive: true,
  })
  if (!ok) return
  try {
    await unwrap(await getClient().DELETE('/api/v1/credentials/{id}', { params: { path: { id: c.id } } }))
    toast.success(t('credentials.deleted'))
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
        <h2 class="text-2xl font-bold tracking-tight">{{ t('credentials.title') }}</h2>
        <p class="text-sm text-muted-foreground">{{ t('credentials.subtitle', { n: rows.length }) }}</p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="query.refetch()">
          <RefreshCcw class="size-4" /> {{ t('common.refresh') }}
        </Button>
        <Button size="sm" @click="openCreate"><Plus class="size-4" /> {{ t('credentials.create') }}</Button>
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
                <TableHead class="w-32">{{ t('credentials.colType') }}</TableHead>
                <TableHead class="min-w-[180px]">{{ t('credentials.colName') }}</TableHead>
                <TableHead class="min-w-[180px]">{{ t('credentials.colId') }}</TableHead>
                <TableHead class="w-44">{{ t('machines.colCreatedAt') }}</TableHead>
                <TableHead class="w-20">{{ t('machines.colActions') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in rows" :key="row.id">
                <TableCell>
                  <Badge :variant="row.type === 'bmc' ? 'secondary' : 'outline'">
                    {{ row.type === 'bmc' ? t('credentials.typeBmc') : t('credentials.typeSsh') }}
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
                    <Trash2 class="size-4" /> {{ t('common.delete') }}
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <EmptyState v-if="rows.length === 0" :description="t('credentials.empty')">
            <p class="max-w-[440px] text-xs leading-relaxed text-muted-foreground">
              {{ t('credentials.emptyHint') }}
            </p>
          </EmptyState>
        </div>
      </CardContent>
    </Card>

    <Dialog :open="visible" @update:open="(v: boolean) => (visible = v)">
      <DialogContent class="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{{ t('credentials.createTitle') }}</DialogTitle>
          <DialogDescription>{{ t('credentials.createDesc') }}</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="submit">
          <div class="grid gap-1.5">
            <Label for="cred-name">{{ t('credentials.nameLabel') }}</Label>
            <Input id="cred-name" v-model="form.name" :placeholder="t('credentials.namePlaceholder')" />
          </div>
          <div class="grid gap-1.5">
            <Label>{{ t('credentials.colType') }}</Label>
            <SegmentedControl
              v-model="form.type"
              :options="[
                { value: 'bmc', label: t('credentials.typeBmc') },
                { value: 'ssh', label: t('credentials.typeSsh') },
              ]"
            />
          </div>
          <div class="grid gap-1.5">
            <Label for="cred-user">{{ t('credentials.userLabel') }}</Label>
            <Input id="cred-user" v-model="form.username" class="font-mono" />
          </div>
          <div class="grid gap-1.5">
            <Label for="cred-pass">{{ form.type === 'bmc' ? t('credentials.passLabel') : t('credentials.passSshLabel') }}</Label>
            <Input id="cred-pass" v-model="form.password" type="password" class="font-mono" />
          </div>
          <div v-if="form.type === 'ssh'" class="grid gap-1.5">
            <Label for="cred-key">{{ t('credentials.keyLabel') }}</Label>
            <Textarea
              id="cred-key"
              v-model="form.private_key"
              :rows="4"
              class="font-mono"
              :placeholder="t('credentials.keyPlaceholder')"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="visible = false">{{ t('common.cancel') }}</Button>
            <Button type="submit" :disabled="submitting">
              <LoaderCircle v-if="submitting" class="size-4 animate-spin" /> {{ t('common.create') }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
