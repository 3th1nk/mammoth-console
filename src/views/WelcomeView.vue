<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useConnectionStore } from '@/stores/connection'
import { errorMessage } from '@/api/problem'

const conn = useConnectionStore()
const router = useRouter()

const baseUrl = ref(conn.baseUrl)
const token = ref('')
const probing = ref(false)

async function connect() {
  if (!token.value.trim()) {
    ElMessage.warning('请填写 API Token（引擎地址留空即同源访问）')
    return
  }
  probing.value = true
  try {
    const caps = await conn.connect(baseUrl.value.trim(), token.value.trim())
    ElMessage.success(`已连接引擎 v${caps.version}`)
    router.push({ name: 'dashboard' })
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    probing.value = false
  }
}
</script>

<template>
  <div class="welcome">
    <el-card class="card" shadow="never">
      <div class="hero">
        <img src="/mammoth.svg" alt="mammoth" />
        <h1>Mammoth Console</h1>
        <p class="sub">裸金属装机引擎 · 官方控制台</p>
      </div>

      <el-form label-position="top" @submit.prevent="connect">
        <el-form-item label="引擎地址">
          <el-input v-model="baseUrl" placeholder="留空 = 与控制台同源（推荐）" class="mono" />
          <div class="hint">
            同源部署下留空即可（dev 由 vite 代理 /api，生产由 Caddy 反代）；跨源直填引擎地址会被浏览器 CORS 拦截。
          </div>
        </el-form-item>
        <el-form-item label="API Token">
          <el-input
            v-model="token"
            type="password"
            show-password
            placeholder="MAMMOTH_API_TOKEN"
          />
          <div class="hint">
            即引擎部署时设置的 MAMMOTH_API_TOKEN；token 即引擎管理员权限，请勿在不受信终端保存。
          </div>
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="probing" class="connect-btn">
          连接
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.welcome {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
}
.card {
  width: 460px;
  padding: 8px 12px 4px;
}
.hero {
  text-align: center;
  margin-bottom: 20px;
}
.hero img {
  width: 72px;
  height: 72px;
}
.hero h1 {
  font-size: 20px;
  margin: 10px 0 4px;
  color: #303133;
}
.sub {
  color: #909399;
  margin: 0;
  font-size: 13px;
}
.hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 4px;
}
.connect-btn {
  width: 100%;
  margin-top: 6px;
}
.mono :deep(input) {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
</style>
