const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.MANUAL_TEST_URL || "http://127.0.0.1:5173/product-manual";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.ProductManualTemplateToolContext));

    await page.evaluate(() => {
      const manual = document.getElementById("manual");
      const pages = Array.from(manual.querySelectorAll(".page"));
      const firstPage = pages[0];
      const firstContent = firstPage.querySelector(":scope > .page-content");
      const curveSection = manual.querySelector("[data-curve-section]");
      const curveList = curveSection.querySelector("[data-curve-frame-list]");

      pages.forEach((manualPage) => {
        const content = manualPage.querySelector(":scope > .page-content");
        if (content && !content.classList.contains("page-content-empty")) content.innerHTML = "";
      });
      pages.slice(1).forEach((manualPage) => manualPage.remove());
      firstContent.classList.remove("page-content-empty");

      const filler = document.createElement("section");
      filler.className = "section";
      filler.style.height = "155mm";
      filler.dataset.testPaginationFiller = "true";
      firstContent.appendChild(filler);
      firstContent.appendChild(curveSection);

      curveList.innerHTML = "";
      for (let index = 1; index <= 6; index += 1) {
        const curve = document.createElement("div");
        curve.className = "curve-embed";
        curve.dataset.testCurveIndex = String(index);
        curve.innerHTML = '<div class="curve-media" style="height: 50mm"></div>';
        curveList.appendChild(curve);
      }
      curveSection.querySelector("[data-curve-target]").classList.add("has-curves");
      window.ProductManualTemplateToolContext.schedulePagination(0, { afterPaint: true });
    });

    await page.waitForFunction(() => document.querySelectorAll("[data-curve-section]").length > 1);

    const result = await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll("[data-curve-section]"));
      const titledSection = sections.find((section) => section.querySelector(":scope > .section-title"));
      const pageIndex = Array.from(document.querySelectorAll("#manual > .page")).indexOf(titledSection.closest(".page"));
      return {
        pageIndex,
        title: titledSection.querySelector(":scope > .section-title").textContent.trim(),
        firstPageCurves: Array.from(titledSection.querySelectorAll(".curve-embed"), (curve) => curve.dataset.testCurveIndex),
        continuationTitles: sections
          .filter((section) => section !== titledSection)
          .map((section) => Boolean(section.querySelector(":scope > .section-title"))),
        allCurves: Array.from(document.querySelectorAll(".curve-embed"), (curve) => curve.dataset.testCurveIndex),
      };
    });

    assert.equal(result.pageIndex, 0, "典型曲线标题应保留在原页");
    assert.equal(result.title, "典型曲线");
    assert.ok(result.firstPageCurves.length > 0, "原页已有曲线不应全部移走");
    assert.ok(result.firstPageCurves.length < 6, "溢出的曲线应移到续页");
    assert.deepEqual(result.firstPageCurves.slice(0, 2), ["1", "2"]);
    assert.ok(result.continuationTitles.every((hasTitle) => !hasTitle), "续页不应重复典型曲线标题");
    assert.deepEqual(result.allCurves, ["1", "2", "3", "4", "5", "6"]);
    console.log("curve pagination: OK");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
