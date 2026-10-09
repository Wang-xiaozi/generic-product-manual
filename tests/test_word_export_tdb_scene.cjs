const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const JSZip = require("../frontend_v2/node_modules/jszip");

const baseUrl =
  process.env.MANUAL_TEST_URL || "http://127.0.0.1:5173/product-manual";
const requestedOutput = process.env.MANUAL_TDB_WORD_OUTPUT;

function makeScene(type, label, color, offset) {
  return {
    scene_type: type,
    model_id: "word-export-tdb-test",
    canvas: { width: 1200, height: 720 },
    elements: [
      {
        id: `${type}-frame`,
        kind: "rect",
        role: "chip_frame",
        x: 80 + offset,
        y: 90,
        width: 1000 - offset * 2,
        height: 540,
        fill: "none",
        stroke: color,
        stroke_width: 16,
      },
      {
        id: `${type}-label`,
        kind: "text",
        role: "diagram_label",
        x: 600,
        y: 170 + offset,
        text: label,
        text_anchor: "middle",
        font_size: 72,
      },
      {
        id: `${type}-line`,
        kind: "polyline",
        role: "diagram_line",
        x: 0,
        y: 0,
        points: [
          [220, 480 - offset],
          [520, 300 + offset],
          [930, 470 - offset],
        ],
        stroke: color,
        stroke_width: 18,
      },
      ...(type === "dimension" ? [
        {
          id: "left-dimension",
          kind: "dimension_label",
          role: "dimension_top",
          orientation: "left",
          x: 80,
          y: 300,
          text: "1050",
          font_size: 150,
          stroke_width: 15,
          tick_length: 80,
          text_gap: 25,
        },
        {
          id: "bottom-dimension",
          kind: "dimension_label",
          role: "dimension_right",
          orientation: "bottom",
          x: 930,
          y: 635,
          text: "2020",
          font_size: 150,
          stroke_width: 15,
          tick_length: 80,
          text_gap: 25,
        },
      ] : []),
    ],
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const outputDir = requestedOutput
    ? path.dirname(path.resolve(requestedOutput))
    : fs.mkdtempSync(path.join(os.tmpdir(), "manual-tdb-word-export-"));
  if (requestedOutput) fs.mkdirSync(outputDir, { recursive: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
    });
    await page.route(
      "**/api/product-manual/layout/generate-layout-assets",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            code: 0,
            msg: "ok",
            data: {
              model_id: "word-export-tdb-test",
              function_block_scene: makeScene(
                "function_block",
                "TDB FUNCTION BLOCK",
                "#b91c1c",
                0,
              ),
              dimension_scene: makeScene(
                "dimension",
                "TDB DIMENSION",
                "#1d4ed8",
                35,
              ),
              assembly_scene: makeScene(
                "assembly",
                "TDB ASSEMBLY",
                "#15803d",
                70,
              ),
              pad_table_csv_text:
                "压点编号,功能符号,功能描述,位置（μm）,尺寸\n1,RF IN,输入端,100 200,80 80",
            },
          }),
        }),
    );
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() =>
      Boolean(window.ProductManualTemplateToolContext?.prepareForExport),
    );

    await page.locator("[data-tdb-file-input]").setInputFiles({
      name: "word-export-test.tdb",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("mock tdb payload"),
    });
    await page.locator("[data-generate-layout-assets]").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-image-zone] svg.scene-svg").length ===
        3,
    );

    assert.equal(
      await page.locator('[data-image-zone] .scene-item .image-resize-handle').count(),
      9,
      '三个版图矢量图都应提供宽度、高度和等比例缩放控制点',
    );
    const functionFrame = page.locator('.function-block-image .scene-item').first();
    const beforeResize = await functionFrame.boundingBox();
    const widthHandle = await functionFrame.locator('.image-resize-handle--width').boundingBox();
    assert.ok(beforeResize && widthHandle);
    await page.mouse.move(widthHandle.x + widthHandle.width / 2, widthHandle.y + widthHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(widthHandle.x - 25, widthHandle.y + widthHandle.height / 2, { steps: 6 });
    await page.mouse.up();
    const resizedWidth = await functionFrame.evaluate((item) => item.getBoundingClientRect().width);
    assert.ok(resizedWidth < beforeResize.width - 20, '拖动宽度手柄应缩小矢量图');
    await page.evaluate(() => {
      window.ProductManualTemplateTools.bindOverlayImageEditor(
        window.ProductManualTemplateToolContext,
      );
    });
    const rerenderedWidth = await page.locator('.function-block-image .scene-item').first()
      .evaluate((item) => item.getBoundingClientRect().width);
    assert.ok(Math.abs(rerenderedWidth - resizedWidth) < 2, '编辑矢量元素后应保留图框尺寸');

    const dimensionFrame = await page.locator('.dimension-images .scene-item').first().evaluate((item) => {
      const svg = item.querySelector('svg.scene-svg');
      const frame = item.getBoundingClientRect();
      const image = svg.getBoundingClientRect();
      const zone = item.closest('.dimension-images').getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const content = svg.getBBox();
      return { frameWidth: frame.width, frameHeight: frame.height, imageWidth: image.width,
        imageHeight: image.height, zoneWidth: zone.width, viewWidth: viewBox.width,
        viewHeight: viewBox.height, viewLeft: viewBox.x, contentLeft: content.x,
        contentBottom: content.y + content.height, viewBottom: viewBox.y + viewBox.height };
    });
    assert.ok(dimensionFrame.frameWidth <= dimensionFrame.zoneWidth + 1,
      '生成的尺寸图框应适应尺寸图区宽度');
    assert.ok(dimensionFrame.viewBottom > 720 && dimensionFrame.viewBottom > dimensionFrame.contentBottom,
      '尺寸数字超出原始画布时视野应自动扩展并留出边距');
    assert.ok(dimensionFrame.viewLeft < 0 && dimensionFrame.viewLeft < dimensionFrame.contentLeft,
      '左侧尺寸数字超出原始画布时视野应自动扩展并留出边距');
    assert.ok(Math.abs(dimensionFrame.imageWidth / dimensionFrame.imageHeight -
      dimensionFrame.viewWidth / dimensionFrame.viewHeight) < 0.02,
      '生成的尺寸图应按完整视野的比例显示');
    assert.ok(Math.abs(dimensionFrame.frameHeight - dimensionFrame.imageHeight) < 2,
      '尺寸图框高度应随图像高度变化');

    const downloadPromise = page.waitForEvent("download");
    await page.locator("#exportWord").click();
    const download = await downloadPromise;
    const target = requestedOutput
      ? path.resolve(requestedOutput)
      : path.join(outputDir, download.suggestedFilename());
    await download.saveAs(target);

    const archive = await JSZip.loadAsync(fs.readFileSync(target));
    const documentXml = await archive.file("word/document.xml").async("string");
    const drawings = documentXml.match(/<w:drawing>/g) || [];
    const pngMedia = Object.keys(archive.files).filter(
      (name) => name.startsWith("word/media/") && name.endsWith(".png"),
    );
    assert.ok(drawings.length >= 3, "三个 TDB SVG 场景都应写入 Word 正文");
    assert.ok(
      pngMedia.length >= 3,
      "三个 TDB SVG 场景都应转换为 PNG 嵌入 Word",
    );
    assert.equal(await page.locator("#exportWord").isEnabled(), true);

    console.log("word TDB scene export: OK");
  } finally {
    await browser.close();
    if (!requestedOutput)
      fs.rmSync(outputDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
