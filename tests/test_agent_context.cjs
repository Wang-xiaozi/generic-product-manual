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
    await page.route("**/api/product-manual/agent/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: 0,
          msg: "ok",
          data: { content: '{"message":"测试回复","operations":[]}', model: "mock", elapsedMs: 1 }
        })
      });
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    async function send(prompt) {
      await page.locator("[data-agent-input]").fill(prompt);
      const request = page.waitForRequest((item) => item.url().endsWith("/api/product-manual/agent/chat"));
      await page.locator("[data-agent-send]").click();
      const payload = (await request).postDataJSON();
      await page.waitForFunction(() => !document.querySelector("[data-agent-send]").disabled);
      return payload.messages;
    }

    const general = await send("你是谁");
    assert.equal(general.length, 2);
    assert.ok(general.reduce((size, item) => size + item.content.length, 0) < 500);
    assert.ok(!general.at(-1).content.includes("当前手册结构"));

    const edit = await send("在性能特点中新增输入三阶交调截点：+5 dBm");
    const context = edit.at(-1).content;
    assert.ok(context.includes("当前手册结构"));
    const snapshot = JSON.parse(context.split("：\n").at(-1));
    assert.ok(snapshot.fields.some((group) => group[1].some((field) => field[0] === "product-intro")));
    assert.ok(snapshot.sections.some((section) => section.id === "performance-features"));
    assert.ok(context.length < 5000);
    console.log("agent context: OK");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
