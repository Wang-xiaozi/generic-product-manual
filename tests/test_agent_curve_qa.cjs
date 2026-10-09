const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.MANUAL_TEST_URL || "http://127.0.0.1:5173/product-manual";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage();
    await page.route("**/api/product-manual/agent/config", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ code: 0, msg: "ok", data: { configured: true, model: "mock" } }),
    }));
    await page.route("**/api/product-manual/agent/test", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ code: 0, msg: "ok", data: { ok: true, model: "mock" } }),
    }));
    const modelRequests = [];
    await page.route("**/api/product-manual/agent/chat", async (route) => {
      modelRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, msg: "ok",
          data: { content: '{"message":"增益随频率先升高后降低。","operations":[]}', model: "mock", elapsedMs: 1 } })
      });
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    async function ask(prompt) {
      await page.locator("[data-agent-input]").fill(prompt);
      await page.locator("[data-agent-send]").click();
      await page.waitForFunction(() => !document.querySelector("[data-agent-send]").disabled);
      return page.locator("[data-agent-messages] .agent-message--assistant").last().innerText();
    }

    assert.match(await ask("5GHz时增益是多少？"), /没有可读取的曲线数据/);
    assert.equal(modelRequests.length, 0);

    await page.evaluate(() => {
      const text = [
        "# GHZ S MA R 50",
        "4 0.1 0 10 0 0.01 0 0.1 0",
        "6 0.1 0 100 0 0.01 0 0.1 0"
      ].join("\n");
      const tool = window.ProductManualTemplateToolContext;
      tool.setCurveResources([{ name: "qa-test.s2p", sourcePath: "qa-test.s2p", text }]);
      tool.setCurveResourceSelected(0, true);
      tool.insertSelectedCurveSuite();
    });
    await page.locator(".curve-embed").first().waitFor();

    assert.match(await ask("4GHz时增益是多少？"), /20\.00 dB.*直接读取导入数据点/);
    assert.match(await ask("5GHz时增益是多少？"), /30\.00 dB.*线性插值/);
    assert.match(await ask("5000MHz时增益是多少？"), /30\.00 dB.*线性插值/);
    const vswr = await ask("5GHz时输入输出驻波是多少？");
    assert.match(vswr, /VSWR_in.*输入驻波为 1\.22/);
    assert.match(vswr, /VSWR_out.*输出驻波为 1\.22/);
    const combined = await ask("5GHz时增益和输入驻波分别是多少？");
    assert.match(combined, /Gain.*增益为 30\.00 dB/);
    assert.match(combined, /VSWR_in.*输入驻波为 1\.22/);
    assert.match(await ask("7GHz时增益是多少？"), /超出范围，不作外推/);
    assert.equal(modelRequests.length, 0);

    assert.match(await ask("这条增益曲线的趋势怎样？"), /增益随频率先升高后降低/);
    assert.equal(modelRequests.length, 1);
    const context = modelRequests[0].messages.at(-1).content;
    assert.match(context, /"minimum"/);
    assert.match(context, /"maximum"/);
    assert.ok(!context.includes("network"));

    await page.evaluate(() => {
      const original = document.querySelector(".curve-embed");
      for (let index = 1; index <= 4; index += 1) {
        const copy = original.cloneNode(true);
        copy.querySelector(".curve-name").textContent = `测试曲线${index}`;
        original.parentElement.appendChild(copy);
      }
    });
    assert.match(await ask("这些曲线的趋势怎样？"), /当前有 5 张匹配的曲线，请在问题中指定曲线标题/);
    assert.equal(modelRequests.length, 1);
    console.log("agent curve QA: OK");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
