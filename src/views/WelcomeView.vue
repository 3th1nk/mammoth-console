<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff, LoaderCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connection'
import { errorMessage } from '@/api/problem'
import { formatVersion } from '@/utils/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const { t } = useI18n()
const conn = useConnectionStore()
const router = useRouter()

const baseUrl = ref(conn.baseUrl)
const token = ref('')
const showToken = ref(false)
const probing = ref(false)

async function connect() {
  if (!token.value.trim()) {
    toast.warning(t('welcome.tokenRequired'))
    return
  }
  probing.value = true
  try {
    const caps = await conn.connect(baseUrl.value.trim(), token.value.trim())
    toast.success(t('welcome.connected', { version: formatVersion(caps.version) }))
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
          <h1 class="text-xl font-semibold tracking-tight">{{ t('welcome.title') }}</h1>
          <p class="text-sm text-muted-foreground">{{ t('welcome.subtitle') }}</p>
        </div>

        <form class="flex flex-col gap-4" @submit.prevent="connect">
          <div class="grid gap-1.5">
            <Label for="base-url">{{ t('welcome.baseUrl') }}</Label>
            <Input
              id="base-url"
              v-model="baseUrl"
              :placeholder="t('welcome.baseUrlPlaceholder')"
              class="font-mono"
            />
            <p class="text-xs leading-relaxed text-muted-foreground">{{ t('welcome.baseUrlHint') }}</p>
          </div>
          <div class="grid gap-1.5">
            <Label for="token">{{ t('welcome.token') }}</Label>
            <div class="relative">
              <Input
                id="token"
                v-model="token"
                :type="showToken ? 'text' : 'password'"
                :placeholder="t('welcome.tokenPlaceholder')"
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
            <p class="text-xs leading-relaxed text-muted-foreground">{{ t('welcome.tokenHint') }}</p>
          </div>
          <Button type="submit" class="mt-1 w-full" :disabled="probing">
            <LoaderCircle v-if="probing" class="size-4 animate-spin" />
            {{ t('welcome.connect') }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
