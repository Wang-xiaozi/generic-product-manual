const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const baseUrl = process.env.MANUAL_TEST_URL || 'http://127.0.0.1:5173/product-manual'

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    const page = await browser.newPage()
    let modelReachable = false
    let connectionChecks = 0
    await page.route('**/api/product-manual/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, msg: 'ok', data: { configured: true, model: 'test-model' } }),
      }),
    )
    await page.route('**/api/product-manual/agent/test', (route) => {
      connectionChecks += 1
      return route.fulfill({
        status: modelReachable ? 200 : 502,
        contentType: 'application/json',
        body: JSON.stringify(modelReachable
          ? { code: 0, msg: 'ok', data: { ok: true, model: 'test-model' } }
          : { code: 502, msg: '模型连接失败', data: null }),
      })
    })
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => Boolean(window.ProductManualAgentDispose))
    assert.equal(await page.locator('script[src*="/_thirdparty/"]').count(), 8)
    await page.waitForFunction(() => document.querySelector('[data-agent-status]')?.classList.contains('is-error'))
    assert.equal(connectionChecks, 1, '启动时应真正测试模型连接')
    assert.equal(await page.locator('#toggleTemplatePanelSide').innerText(), '参数')
    assert.equal(await page.locator('#templatePanel .tool-header').innerText(), '参数')
    assert.equal(await page.locator('#templatePanel [data-template-id]').count(), 0)
    assert.equal(await page.locator('#templatePanel .template-actions .btn').count(), 2)
    assert.equal(await page.locator('.curve-actions .btn').count(), 6)
    assert.ok(await page.locator('.curve-actions .btn').last().getAttribute('data-toggle-all-curves') !== null)
    assert.equal(await page.locator('.curve-resource-list').evaluate((node) => getComputedStyle(node).maxHeight), '265px')

    await page.evaluate(() =>
      document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/audit-empty'),
    )
    await page.waitForFunction(() => !document.getElementById('manual'))
    const afterLeave = await page.evaluate(() => ({
      hasApi: Boolean(window.ProductManualApi),
      hasContext: Boolean(window.ProductManualTemplateToolContext),
      overlayBound: Boolean(document.body.dataset.overlayEditorDelegated),
    }))
    assert.deepEqual(afterLeave, { hasApi: false, hasContext: false, overlayBound: false })
    assert.equal(await page.locator('script[src*="/_thirdparty/"]').count(), 0)

    modelReachable = true
    await page.evaluate(() =>
      document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/product-manual'),
    )
    await page.waitForFunction(() => Boolean(window.ProductManualAgentDispose))
    await page.waitForFunction(() => document.querySelector('[data-agent-status]')?.classList.contains('is-ready'))
    assert.equal(connectionChecks, 2)
    assert.equal(await page.locator('script[src*="/_thirdparty/"]').count(), 8)
    assert.equal(await page.locator('[data-agent-panel]').count(), 1)
    console.log('feature navigation: OK')
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
