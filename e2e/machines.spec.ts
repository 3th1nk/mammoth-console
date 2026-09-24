import { expect, test } from '@playwright/test'
import { connect } from './helpers'

// 随机后缀保证幂等:机器 bmc_address 与凭证 name 都是唯一约束,残留会让重跑吃 409
const SUF = Date.now().toString(36)
const BMC = `fake://e2e-node-${SUF}`
const CRED = `e2e-cred-${SUF}`

test.describe('机器生命周期', () => {
  test('注册 fake 机器 → 列表/详情/批量标签/删除', async ({ page }) => {
    await connect(page)

    // 注册(内联新建凭证,fake 协议)
    await page.goto('/machines')
    await page.getByRole('button', { name: '注册机器' }).click()
    const dlg = page.locator('.el-dialog').filter({ hasText: '注册' }).first()
    await dlg.getByPlaceholder(/203\.0\.113\.10/).fill(BMC)
    // el-radio-button 的真实 radio input 是隐藏的,点可视 label
    await dlg.locator('.el-radio-button').filter({ hasText: 'fake' }).click()
    await dlg.locator('.el-radio-button').filter({ hasText: '新建凭证' }).click()
    await dlg.getByPlaceholder(/bmc-rack01/).fill(CRED)
    await dlg.getByLabel('用户名').fill('admin')
    await dlg.getByLabel('密码').fill('hunter2')
    await dlg.getByRole('button', { name: /注册|认领/ }).click()
    // 注册成功跳详情(注册即自动盘查)
    await expect(page).toHaveURL(/machines\/mch_/, { timeout: 15_000 })

    // 详情:基础信息卡的 BMC 地址行(页标题在盘查完成后会切成序列号,不作锚)
    await expect(page.getByText(BMC).first()).toBeVisible({ timeout: 10_000 })

    // 列表:行出现
    await page.goto('/machines')
    const row = page.locator('.el-table__row').filter({ hasText: BMC })
    await expect(row).toBeVisible()

    // 批量标签(引擎 A5 端点:添加 + 全有或全无);checkbox 真实 input 隐藏,点外壳
    await row.locator('.el-checkbox').click()
    await page.getByRole('button', { name: /打标签/ }).click()
    const labelDlg = page.locator('.el-dialog').filter({ hasText: '批量打标签' })
    await labelDlg.getByPlaceholder('env=prod').fill('env=e2e')
    await labelDlg.getByPlaceholder('env=prod').press('Enter')
    await labelDlg.getByRole('button', { name: '应用到选中机器' }).click()
    await expect(page.locator('.el-message--success')).toContainText('更新标签')
    await expect(row).toContainText('env=e2e')

    // 命令面板按 ID 片段搜索跳转(全局搜索)
    await page.locator('.search-entry').click()
    await page.getByPlaceholder(/搜索机器/).fill('e2e-node')
    const hit = page.locator('.palette-dialog .row').filter({ hasText: BMC })
    await expect(hit).toBeVisible({ timeout: 10_000 })
    // 唯一机器结果即第一项(activeIdx=0);行 hover 重渲染会让 click 判 unstable,走键盘
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/machines\/mch_/, { timeout: 10_000 })

    // 删除收尾
    await page.goto('/machines')
    await row.getByRole('button', { name: '更多' }).click()
    await page.getByRole('menuitem', { name: '注销机器…' }).click()
    await page.getByRole('button', { name: '注销', exact: true }).click()
    await expect(row).toHaveCount(0, { timeout: 15_000 })
  })
})
