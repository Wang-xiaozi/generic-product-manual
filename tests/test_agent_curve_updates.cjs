const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root,
  "frontend_v2/public/_thirdparty/assets/js/tools/manual-agent.js"), "utf8");
const context = {
  document: { querySelector: () => null },
  curveMetricsFromQuestion: () => ["gain"], curveCharts: () => [],
  frequencyScale: unit => ({ GHz: 1e9, MHz: 1e6, kHz: 1e3, Hz: 1 })[unit] || 1,
};
vm.createContext(context);
vm.runInContext(source.match(/var curveEditableFields = \[[\s\S]*?\];/)[0], context);
for (const [start, end] of [
  ["  function normalizeCurvePrompt(", "  function normalizeCurveTitle("],
  ["  function normalizedCurveChanges(", "  function curveOperationSignature("],
  ["  function curveFrequencyReadout(", "  function curveQuestionSummary("],
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
const parse = prompt => {
  const value = context.parseCurveUpdateRequest(prompt);
  return value && JSON.parse(JSON.stringify(value));
};
let parserCases = 0;
function expectArgs(prompt, args) {
  assert.deepEqual(parse(prompt), { title: "增益和输入输出驻波", args });
  parserCases += 1;
}
const prefix = "请将典型曲线中的增益和输入输出驻波";
const expected = { lineWidth: 4, fontSize: 33, xMin: 4, xMax: 8, xUnit: "GHz", xUnitLabel: "GHz" };
expectArgs(prefix + "曲线线宽设为4，字体大小设为33，X轴显示范围设为4GHz-8GHz。", expected);
expectArgs("请将典型曲线中的【增益和输入输出驻波】曲线线宽设为【4】，字体大小设为【33】，X 轴显示范围设为【4】GHz-【8】GHz。", expected);
expectArgs(prefix + "的线宽设为4,字号设为33;X轴范围设为4-8GHz", expected);
for (const verb of ["设为", "设置为", "改为", "调整为", "修改为", "更改为", "改成", "=", "＝"]) {
  expectArgs(prefix + "的线宽" + verb + "4。", { lineWidth: 4 });
}
expectArgs(prefix + "的曲线增粗为5", { lineWidth: 5 });
expectArgs(prefix + "的字体大小改为33", { fontSize: 33 });
expectArgs(prefix + "的X轴范围设为4GHz-8000MHz", { xMin: 4, xMax: 8, xUnit: "GHz", xUnitLabel: "GHz" });
expectArgs(prefix + "的X轴单位设为MHz，X轴范围设为4GHz-8GHz", { xUnit: "MHz", xUnitLabel: "MHz", xMin: 4000, xMax: 8000 });
expectArgs(prefix + "的X轴范围设为4GHz-8GHz，X轴单位设为MHz", { xUnit: "MHz", xUnitLabel: "MHz", xMin: 4000, xMax: 8000 });
expectArgs(prefix + "的X轴范围设为4-8", { xMin: 4, xMax: 8 });
expectArgs(prefix + "的Y轴范围设为-80--10，右Y轴范围设为-2-3", { yMin: -80, yMax: -10, y2Min: -2, y2Max: 3 });
expectArgs(prefix + "的X轴单位改为mhz", { xUnit: "MHz", xUnitLabel: "MHz" });
expectArgs(prefix + "的图名改为新图名", { title: "新图名" });
for (const prompt of [
  "请将典型曲线中的【曲线名称】曲线线宽设为【1.5～6 之间的数值】。",
  prefix + "的线宽设为4，字体大小设为未知值，X轴范围设为4GHz-8GHz。",
  prefix + "的线宽设为4，线宽设为5。",
]) {
  assert.ok(parse(prompt).error);
  assert.equal(parse(prompt).args, undefined);
  parserCases += 1;
}
assert.equal(parse(prefix + "的线宽设为4，背景颜色设为红色。"), null);
parserCases += 1;
for (const prompt of [
  prefix + "曲线线宽设为4，X轴范围设为4GHz-8GHz。",
  prefix + "的线宽=4，X轴范围=4GHz-8GHz。",
  prefix + "的线宽改为4，X轴范围改为4GHz-8GHz。",
]) {
  assert.equal(context.curveFrequencyReadout(prompt), null);
  assert.equal(context.isCurveQuestion(prompt), false);
  parserCases += 1;
}
assert.match(context.curveFrequencyReadout("4GHz时增益是多少？"), /没有可读取的曲线数据/);
assert.equal(context.isCurveQuestion("增益曲线的趋势怎样？"), true);
parserCases += 1;
for (const action of ["线宽设为9，字体大小设为33", "线宽设为4，字体大小设为33.5", "线宽设为4，X轴范围设为8GHz-4GHz"]) {
  assert.equal(context.normalizedCurveChanges(parse(prefix + "的" + action).args,
    { lineWidth: 3.25, fontSize: 20 }), null);
  parserCases += 1;
}
console.log("curve parser cases: " + parserCases + " passed");

if (process.env.MANUAL_TEST_PARSERS_ONLY !== "1") runBrowser().catch(error => {
  console.error(error); process.exitCode = 1;
});

async function runBrowser() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    for (const endpoint of ["config", "test"]) await page.route("**/api/product-manual/agent/" + endpoint, route => route.fulfill({
      json: { code: 0, msg: "ok", data: { configured: true, ok: true, model: "mock" } },
    }));
    await page.route("**/api/product-manual/layout/process-nodes", route => route.fulfill({
      json: { code: 0, msg: "ok", data: { default_node: "legacy", nodes: [{ id: "legacy", label: "原有工艺",
        layers: { pad: "pad", metal: "M0", ground_via: "via0", io_marker: "via2" } }] } },
    }));
    const requests = [];
    await page.route("**/api/product-manual/agent/chat", route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { code: 0, msg: "ok", data: {
        content: '{"message":"已进入完整手册修改流程。","operations":[]}', model: "mock", elapsedMs: 1,
      } } });
    });
    await page.goto(process.env.MANUAL_TEST_URL || "http://127.0.0.1:5173/product-manual", { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.ProductManualTemplateToolContext));
    await page.evaluate(() => {
      const tool = window.ProductManualTemplateToolContext;
      tool.setCurveResources([{ name: "curve-update.s2p", sourcePath: "curve-update.s2p", text:
        "# GHZ S MA R 50\n4 0.1 0 10 0 0.01 0 0.1 0\n6 0.1 0 100 0 0.01 0 0.1 0" }]);
      tool.setCurveResourceSelected(0, true);
      tool.insertSelectedCurveSuite();
    });
    await page.locator(".curve-embed").first().waitFor();
    async function reset() {
      await page.evaluate(() => window.ProductManualTemplateToolContext.updateCurveConfig(
        document.querySelector(".curve-embed"), { title: "增益和输入输出驻波", lineWidth: 3.25,
          fontSize: 20, xMin: null, xMax: null, xUnit: "auto", xUnitLabel: "GHz" }));
    }
    const payload = () => page.locator(".curve-embed [data-curve-data]").first().textContent().then(JSON.parse);
    async function ask(prompt) {
      await page.locator("[data-agent-input]").fill(prompt);
      await page.locator("[data-agent-send]").click();
      await page.waitForFunction(() => !document.querySelector("[data-agent-send]").disabled);
      return page.locator("[data-agent-messages] .agent-message--assistant").last().innerText();
    }
    for (const prompt of [
      prefix + "曲线线宽设为4，字体大小设为33，X轴显示范围设为4GHz-8GHz。",
      "请将典型曲线中的【增益和输入输出驻波】曲线线宽设为【4】，字体大小设为【33】，X轴显示范围设为【4】GHz-【8】GHz。",
    ]) {
      await reset();
      const before = await payload();
      const beforeImage = await page.locator(".curve-embed img").first().getAttribute("src");
      assert.match(await ask(prompt), /确认修改建议/);
      assert.equal(await page.locator("[data-agent-change-count]").innerText(), "1 项操作");
      assert.deepEqual(await payload(), before);
      await page.locator("[data-agent-apply]").click();
      const after = await payload();
      for (const key of Object.keys(expected)) assert.equal(after.config[key], expected[key]);
      assert.deepEqual(after.resources, before.resources);
      assert.notEqual(await page.locator(".curve-embed img").first().getAttribute("src"), beforeImage);
      const plot = await page.evaluate(() => window.ProductManualTemplateToolContext.getCurveChartModel(
        document.querySelector(".curve-embed")));
      for (const key of ["lineWidth", "fontSize", "xMin", "xMax", "xUnit"]) assert.equal(plot[key], expected[key]);
    }
    await reset();
    const unchanged = await payload();
    for (const prompt of [prefix + "的线宽设为9，字体大小设为33。",
      prefix + "的线宽设为4，X轴显示范围设为8GHz-4GHz。",
      prefix + "的线宽设为4，字体大小设为未知值。",
      "请将典型曲线中的【曲线名称】曲线线宽设为【数值】。",
      "请将典型曲线中的不存在图的线宽改为4。",
    ]) {
      assert.match(await ask(prompt), /无效|无法识别|请先|未找到/);
      assert.equal(await page.locator("[data-agent-proposal]").isVisible(), false);
      assert.deepEqual(await payload(), unchanged);
    }
    assert.equal(requests.length, 0);
    assert.match(await ask("4GHz时增益是多少？"), /20\.00 dB.*直接读取导入数据点/);
    assert.equal(requests.length, 0);
    await ask(prefix + "的线宽设为4，背景颜色设为红色，X轴范围设为4GHz-8GHz。");
    assert.equal(requests.length, 1);
    assert.match(requests[0].messages.at(-1).content, /当前手册结构/);
    assert.match(requests[0].messages[0].content, /curve.update/);
    await page.evaluate(() => {
      const first = document.querySelector(".curve-embed");
      first.parentElement.appendChild(first.cloneNode(true));
    });
    assert.match(await ask(prefix + "的线宽改为4。"), /多张同名曲线/);
    assert.equal(await page.locator("[data-agent-proposal]").isVisible(), false);
    assert.deepEqual(pageErrors, []);
    console.log("curve updates browser: bracket parity, actual apply, atomic rejection, ambiguity, readout and model routing passed");
  } finally {
    await browser.close();
  }
}
