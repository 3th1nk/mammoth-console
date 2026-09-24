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
    const warn = ob.locator('.el-alert')
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
  test('类型下拉中文化 + 创建(secret 一次性)+ 删除', async ({ page }) => {
    await connect(page)
    await page.goto('/events')
    await page.getByRole('tab', { name: 'Webhooks 订阅' }).click()
    await page.getByRole('button', { name: '新建订阅' }).click()

    const dlg = page.locator('.el-dialog').filter({ hasText: '新建 webhook 订阅' })
    await dlg.getByPlaceholder(/ops\.example\.com/).fill('http://127.0.0.1:9999/e2e-hook')

    // 类型下拉:按资源分组、中文选项、英文原文在列(multiple 下拉选完不自动收起)
    await dlg.locator('.el-select').click()
    await page.getByRole('option', { name: /机器注册/ }).click()
    await expect(page.getByRole('option', { name: /盘查完成/ })).toBeVisible()
    await page.keyboard.press('Escape')

    await dlg.getByRole('button', { name: '创建' }).click()
    // secret 仅此一次
    await expect(page.getByText('签名密钥（仅此一次）')).toBeVisible()
    await page.getByRole('button', { name: '我已保存' }).click()

    // 列表行:中文 tag 展示
    const row = page.locator('.el-table__row').filter({ hasText: 'e2e-hook' })
    await expect(row).toContainText('机器注册')

    // 清理
    await row.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '删除' }).last().click()
    await expect(row).toHaveCount(0)
  })
})
