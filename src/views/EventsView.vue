<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getClient } from '@/api/client'
import { unwrap, errorMessage } from '@/api/problem'
import type { components } from '@/api/types.gen'
import { formatTime } from '@/utils/format'
import {
  EVENT_TYPE_GROUPS,
  eventTypeLabel,
  resourceTypeLabel,
} from '@/utils/events'

type Webhook = components['schemas']['Webhook']

const queryClient = useQueryClient()
const activeTab = ref<'events' | 'webhooks'>('events')

// ── 事件查询 ────────────────────────────────────────────────────────────────
const rtFilter = ref<string>('')
const ridFilter = ref('')
const typeFilter = ref('')
const cursor = ref<string | undefined>(undefined)
const cursorStack = ref<(string | undefined)[]>([])

const eventsQuery = useQuery({
  queryKey: computed(() => ['events', rtFilter.value, ridFilter.value, typeFilter.value, cursor.value]),
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
          },
        },
      }),
    ),
})

const eventRows = computed(() => eventsQuery.data.value?.items ?? [])
const nextCursor = computed(() => eventsQuery.data.value?.next_cursor ?? null)

function resetPaging() {
  cursor.value = undefined
  cursorStack.value = []
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

function prettyPayload(p: unknown): string {
  try {
    return JSON.stringify(p, null, 2)
  } catch {
    return String(p)
  }
}

// ── Webhooks 管理 ───────────────────────────────────────────────────────────
const hooksQuery = useQuery({
  queryKey: ['webhooks'],
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
    ElMessage.warning('回调地址需为 http(s) URL')
    return
  }
  creating.value = true
  try {
    const types = form.types.map((t) => t.trim()).filter(Boolean)
    const { data } = await getClient().POST('/api/v1/webhooks', {
      body: {
        url: form.url.trim(),
        types: types.length > 0 ? types : undefined,
        resource_id: form.resource_id.trim() || undefined,
      },
    })
    const created = data as components['schemas']['WebhookCreated'] | undefined
    createVisible.value = false
    createdSecret.value = {
      url: created?.url ?? form.url,
      secret: created?.secret ?? '',
    }
    void queryClient.invalidateQueries({ queryKey: ['webhooks'] })
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    creating.value = false
  }
}

async function removeHook(h: Webhook) {
  try {
    await ElMessageBox.confirm(`删除后不再向 ${h.url} 投递事件。确定删除？`, '删除 webhook', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await unwrap(await getClient().DELETE('/api/v1/webhooks/{id}', { params: { path: { id: h.id } } }))
    ElMessage.success('已删除')
    void hooksQuery.refetch()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

const RESOURCE_TYPES = ['job', 'task', 'machine', 'credential', 'pending', 'webhook']

function copySecret() {
  if (createdSecret.value?.secret) {
    void navigator.clipboard.writeText(createdSecret.value.secret)
    ElMessage.success('已复制到剪贴板')
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">事件</h1>
      <el-button :icon="Refresh" @click="queryClient.invalidateQueries({ queryKey: ['events'] }); queryClient.invalidateQueries({ queryKey: ['webhooks'] })">
        刷新
      </el-button>
    </div>

    <el-card shadow="never">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="事件查询" name="events">
          <div class="filters">
            <el-select v-model="rtFilter" placeholder="全部资源类型" clearable style="width: 150px" @change="resetPaging">
              <el-option v-for="rt in RESOURCE_TYPES" :key="rt" :label="resourceTypeLabel(rt)" :value="rt" />
            </el-select>
            <el-input
              v-model="ridFilter"
              placeholder="资源 ID 过滤（如 job_x9k2）"
              clearable
              style="width: 240px"
              class="mono"
              @keyup.enter="resetPaging"
              @clear="resetPaging"
            />
            <el-select
              v-model="typeFilter"
              placeholder="全部事件类型"
              clearable
              filterable
              allow-create
              default-first-option
              style="width: 240px"
              @change="resetPaging"
            >
              <el-option-group v-for="g in EVENT_TYPE_GROUPS" :key="g.label" :label="g.label">
                <el-option v-for="t in g.types" :key="t.value" :label="t.label" :value="t.value" />
              </el-option-group>
            </el-select>
            <el-button type="primary" @click="resetPaging">查询</el-button>
          </div>

          <el-table v-loading="eventsQuery.isFetching.value" :data="eventRows" size="small">
            <el-table-column type="expand">
              <template #default="{ row }">
                <pre class="payload mono">{{ prettyPayload(row.payload) }}</pre>
              </template>
            </el-table-column>
            <el-table-column label="#" width="90">
              <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
            </el-table-column>
            <el-table-column label="资源类型" width="110">
              <template #default="{ row }">{{ resourceTypeLabel(row.resource_type) }}</template>
            </el-table-column>
            <el-table-column label="资源 ID" min-width="170">
              <template #default="{ row }"><span class="mono">{{ row.resource_id }}</span></template>
            </el-table-column>
            <el-table-column label="事件" min-width="210">
              <template #default="{ row }">
                <div>{{ eventTypeLabel(row.type) }}</div>
                <div class="mono type-raw">{{ row.type }}</div>
              </template>
            </el-table-column>
            <el-table-column label="时间" width="180">
              <template #default="{ row }">{{ formatTime(row.ts) }}</template>
            </el-table-column>
            <template #empty>
              <el-empty :image-size="80" description="没有匹配的事件" />
            </template>
          </el-table>

          <div class="pager">
            <span class="text-muted" style="font-size: 13px">游标分页：仅支持前后翻页</span>
            <div>
              <el-button size="small" :disabled="cursorStack.length === 0" @click="prevPage">上一页</el-button>
              <el-button size="small" :disabled="!nextCursor" @click="nextPage">下一页</el-button>
            </div>
          </div>
          <el-alert
            v-if="eventsQuery.error.value"
            :title="errorMessage(eventsQuery.error.value)"
            type="error"
            :closable="false"
            show-icon
            class="mt"
          />
        </el-tab-pane>

        <el-tab-pane label="Webhooks 订阅" name="webhooks">
          <div class="tab-toolbar">
            <el-button type="primary" :icon="Plus" @click="openCreate">新建订阅</el-button>
          </div>
          <el-table v-loading="hooksQuery.isFetching.value" :data="hookRows" size="small">
            <el-table-column label="回调地址" min-width="260">
              <template #default="{ row }"><span class="mono url">{{ row.url }}</span></template>
            </el-table-column>
            <el-table-column label="事件类型" min-width="200">
              <template #default="{ row }">
                <template v-if="row.types && row.types.length > 0">
                  <el-tag
                    v-for="t in row.types"
                    :key="t"
                    size="small"
                    effect="plain"
                    class="type-tag"
                    :title="t"
                  >{{ eventTypeLabel(t) }}</el-tag>
                </template>
                <span v-else class="text-muted">全部事件</span>
              </template>
            </el-table-column>
            <el-table-column label="资源过滤" min-width="120">
              <template #default="{ row }">
                <span v-if="row.resource_id" class="mono">{{ row.resource_id }}</span>
                <span v-else class="text-muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="投递水位" width="110">
              <template #default="{ row }"><span class="mono">{{ row.watermark ?? '—' }}</span></template>
            </el-table-column>
            <el-table-column label="连续失败" width="100">
              <template #default="{ row }">
                <el-tag v-if="(row.fail_count ?? 0) > 0" type="danger" size="small">{{ row.fail_count }}</el-tag>
                <span v-else class="text-muted">0</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="danger" plain @click.stop="removeHook(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty :image-size="80" description="还没有订阅">
                <div class="text-muted" style="font-size: 13px">
                  新建订阅后，引擎以 HMAC-SHA256 签名向你的回调地址投递事件。
                </div>
              </el-empty>
            </template>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="createVisible" title="新建 webhook 订阅" width="520px">
      <el-form label-position="top" @submit.prevent="submitCreate">
        <el-form-item label="回调地址" required>
          <el-input v-model="form.url" placeholder="https://ops.example.com/mammoth-hook" class="mono" />
        </el-form-item>
        <el-form-item label="事件类型（可选；留空投递全部）">
          <el-select
            v-model="form.types"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入事件类型"
            style="width: 100%"
          >
            <el-option-group v-for="g in EVENT_TYPE_GROUPS" :key="g.label" :label="g.label">
              <el-option v-for="t in g.types" :key="t.value" :label="t.label" :value="t.value">
                <span>{{ t.label }}</span>
                <span class="mono opt-raw">{{ t.value }}</span>
              </el-option>
            </el-option-group>
          </el-select>
          <div class="text-muted" style="font-size: 12px; margin-top: 4px">
            按资源类型分组；支持搜索，也可手动输入清单之外的新类型（投递按精确匹配）。
          </div>
        </el-form-item>
        <el-form-item label="资源 ID 过滤（可选，仅投递该资源的事件）">
          <el-input v-model="form.resource_id" placeholder="如 mch_xxxx（跟踪某台机器）或 job_x9k2（跟踪某个作业）" class="mono" />
          <div class="text-muted" style="font-size: 12px; margin-top: 4px">
            仅支持单个资源 ID 精确匹配；要跟踪多个资源请为每个资源各建一条订阅，留空则投递全部资源的事件。
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog :model-value="createdSecret !== null" title="签名密钥（仅此一次）" width="520px" :close-on-click-modal="false" @update:model-value="(v: boolean) => { if (!v) createdSecret = null }">
      <el-alert type="warning" :closable="false" show-icon title="HMAC-SHA256 签名密钥不会再次显示，请立即保存。" />
      <div class="secret mono">{{ createdSecret?.secret }}</div>
      <div class="text-muted" style="font-size: 12px">{{ createdSecret?.url }}</div>
      <template #footer>
        <el-button @click="copySecret">复制</el-button>
        <el-button type="primary" @click="createdSecret = null">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.payload {
  margin: 4px 8px;
  padding: 8px 10px;
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  font-size: 12px;
  max-height: 260px;
  overflow: auto;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}
.mt {
  margin-top: 10px;
}
.tab-toolbar {
  margin-bottom: 10px;
}
.url {
  font-size: 12px;
  word-break: break-all;
}
.type-tag {
  margin-right: 4px;
}
.type-raw {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
.opt-raw {
  float: right;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-left: 12px;
}
.secret {
  margin: 12px 0 8px;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 13px;
  word-break: break-all;
}
.mono :deep(input) {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
</style>
