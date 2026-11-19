<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff, LoaderCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useConnectionStore } from '@/stores/connection'
import { errorMessage } from '@/api/problem'
import { formatVersion } from '@/utils/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const conn = useConnectionStore()
const router = useRouter()

const baseUrl = ref(conn.baseUrl)
const token = ref('')
const showToken = ref(false)
const probing = ref(false)

async function connect() {
  if (!token.value.trim()) {
    toast.warning('请填写 API Token（引擎地址留空即同源访问）')
    return
  }
  probing.value = true
  try {
    const caps = await conn.connect(baseUrl.value.trim(), token.value.trim())
    toast.success(`已连接引擎 ${formatVersion(caps.version)}`)
    router.push({ name: 'dashboard' })
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    probing.value = false
  }
}
</script>

<template>
  <div class="flex min-h-svh items-center justify-center bg-muted/40 p-4">
    <Card class="w-full max-w-[460px]">
      <CardContent class="flex flex-col gap-5">
        <div class="flex flex-col items-center gap-2 pt-2 text-center">
          <img src="/mammoth.svg" alt="mammoth" class="size-16" />
          <h1 class="text-xl font-semibold tracking-tight">Mammoth Console</h1>
          <p class="text-sm text-muted-foreground">裸金属装机引擎 · 官方控制台</p>
        </div>

        <form class="flex flex-col gap-4" @submit.prevent="connect">
          <div class="grid gap-1.5">
            <Label for="base-url">引擎地址</Label>
            <Input
              id="base-url"
              v-model="baseUrl"
              placeholder="留空 = 与控制台同源（推荐）"
              class="font-mono"
            />
            <p class="text-xs leading-relaxed text-muted-foreground">
              同源部署下留空即可（dev 由 vite 代理 /api，生产由 Caddy
              反代）；跨源直填引擎地址会被浏览器 CORS 拦截。
            </p>
          </div>
          <div class="grid gap-1.5">
            <Label for="token">API Token</Label>
            <div class="relative">
              <Input
                id="token"
                v-model="token"
                :type="showToken ? 'text' : 'password'"
                placeholder="MAMMOTH_API_TOKEN"
                class="pr-10"
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                @click="showToken = !showToken"
              >
                <Eye v-if="!showToken" class="size-4" />
                <EyeOff v-else class="size-4" />
              </button>
            </div>
            <p class="text-xs leading-relaxed text-muted-foreground">
              即引擎部署时设置的 MAMMOTH_API_TOKEN；token
              即引擎管理员权限，请勿在不受信终端保存。
            </p>
          </div>
          <Button type="submit" class="mt-1 w-full" :disabled="probing">
            <LoaderCircle v-if="probing" class="size-4 animate-spin" />
            连接
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
