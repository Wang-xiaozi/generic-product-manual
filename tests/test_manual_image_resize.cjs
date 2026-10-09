const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const baseUrl = process.env.MANUAL_TEST_URL || 'http://127.0.0.1:5173/product-manual'
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => Boolean(window.ProductManualTemplateToolContext))

    const zoneSelectors = [
      '.function-block-image[data-image-zone]',
      '.dimension-images[data-image-zone]',
      '.assembly-image[data-image-zone]',
    ]
    for (const selector of zoneSelectors) {
      const targetZone = page.locator(selector).first()
      await page.evaluate((zoneSelector) => document.querySelector(zoneSelector).click(), selector)
      await page.locator('#imageInput').setInputFiles({
        name: 'manual-image.png',
        mimeType: 'image/png',
        buffer: onePixelPng,
      })
      await page.waitForFunction(
        (zoneSelector) => {
          const image = document.querySelector(`${zoneSelector} .image-item[data-manual-image="true"]`)
          return Boolean(image && image.dataset.imageSizeInitialized === 'true')
        },
        selector,
      )
      assert.equal(
        await targetZone.locator('.image-item[data-manual-image="true"] .image-resize-handle').count(),
        3,
        `${selector} 的手动导入图片应显示宽度、高度和等比例三个缩放控制点`,
      )
    }

    const zone = page.locator('.function-block-image[data-image-zone]').first()
    const item = zone.locator('.image-item[data-manual-image="true"]')
    const widthHandle = item.locator('.image-resize-handle--width')
    const heightHandle = item.locator('.image-resize-handle--height')
    const proportionalHandle = item.locator('.image-resize-handle--proportional')

    const beforeItem = await item.boundingBox()
    const beforeList = await zone.locator('.image-list').boundingBox()
    const widthHandleBox = await widthHandle.boundingBox()
    assert.ok(beforeItem && beforeList && widthHandleBox)
    assert.equal(await item.locator('img').evaluate((img) => getComputedStyle(img).objectFit), 'fill')
    assert.ok(Math.abs(beforeItem.width / beforeItem.height - 1) < 0.02, '图片初始显示应保持原始比例')

    await page.mouse.move(
      widthHandleBox.x + widthHandleBox.width / 2,
      widthHandleBox.y + widthHandleBox.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(widthHandleBox.x - 34, widthHandleBox.y + widthHandleBox.height / 2, {
      steps: 8,
    })
    await page.mouse.up()
    await page.waitForTimeout(250)

    const afterWidth = await item.boundingBox()
    assert.ok(afterWidth)
    assert.ok(afterWidth.width < beforeItem.width - 40, '宽度控制点应只缩小图片宽度')
    assert.ok(Math.abs(afterWidth.height - beforeItem.height) < 2, '调整宽度时图片高度应保持不变')
    assert.ok(
      Math.abs(afterWidth.width / afterWidth.height - beforeItem.width / beforeItem.height) > 0.2,
      '单独调整宽度时应允许打破图片自身比例',
    )

    const heightHandleBox = await heightHandle.boundingBox()
    assert.ok(heightHandleBox)
    await page.mouse.move(
      heightHandleBox.x + heightHandleBox.width / 2,
      heightHandleBox.y + heightHandleBox.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(heightHandleBox.x + heightHandleBox.width / 2, heightHandleBox.y + 32, {
      steps: 8,
    })
    await page.mouse.up()
    await page.waitForTimeout(250)

    const afterHeight = await item.boundingBox()
    assert.ok(afterHeight)
    assert.ok(afterHeight.height > afterWidth.height + 15, '高度控制点应只增加图片高度')
    assert.ok(Math.abs(afterHeight.width - afterWidth.width) < 2, '调整高度时图片宽度应保持不变')

    const proportionalHandleBox = await proportionalHandle.boundingBox()
    assert.ok(proportionalHandleBox)
    await page.mouse.move(
      proportionalHandleBox.x + proportionalHandleBox.width / 2,
      proportionalHandleBox.y + proportionalHandleBox.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(proportionalHandleBox.x + 30, proportionalHandleBox.y + 28, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(250)

    const afterProportional = await item.boundingBox()
    const afterList = await zone.locator('.image-list').boundingBox()
    assert.ok(afterProportional && afterList)
    assert.ok(afterProportional.width > afterHeight.width + 15, '等比例控制点应改变图片宽度')
    assert.ok(afterProportional.height > afterHeight.height + 5, '等比例控制点应同时改变图片高度')
    assert.ok(
      Math.abs(
        afterProportional.width / afterProportional.height - afterHeight.width / afterHeight.height,
      ) < 0.02,
      '等比例控制点应保持拖动前的宽高比例',
    )
    assert.ok(
      Math.abs(
        afterProportional.x + afterProportional.width / 2 - (afterList.x + afterList.width / 2),
      ) < 2,
      '调整后的图片应保持水平居中',
    )
    assert.match(await item.getAttribute('style'), /width:\s*\d+px/)
    assert.match(await item.getAttribute('style'), /height:\s*\d+px/)

    const dimensionZone = page.locator('.dimension-images[data-image-zone]').first()
    const dimensionItem = dimensionZone.locator('.image-item[data-manual-image="true"]')
    const dimensionWidthHandle = dimensionItem.locator('.image-resize-handle--width')
    await dimensionWidthHandle.scrollIntoViewIfNeeded()
    const dimensionListBox = await dimensionZone.locator('.image-list').boundingBox()
    const dimensionHandleBox = await dimensionWidthHandle.boundingBox()
    const dimensionAvailableWidth = await dimensionZone.locator('.image-list').evaluate((list) => {
      const style = getComputedStyle(list)
      return list.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    })
    assert.ok(dimensionListBox && dimensionHandleBox)
    await page.mouse.move(
      dimensionHandleBox.x + dimensionHandleBox.width / 2,
      dimensionHandleBox.y + dimensionHandleBox.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      dimensionListBox.x + dimensionListBox.width + 100,
      dimensionHandleBox.y + dimensionHandleBox.height / 2,
      { steps: 8 },
    )
    await page.mouse.up()
    await page.waitForTimeout(250)

    const expandedDimensionItem = await dimensionItem.boundingBox()
    assert.ok(expandedDimensionItem)
    assert.ok(
      Math.abs(expandedDimensionItem.width - dimensionAvailableWidth) < 3,
      `单张外形尺寸图应能横向拉满整个预留边框（实际 ${expandedDimensionItem.width}，可用 ${dimensionAvailableWidth}）`,
    )

    const secondImageChooserPromise = page.waitForEvent('filechooser')
    await dimensionItem.locator('img').click()
    const secondImageChooser = await secondImageChooserPromise
    await secondImageChooser.setFiles({
      name: 'manual-image-second.png',
      mimeType: 'image/png',
      buffer: onePixelPng,
    })
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '.dimension-images[data-image-zone] .image-item[data-manual-image="true"]',
        ).length === 2,
    )
    assert.equal(
      await dimensionZone.locator('.image-item[data-manual-image="true"]').count(),
      2,
      '外形尺寸区已有图片后，再次点击现有图片应可继续追加导入',
    )

    await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 800
      canvas.height = 480
      const zoneNode = document.querySelector('.dimension-images[data-image-zone]')
      window.ProductManualTemplateToolContext.replaceImageZoneImages(zoneNode, [canvas.toDataURL('image/png')])
    })
    await page.waitForFunction(() => {
      const image = document.querySelector('.dimension-images .image-item:not([data-manual-image]) img')
      return image?.complete && image.naturalWidth === 800
    })
    const generatedDimension = await dimensionZone.locator('.image-item:not([data-manual-image])').evaluate((node) => {
      const frame = node.getBoundingClientRect()
      const zone = node.closest('.dimension-images').getBoundingClientRect()
      return { width: frame.width, height: frame.height, availableWidth: zone.width }
    })
    assert.ok(generatedDimension.width <= generatedDimension.availableWidth + 1,
      '生成导入的尺寸图框应适应尺寸图区宽度')
    assert.ok(Math.abs(generatedDimension.width / generatedDimension.height - 800 / 480) < 0.02,
      '生成导入的尺寸图框应保留原图比例')

    const assemblyZone = page.locator('.assembly-image[data-image-zone]').first()
    await page.evaluate((png) => {
      const zoneNode = document.querySelector('.assembly-image[data-image-zone]')
      window.ProductManualTemplateToolContext.replaceImageZoneImages(zoneNode, [`data:image/png;base64,${png}`])
    }, onePixelPng.toString('base64'))
    assert.equal(
      await assemblyZone.locator('.image-resize-handle').count(),
      0,
      '版图生成入口替换的图片不应显示手动缩放控制点',
    )

    console.log('manual image resize: OK')
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
