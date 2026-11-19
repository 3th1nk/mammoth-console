<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Check, ChevronsUpDown, ChevronDown, ChevronRight, Plus, RefreshCcw } from 'lucide-vue-next'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import { eventsListKey, eventDomain, webhooksKey } from '@/api/queryKeys'
import { confirm } from '@/composables/confirm'
import type { components } from '@/api/types.gen'
import { EVENT_TYPE_GROUPS, eventTypeLabel, resourceTypeLabel } from '@/utils/events'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import EmptyState from '@/components/EmptyState.vue'
import Pager from '@/components/Pager.vue'
import { copyToClipboard } from '@/utils/clipboard'
import { formatTime } from '@/utils/format'

type Webhook = components['schemas']['Webhook']

const { t } = useI18n()
const queryClient = useQueryClient()
const activeTab = ref<'events' | 'webhooks'>('events')

// ── 事件查询 ────────────────────────────────────────────────────────────────
const rtFilter = ref<string>('')
const ridFilter = ref('')
const ridInput = ref('')
const typeFilter = ref('')
const cursor = ref<string | undefined>(undefined)
const cursorStack = ref<(string | undefined)[]>([])

const eventsQuery = useQuery({
  queryKey: computed(() => eventsListKey(rtFilter.value, ridFilter.value, typeFilter.value, cursor.value)),
  queryFn: async () =>
    unwrap(
      await getClient().GET('/api/v1/events', {
        params: {
          query: {
            resource_type: (rtFilter.value || undefined) as never,
            resource_id: ridFilter.value.trim() || undefined,
            type: typeFilter.value.trim() || undefined,
            page_size: 50,
            cursor: cursor.value,
            // 审计视图最新在前（desc）：asc 首页是全表最老事件，翻到
            // 天荒地老也看不到最近发生了什么。下一页 = 更早的事件。
            order: 'desc',
          },
        },
      }),
    ),
})

const eventRows = computed(() => eventsQuery.data.value?.items ?? [])
const nextCursor = computed(() => eventsQuery.data.value?.next_cursor ?? null)

// expand 行:payload JSON
const expanded = ref<Set<number>>(new Set())
function toggleExpand(id: number) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function prettyPayload(p: unknown): string {
  try {
    return JSON.stringify(p, null, 2)
  } catch {
    return String(p)
  }
}

// 事件类型 Combobox:分组 + 可搜索 + allow-create(引擎 additive 新类型)
const typeOpen = ref(false)
const typeSearch = ref('')

function setType(v: string) {
  typeFilter.value = v
  typeOpen.value = false
  resetPaging()
}

function resetPaging() {
  cursor.value = undefined
  cursorStack.value = []
  expanded.value = new Set()
}
function nextPage() {
  if (!nextCursor.value) return
  cursorStack.value = [...cursorStack.value, cursor.value]
  cursor.value = nextCursor.value
}
function prevPage() {
  const prev = cursorStack.value[cursorStack.value.length - 1]
  cursorStack.value = cursorStack.value.slice(0, -1)
  cursor.value = prev
}

const RESOURCE_TYPES = ['job', 'task', 'machine', 'credential', 'pending', 'webhook']

// ── Webhooks 管理 ───────────────────────────────────────────────────────────
const hooksQuery = useQuery({
  queryKey: webhooksKey,
  queryFn: async () => unwrap(await getClient().GET('/api/v1/webhooks')),
})
const hookRows = computed(() => hooksQuery.data.value?.items ?? [])

const createVisible = ref(false)
const creating = ref(false)
const form = reactive({ url: '', types: [] as string[], resource_id: '' })
// secret 仅创建响应出现一次
const createdSecret = ref<{ url: string; secret: string } | null>(null)

function openCreate() {
  Object.assign(form, { url: '', types: [] as string[], resource_id: '' })
  createVisible.value = true
}

