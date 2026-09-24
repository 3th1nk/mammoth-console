import { expect, test } from '@playwright/test'
import { connect, TOKEN } from './helpers'

test.describe('连接', () => {
  test('错误 token 被拒绝并提示', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/welcome/)
    await page.getByPlaceholder('MAMMOTH_API_TOKEN').fill('wrong-token')
    await page.getByRole('button', { name: '连接' }).click()
    // 引擎返回 401 → ConsoleApiError 文案,停留欢迎页
    await expect(page.locator('.el-message')).toContainText(/401|token|失效/i, { timeout: 10_000 })
    await expect(page).toHaveURL(/welcome/)
  })

  test('正确 token 进入控制台,刷新后保持连接(重水合)', async ({ page }) => {
    await connect(page)
    await page.reload()
    // 刷新走静默重水合,不该被踢回欢迎页
    await expect(page).not.toHaveURL(/welcome/, { timeout: 15_000 })
    await expect(page.locator('.engine-version')).toContainText('引擎 v')
  })

  test('断开连接回到欢迎页', async ({ page }) => {
    await connect(page)
    await page.locator('.operator').click()
    await page.getByRole('menuitem', { name: '断开连接' }).click()
    await expect(page).toHaveURL(/welcome/)
    // localStorage 连接已清:直接访问受保护路由仍会回欢迎页
    await page.goto('/machines')
    await expect(page).toHaveURL(/welcome/)
    void TOKEN
  })
})
