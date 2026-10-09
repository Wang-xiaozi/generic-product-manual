const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const JSZip = require("../frontend_v2/node_modules/jszip");

const baseUrl =
  process.env.MANUAL_TEST_URL || "http://127.0.0.1:5173/product-manual";
const requestedOutput = process.env.MANUAL_WORD_OUTPUT;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const outputDir = requestedOutput
    ? path.dirname(path.resolve(requestedOutput))
    : fs.mkdtempSync(path.join(os.tmpdir(), "manual-word-export-"));
  if (requestedOutput) fs.mkdirSync(outputDir, { recursive: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() =>
      Boolean(window.ProductManualTemplateToolContext?.prepareForExport),
    );
    assert.equal(await page.locator('.manual-header img').count(), 0, '通用页眉不应带标志图片');
    assert.equal(await page.locator('.manual-header .institute').count(), 0, '通用页眉不应带单位栏');

    const marker = "WORD_EXPORT_EDITABLE_CONTENT_2026";
    await page.locator('[data-agent-id="product-intro"]').fill(marker);
    await page.evaluate(() => {
      function makePreview(kind) {
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 480;
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = "#1f2937";
        context.lineWidth = 5;
        context.strokeRect(20, 20, 760, 440);
        context.fillStyle = "#111827";
        context.font = "bold 36px Arial";
        context.textAlign = "center";
        context.fillText(
          kind === "curve" ? "Word Export Curve" : "RF IN  →  LNA  →  RF OUT",
          400,
          70,
        );
        if (kind === "curve") {
          context.strokeStyle = "#2563eb";
          context.lineWidth = 8;
          context.beginPath();
          context.moveTo(90, 370);
          context.bezierCurveTo(250, 110, 500, 410, 710, 150);
          context.stroke();
        } else {
          context.strokeStyle = "#dc2626";
          context.lineWidth = 6;
          context.strokeRect(270, 150, 260, 180);
        }
        return canvas.toDataURL("image/png");
      }

      const zone = document.querySelector(
        ".function-block-image[data-image-zone]",
      );
      window.ProductManualTemplateToolContext.replaceImageZoneImages(zone, [
        makePreview("diagram"),
      ]);
      document.querySelector("[data-curve-frame-list]").innerHTML = [
        '<div class="curve-embed">',
        '<div class="curve-media" data-curve-media>',
        `<img class="curve-frame" alt="Word 导出曲线一" src="${makePreview("curve")}">`,
        "</div>",
        "</div>",
        '<div class="curve-embed">',
        '<div class="curve-media" data-curve-media>',
        `<img class="curve-frame" alt="Word 导出曲线二" src="${makePreview("curve")}">`,
        "</div>",
        "</div>",
      ].join("");
    });
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#exportWord").click();
    const download = await downloadPromise;
    const target = requestedOutput
      ? path.resolve(requestedOutput)
      : path.join(outputDir, download.suggestedFilename());
    await download.saveAs(target);

    assert.match(download.suggestedFilename(), /_产品手册\.docx$/);
    const archive = await JSZip.loadAsync(fs.readFileSync(target));
    assert.ok(archive.file("[Content_Types].xml"));
    assert.ok(archive.file("word/document.xml"));
    assert.ok(archive.file("word/styles.xml"));
    assert.ok(
      Object.keys(archive.files).some((name) => name.startsWith("word/media/")),
    );

    const documentXml = await archive.file("word/document.xml").async("string");
    const settingsXml = await archive.file("word/settings.xml").async("string");
    for (const name of Object.keys(archive.files).filter((name) => /^word\/header\d+\.xml$/.test(name))) {
      const headerXml = await archive.file(name).async('string');
      assert.doesNotMatch(headerXml, /<w:drawing>/, '通用 Word 页眉不应带标志图片');
      assert.match(headerXml, /PRODUCT-001/, 'Word 页眉应使用通用产品型号');
    }
    assert.match(documentXml, new RegExp(marker));
    assert.match(documentXml, /性能特点/);
    assert.match(documentXml, /w:pgSz[^>]*w:w="11905"/);
    assert.match(documentXml, /w:pgSz[^>]*w:h="16837"/);
    assert.match(settingsXml, /evenAndOddHeaders/);
    assert.match(documentXml, /w:headerReference w:type="default"/);
    assert.match(documentXml, /w:headerReference w:type="even"/);
    assert.match(documentXml, /w:footerReference w:type="default"/);
    assert.match(documentXml, /w:footerReference w:type="even"/);
    const curveTable = documentXml.match(/典型曲线[\s\S]*?<w:tbl>([\s\S]*?)<\/w:tbl>/)?.[1];
    assert.ok(curveTable, "典型曲线应导出为表格");
    assert.equal((curveTable.match(/<w:gridCol /g) || []).length, 3, "曲线表格应包含两列和间距列");
    const firstCurveRow = curveTable.match(/<w:tr[ >][\s\S]*?<\/w:tr>/)?.[0];
    assert.equal((firstCurveRow?.match(/<w:drawing>/g) || []).length, 2, "两张曲线图应在同一行");
    assert.equal(await page.locator("#exportWord").isEnabled(), true);

    console.log("word export: OK");
  } finally {
    await browser.close();
    if (!requestedOutput) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