async function submitCreate() {
  if (!/^https?:\/\//.test(form.url.trim())) {
    toast.warning(t('events.urlRequired'))
    return
  }
  creating.value = true
  try {
    const types = form.types.map((x) => x.trim()).filter(Boolean)
    const data = await unwrap(await getClient().POST('/api/v1/webhooks', {
      body: {
        url: form.url.trim(),
        types: types.length > 0 ? types : undefined,
        resource_id: form.resource_id.trim() || undefined,
      },
    }))
    const created = data as components['schemas']['WebhookCreated'] | undefined
    createVisible.value = false
    createdSecret.value = {
      url: created?.url ?? form.url,
      secret: created?.secret ?? '',
    }
    void queryClient.invalidateQueries({ queryKey: webhooksKey })
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    creating.value = false
  }
}

async function removeHook(h: Webhook) {
  const ok = await confirm({
    title: t('common.delete'),
    description: t('events.deleteConfirmDesc', { url: h.url }),
    confirmText: t('common.delete'),
    destructive: true,
  })
  if (!ok) return
  try {
    await unwrap(await getClient().DELETE('/api/v1/webhooks/{id}', { params: { path: { id: h.id } } }))
    toast.success(t('common.deleted'))
    void hooksQuery.refetch()
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

function copySecret() {
  if (createdSecret.value?.secret) {
    void copyToClipboard(createdSecret.value.secret).then((ok) => {
      if (ok) toast.success(t('common.copied'))
      else toast.warning(t('common.copyFailed'))
    })
  }
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4 p-6 pt-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">{{ t('events.title') }}</h2>
        <p class="text-sm text-muted-foreground">{{ t('events.subtitle') }}</p>
      </div>
      <Button variant="outline" size="sm" @click="queryClient.invalidateQueries({ queryKey: eventDomain }); queryClient.invalidateQueries({ queryKey: webhooksKey })">
        <RefreshCcw class="size-4" /> {{ t('common.refresh') }}
      </Button>
    </div>

    <Tabs v-model="activeTab" class="gap-3">
      <TabsList class="w-fit">
        <TabsTrigger value="events">{{ t('events.tabEvents') }}</TabsTrigger>
        <TabsTrigger value="webhooks">{{ t('events.tabWebhooks') }}</TabsTrigger>
      </TabsList>

      <TabsContent value="events" class="mt-0">
        <Card>
          <CardContent class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <Select
                :model-value="rtFilter || 'all'"
                @update:model-value="(v: unknown) => { rtFilter = v === 'all' || v == null ? '' : String(v); resetPaging() }"
              >
                <SelectTrigger class="w-[150px]">
                  <SelectValue :placeholder="t('events.filterAllRt')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{{ t('events.filterAllRt') }}</SelectItem>
                  <SelectItem v-for="rt in RESOURCE_TYPES" :key="rt" :value="rt">{{ resourceTypeLabel(rt) }}</SelectItem>
                </SelectContent>
              </Select>
              <Input
                v-model="ridInput"
                :placeholder="t('events.ridPlaceholder')"
                class="w-[240px] font-mono"
                @keyup.enter="ridFilter = ridInput; resetPaging()"
              />
              <Popover v-model:open="typeOpen">
                <PopoverTrigger as-child>
                  <Button variant="outline" role="combobox" class="w-[260px] justify-between font-normal">
                    <span class="truncate">
                      {{ typeFilter ? `${eventTypeLabel(typeFilter)}（${typeFilter}）` : t('events.typeAll') }}
                    </span>
                    <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent class="w-[320px] p-0" align="start">
                  <Command>
                    <CommandInput v-model="typeSearch" placeholder="Search or type a new type…" />
                    <CommandList class="max-h-[300px]">
                      <CommandEmpty>
                        <button
                          v-if="typeSearch.trim()"
                          class="flex w-full items-center justify-center gap-1.5 px-3 py-2 text-sm text-primary"
                          @click="setType(typeSearch.trim())"
                        >
                          <Plus class="size-3.5" /> {{ t('events.typeUseFilter', { v: typeSearch.trim() }) }}
                        </button>
                      </CommandEmpty>
                      <CommandGroup v-for="g in EVENT_TYPE_GROUPS" :key="g.label" :heading="g.label">
                        <CommandItem
                          v-for="x in g.types"
                          :key="x.value"
                          :value="`${x.label} ${x.value}`"
                          @select="setType(x.value)"
                        >
                          <Check class="size-4" :class="typeFilter === x.value ? 'opacity-100' : 'opacity-0'" />
                          <span>{{ x.label }}</span>
                          <span class="ml-auto font-mono text-[11px] text-muted-foreground">{{ x.value }}</span>
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Button size="sm" @click="ridFilter = ridInput; resetPaging()">{{ t('common.search') }}</Button>
            </div>

            <Skeleton v-if="eventsQuery.isPending.value" class="h-56 w-full" />
            <div v-else class="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/50 hover:bg-muted/50">
                    <TableHead class="w-10" />
                    <TableHead class="w-20">{{ t('events.colId') }}</TableHead>
                    <TableHead class="w-28">{{ t('events.colResourceType') }}</TableHead>
                    <TableHead class="min-w-[160px]">{{ t('events.colResourceId') }}</TableHead>
                    <TableHead class="min-w-[200px]">{{ t('events.colEvent') }}</TableHead>
                    <TableHead class="w-44">{{ t('events.colTime') }}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <template v-for="row in eventRows" :key="row.id">
                    <TableRow>
                      <TableCell>
                        <button
                          class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          @click.stop="toggleExpand(row.id)"
                        >
                          <ChevronRight v-if="!expanded.has(row.id)" class="size-4" />
                          <ChevronDown v-else class="size-4" />
                        </button>
                      </TableCell>
                      <TableCell><span class="font-mono text-xs">{{ row.id }}</span></TableCell>
                      <TableCell class="text-muted-foreground">{{ resourceTypeLabel(row.resource_type) }}</TableCell>
                      <TableCell><span class="font-mono text-xs">{{ row.resource_id }}</span></TableCell>
                      <TableCell>
                        <div class="text-sm">{{ eventTypeLabel(row.type) }}</div>
                        <div class="font-mono text-[11px] text-muted-foreground">{{ row.type }}</div>
                      </TableCell>
                      <TableCell class="text-muted-foreground">{{ formatTime(row.ts) }}</TableCell>
                    </TableRow>
                    <TableRow v-if="expanded.has(row.id)" class="hover:bg-transparent">
                      <TableCell :colspan="6" class="bg-muted/30 p-0">
                        <pre class="mx-10 my-3 max-h-[260px] overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed">{{ prettyPayload(row.payload) }}</pre>
                      </TableCell>
                    </TableRow>
                  </template>
                </TableBody>
              </Table>
              <EmptyState v-if="eventRows.length === 0" :description="t('events.noMatch')" />
            </div>

            <Pager
              :hint="t('events.pagerHint')"
              :has-prev="cursorStack.length > 0"
              :has-next="!!nextCursor"
              @prev="prevPage"
              @next="nextPage"
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="webhooks" class="mt-0">
        <Card>
          <CardContent class="flex flex-col gap-3">
            <div>
              <Button size="sm" @click="openCreate"><Plus class="size-4" /> {{ t('events.create') }}</Button>
            </div>
            <Skeleton v-if="hooksQuery.isPending.value" class="h-40 w-full" />
            <div v-else class="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/50 hover:bg-muted/50">
                    <TableHead class="min-w-[240px]">{{ t('events.colUrl') }}</TableHead>
                    <TableHead class="min-w-[180px]">{{ t('events.colTypes') }}</TableHead>
                    <TableHead class="min-w-[120px]">{{ t('events.colResourceFilter') }}</TableHead>
                    <TableHead class="w-24">{{ t('events.colWatermark') }}</TableHead>
                    <TableHead class="w-20">{{ t('events.colFailCount') }}</TableHead>
                    <TableHead class="w-20">{{ t('machines.colActions') }}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="row in hookRows" :key="row.id">
                    <TableCell><span class="break-all font-mono text-xs">{{ row.url }}</span></TableCell>
                    <TableCell>
                      <div v-if="row.types && row.types.length > 0" class="flex flex-wrap gap-1">
                        <span
                          v-for="x in row.types"
                          :key="x"
                          class="rounded-md border bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground"
                          :title="x"
                        >{{ eventTypeLabel(x) }}</span>
                      </div>
                      <span v-else class="text-muted-foreground">{{ t('events.allEvents') }}</span>
                    </TableCell>
                    <TableCell>
                      <span v-if="row.resource_id" class="font-mono text-xs">{{ row.resource_id }}</span>
                      <span v-else class="text-muted-foreground">—</span>
                    </TableCell>
                    <TableCell><span class="font-mono text-xs">{{ row.watermark ?? '—' }}</span></TableCell>
                    <TableCell>
                      <span
                        v-if="(row.fail_count ?? 0) > 0"
                        class="rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive"
                      >{{ row.fail_count }}</span>
                      <span v-else class="text-muted-foreground">0</span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        class="h-8 text-destructive hover:text-destructive"
                        @click.stop="removeHook(row)"
                      >
                        {{ t('common.delete') }}
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <EmptyState v-if="hookRows.length === 0" :description="t('events.hooksEmpty')">
                <p class="text-xs text-muted-foreground">{{ t('events.hooksEmptyHint') }}</p>
              </EmptyState>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>

    <Dialog :open="createVisible" @update:open="(v: boolean) => (createVisible = v)">
      <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{{ t('events.createTitle') }}</DialogTitle>
          <DialogDescription>{{ t('events.createDesc') }}</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="submitCreate">
          <div class="grid gap-1.5">
            <Label for="hook-url">{{ t('events.urlLabel') }}</Label>
            <Input id="hook-url" v-model="form.url" :placeholder="t('events.urlPlaceholder')" class="font-mono" />
          </div>
          <div class="grid gap-1.5">
            <Label>{{ t('events.typesLabel') }}</Label>
            <div class="rounded-lg border p-3">
              <div class="grid gap-2.5">
                <div v-for="g in EVENT_TYPE_GROUPS" :key="g.label">
                  <p class="mb-1.5 text-xs font-medium text-muted-foreground">{{ g.label }}</p>
                  <div class="flex flex-wrap gap-x-4 gap-y-2">
                    <label v-for="x in g.types" :key="x.value" class="flex cursor-pointer items-center gap-2 text-sm" :title="x.value">
                      <Checkbox
                        :model-value="form.types.includes(x.value)"
                        @update:model-value="(v: boolean | 'indeterminate') => {
                          if (v === 'indeterminate') return
                          form.types = v ? [...form.types, x.value] : form.types.filter((y) => y !== x.value)
                        }"
                      />
                      {{ x.label }}
                    </label>
                  </div>
                </div>
              </div>
              <p class="mt-2.5 text-xs text-muted-foreground">{{ t('events.typesHint') }}</p>
            </div>
          </div>
          <div class="grid gap-1.5">
            <Label for="hook-rid">{{ t('events.ridLabel') }}</Label>
            <Input id="hook-rid" v-model="form.resource_id" :placeholder="t('events.ridLabelPlaceholder')" class="font-mono" />
            <p class="text-xs text-muted-foreground">{{ t('events.ridHint') }}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="createVisible = false">{{ t('common.cancel') }}</Button>
            <Button type="submit" :disabled="creating">{{ t('events.created') }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog :open="createdSecret !== null" @update:open="(v: boolean) => { if (!v) createdSecret = null }">
      <DialogContent class="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{{ t('events.secretTitle') }}</DialogTitle>
          <DialogDescription>{{ t('events.secretDesc') }}</DialogDescription>
        </DialogHeader>
        <div class="break-all rounded-md bg-muted px-3 py-2.5 font-mono text-sm">{{ createdSecret?.secret }}</div>
        <p class="text-xs text-muted-foreground">{{ createdSecret?.url }}</p>
        <DialogFooter>
          <Button variant="outline" @click="copySecret">{{ t('common.copy') }}</Button>
          <Button @click="createdSecret = null">{{ t('events.saved') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
