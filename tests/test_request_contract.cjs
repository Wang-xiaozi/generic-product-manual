const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const baseUrl = process.env.MANUAL_TEST_URL || 'http://127.0.0.1:5173/product-manual'

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    const page = await browser.newPage()
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => Boolean(window.ProductManualApi))

    await page.route('**/api/product-manual/layout/generate-layout-assets', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ unexpectedBareResponse: true }),
      }),
    )
    const standardError = await page.evaluate(async () => {
      const formData = new FormData()
      formData.append('tdb_file', new Blob(['test']), 'layout.tdb')
      try {
        await window.ProductManualApi.generateLayoutAssets(formData)
        return ''
      } catch (error) {
        return error.message
      }
    })
    assert.match(standardError, /缺少统一信封/)
    console.log('request contract: OK')
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
