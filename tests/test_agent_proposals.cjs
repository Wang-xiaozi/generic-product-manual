const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.MANUAL_TEST_URL || "http://127.0.0.1:5173/product-manual";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.route("**/api/product-manual/agent/config", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ code: 0, msg: "ok", data: { configured: true, model: "mock" } }),
    }));
    await page.route("**/api/product-manual/agent/test", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ code: 0, msg: "ok", data: { ok: true, model: "mock" } }),
    }));
    await page.route("**/api/product-manual/agent/chat", async (route) => {
      const prompt = route.request().postDataJSON().messages.at(-1).content;
      const operation = prompt.includes("芯片名称")
        ? { op: "manual.set_chip_name", target: "manual", args: { name: "GaAs MMIC" }, reason: "修改芯片名称" }
        : { op: "feature.remove", target: prompt.includes("不存在") ? "feature:不存在" : "feature:增益",
            args: {}, reason: "删除性能特点" };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, msg: "ok",
          data: { content: JSON.stringify(operation), model: "mock", elapsedMs: 1 } })
      });
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.ProductManualAgentDispose), null, { timeout: 15000 });

    async function send(prompt) {
      await page.locator("[data-agent-input]").fill(prompt);
      await page.locator("[data-agent-send]").click();
      await page.waitForFunction(() => !document.querySelector("[data-agent-send]").disabled, null, { timeout: 15000 });
      return page.locator("[data-agent-messages] .agent-message--assistant").last().innerText();
    }

    const removeAnswer = await send("在性能特点中删除增益的类别");
    assert.match(removeAnswer, /1 项修改建议/);
    assert.equal(await page.locator("[data-agent-change-count]").innerText(), "1 项操作");
    assert.ok(await page.locator("[data-agent-apply]").isVisible());

    const chipAnswer = await send("：请把产品手册中的芯片名称替换成GaAs MMIC");
    assert.match(chipAnswer, /已定位手册中的目标位置/);
    assert.equal(await page.locator("[data-agent-change-count]").innerText(), "1 项操作");
    assert.ok(await page.locator("[data-agent-apply]").isVisible());

    const invalidAnswer = await send("在性能特点中删除不存在指标");
    assert.match(invalidAnswer, /未能对应到当前手册/);
    assert.ok(!(await page.locator("[data-agent-proposal]").isVisible()));
    console.log("agent proposals: OK");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
