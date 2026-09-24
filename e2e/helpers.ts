import { expect, type Page } from '@playwright/test'

export const TOKEN = 'e2e-console-token'

/**
 * 从欢迎页连接引擎(地址留空走 vite 同源代理→8081 引擎)。
 * 已连接时 page.goto('/') 会被路由守卫送进 dashboard,直接返回。
 */
export async function connect(page: Page) {
  await page.goto('/')
  // 路由守卫的重定向是异步的:page.url() 在完成前仍是 '/',不能拿它判分支。
  // 等待 welcome 的 token 输入框出现(未连接)或超时(已连接被送进 dashboard)。
  const tokenBox = page.getByPlaceholder('MAMMOTH_API_TOKEN')
  try {
    await tokenBox.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    return // already connected
  }
  await tokenBox.fill(TOKEN)
  await page.getByRole('button', { name: '连接' }).click()
  await expect(page).not.toHaveURL(/welcome/, { timeout: 15_000 })
  await expect(page.locator('.engine-version')).toContainText('引擎 v')
}
