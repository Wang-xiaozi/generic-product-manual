const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const baseUrl = process.env.MANUAL_TEST_URL || 'http://127.0.0.1:5173/product-manual'

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    const page = await browser.newPage()
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => Boolean(window.ProductManualTemplateToolContext))

    const templateLinks = page.locator('.template-actions .template-download')
    assert.equal(await templateLinks.count(), 1)
    assert.equal(await templateLinks.first().innerText(), '下载数据模板')
    assert.equal(await templateLinks.first().getAttribute('download'), '数据指标模板.xlsx')

    assert.equal(await page.getByText('替换生成全部曲线', { exact: true }).count(), 0)
    assert.equal(await page.getByText('追加生成全部曲线', { exact: true }).count(), 0)
    assert.equal(await page.getByText('兼容 Bridge 服务地址（可选）', { exact: true }).count(), 0)

    const touchstone = [
      '# GHZ S MA R 50',
      '4 0.1 0 10 0 0.01 0 0.1 0',
      '6 0.1 0 100 0 0.01 0 0.1 0',
    ].join('\n')

    await page.locator('[data-open-snp-paste]').click()
    const pasteModal = page.locator('[data-snp-paste-modal]')
    await pasteModal.locator('[data-snp-paste-text]').fill(touchstone)
    await pasteModal.locator('[data-import-pasted-snp]').click()
    await page.waitForFunction(() => document.querySelector('[data-snp-paste-modal]').classList.contains('is-hidden'))
    assert.equal(await page.locator('[data-curve-select-index]').count(), 1)
    assert.equal(await page.locator('[data-curve-select-index]').first().isChecked(), false)

    await page.evaluate((text) => {
      window.ProductManualTemplateToolContext.setCurveResources([
        { name: 'first.s2p', sourcePath: 'first.s2p', text },
        { name: 'second.s2p', sourcePath: 'second.s2p', text },
      ])
    }, touchstone)

    const checkboxes = page.locator('[data-curve-select-index]')
    assert.equal(await checkboxes.count(), 2)
    assert.equal(await checkboxes.nth(0).isChecked(), false)
    assert.equal(await checkboxes.nth(1).isChecked(), false)

    const deleteSelectedButton = page.locator('[data-delete-selected-curve-resources]')
    assert.equal(await deleteSelectedButton.innerText(), '删除已选择的数据')
    await deleteSelectedButton.click()
    assert.equal(await checkboxes.count(), 2)
    assert.match(await page.locator('[data-curve-status]').innerText(), /请先勾选要删除的 S 参数文件/)

    await checkboxes.nth(0).check()
    await deleteSelectedButton.click()
    assert.equal(await checkboxes.count(), 1)
    assert.equal(await page.locator('.curve-option strong').first().innerText(), 'second.s2p')
    assert.match(await page.locator('[data-curve-status]').innerText(), /已删除 1 个已选择的 S 参数文件，剩余 1 个/)

    await page.evaluate((text) => {
      window.ProductManualTemplateToolContext.setCurveResources([
        { name: 'first.s2p', sourcePath: 'first.s2p', text },
        { name: 'second.s2p', sourcePath: 'second.s2p', text },
      ])
    }, touchstone)

    await page.locator('[data-toggle-all-curves]').click()
    assert.equal(await checkboxes.nth(0).isChecked(), true)
    assert.equal(await checkboxes.nth(1).isChecked(), true)
    await page.locator('[data-toggle-all-curves]').click()
    assert.equal(await checkboxes.nth(0).isChecked(), false)
    assert.equal(await checkboxes.nth(1).isChecked(), false)

    await checkboxes.nth(0).check()
    await page.locator('[data-generate-selected-curves]').click()
    await page.locator('.curve-embed').first().waitFor()
    assert.match(await page.locator('[data-curve-status]').innerText(), /已使用 1 个 S 参数文件/)

    const secondTouchstone = [
      '# GHZ S MA R 50',
      '4 0.2 0 20 0 0.02 0 0.2 0',
      '6 0.2 0 200 0 0.02 0 0.2 0',
    ].join('\n')
    await page.evaluate(
      ({ first, second }) => {
        const tool = window.ProductManualTemplateToolContext
        tool.setCurveResources([{ name: 'sameNF.s2p', sourcePath: 'sameNF.s2p', text: first }])
        tool.setCurveResourceSelected(0, true)
        tool.insertSelectedCurveSuite()
        window.__secondImportAdded = tool.appendCurveResources([
          { name: 'sameNF.s2p', sourcePath: 'sameNF.s2p', text: second },
        ])
      },
      { first: touchstone, second: secondTouchstone },
    )
    assert.equal(await page.evaluate(() => window.__secondImportAdded), 1)
    assert.equal(await page.locator('[data-curve-select-index]').count(), 2)

    await page.locator('[data-toggle-all-curves]').click()
    assert.equal(await page.locator('[data-curve-select-index]:checked').count(), 2)
    await page.locator('[data-generate-selected-curves]').click()
    await page.waitForFunction(() => document.querySelectorAll('.curve-embed').length === 2)
    assert.match(await page.locator('[data-curve-status]').innerText(), /已使用 2 个 S 参数文件，生成 2 张曲线图/)

    const generatedGains = await page.locator('.curve-embed [data-curve-data]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const payload = JSON.parse(node.textContent)
        return payload.resources[0].network.rows[0].p.S21[0]
      }),
    )
    assert.deepEqual(generatedGains.sort((a, b) => a - b), [10, 20])

    await page.evaluate(
      ({ first, second }) => {
        const tool = window.ProductManualTemplateToolContext
        tool.setCurveResources([
          { name: 'first.s2p', sourcePath: 'first.s2p', text: first },
          { name: 'second.s2p', sourcePath: 'second.s2p', text: second },
        ])
      },
      { first: touchstone, second: secondTouchstone },
    )
    await page.locator('[data-curve-select-index]').nth(0).check()
    await page.locator('[data-curve-select-index]').nth(1).check()
    await page.locator('[data-generate-selected-curves]').click()
    await page.waitForFunction(() => document.querySelectorAll('.curve-embed').length === 2)
    assert.match(await page.locator('[data-curve-status]').innerText(), /已使用 2 个 S 参数文件，生成 2 张曲线图/)
    const generatedSCurves = await page.locator('.curve-embed [data-curve-data]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const payload = JSON.parse(node.textContent)
        return {
          templateId: payload.templateId,
          source: payload.resources[0].name,
          gain: payload.resources[0].network.rows[0].p.S21[0],
        }
      }),
    )
    assert.deepEqual(generatedSCurves, [
      { templateId: 'gain_vswr', source: 'first.s2p', gain: 10 },
      { templateId: 'gain_vswr', source: 'second.s2p', gain: 20 },
    ])
    assert.deepEqual(await page.locator('.curve-name').allInnerTexts(), [
      '增益和输入输出驻波 - first',
      '增益和输入输出驻波 - second',
    ])

    const mixedNames = [
      'firstS.s2p', 'secondS.s2p',
      'firstNF.s2p', 'secondNF.s2p',
      'firstP.s2p', 'secondP.s2p',
    ]
    await page.evaluate(
      ({ names, first, second }) => {
        window.ProductManualTemplateToolContext.setCurveResources(names.map((name, index) => ({
          name,
          sourcePath: name,
          text: index % 2 ? second : first,
        })))
      },
      { names: mixedNames, first: touchstone, second: secondTouchstone },
    )
    await page.locator('[data-toggle-all-curves]').click()
    await page.locator('[data-generate-selected-curves]').click()
    await page.waitForFunction(() => document.querySelectorAll('.curve-embed').length === 6)
    assert.match(await page.locator('[data-curve-status]').innerText(), /已使用 6 个 S 参数文件，生成 6 张曲线图/)
    assert.deepEqual(await page.locator('.curve-embed [data-curve-data]').evaluateAll((nodes) =>
      nodes.map((node) => JSON.parse(node.textContent).resources[0].name),
    ), mixedNames)

    console.log('toolbar optimization: OK')
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
