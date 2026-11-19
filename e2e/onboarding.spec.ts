import { expect, test } from '@playwright/test'
import { connect } from './helpers'

test.describe('开箱向导', () => {
  // e2e 引擎是全新库:无 install 作业 → 向导显示;引擎默认 PXE off → 警示可见
  test('五步向导与 PXE 未启用警示可见,跳过后消失', async ({ page }) => {
    await connect(page)
    await page.goto('/')

    const ob = page.locator('.onboarding')
    await expect(ob).toBeVisible()
    await expect(ob).toContainText('五步到第一台装好的机器')
    await expect(ob).toContainText('新建 BMC 凭证')
    await expect(ob).toContainText('跑第一次装机')

    // 引擎 8081 未开 PXE:零注册警示必须醒目出现
    const warn = ob.locator('[data-slot=alert]')
    await expect(warn).toBeVisible()
    await expect(warn).toContainText('未启用 PXE')
    await expect(warn).toContainText('MAMMOTH_PXE_ENABLED')

    // 跳过后不再出现(含刷新)
    await ob.getByRole('button', { name: '跳过引导' }).click()
    await expect(ob).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.onboarding')).toHaveCount(0)
  })
})

test.describe('Webhook 订阅', () => {
  test('类型分组勾选 + 创建(secret 一次性)+ 删除', async ({ page }) => {
    await connect(page)
    await page.goto('/events')
    await page.getByRole('tab', { name: 'Webhooks 订阅' }).click()

    // 先清历史残骸(旧轮次失败遗留的 e2e-hook-*),避免行匹配歧义
    while (await page.locator('[data-slot=table-row]').filter({ hasText: 'e2e-hook-' }).count() > 0) {
      await page.locator('[data-slot=table-row]').filter({ hasText: 'e2e-hook-' }).first().getByRole('button', { name: '删除' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
      await page.waitForTimeout(500)
    }

    // URL 带每轮唯一后缀:与机器同款幂等策略,残留不再让匹配歧义
    const SUF = Date.now().toString(36)
    const URL_ = `http://127.0.0.1:9999/e2e-hook-${SUF}`
    await page.getByRole('button', { name: '新建订阅' }).click()

    const dlg = page.locator('[data-slot=dialog-content]').filter({ hasText: '新建 webhook 订阅' })
    await dlg.getByPlaceholder(/ops\.example\.com/).fill(URL_)

    // 类型按资源分组 checkbox:勾选「机器注册」
    await dlg.locator('label').filter({ hasText: '机器注册' }).click()
    await expect(dlg.getByText('盘查完成')).toBeVisible()

    await dlg.getByRole('button', { name: '创建' }).click()
    // secret 仅此一次
    await expect(page.getByText('签名密钥（仅此一次）')).toBeVisible()
    await page.getByRole('button', { name: '我已保存' }).click()

    // 列表行:中文 tag 展示
    const row = page.locator('[data-slot=table-row]').filter({ hasText: `e2e-hook-${SUF}` })
    await expect(row).toContainText('机器注册')

    // 清理:确认弹窗内点「删除」
    await row.getByRole('button', { name: '删除' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect(row).toHaveCount(0)
  })
})
