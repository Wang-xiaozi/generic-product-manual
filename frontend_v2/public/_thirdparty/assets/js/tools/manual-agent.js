(function () {
  "use strict";

  var panel = document.querySelector("[data-agent-panel]");
  var manual = document.getElementById("manual");
  if (!panel || !manual) return;

  var form = panel.querySelector("[data-agent-form]");
  var input = panel.querySelector("[data-agent-input]");
  var sendButton = panel.querySelector("[data-agent-send]");
  var messagesNode = panel.querySelector("[data-agent-messages]");
  var statusNode = panel.querySelector("[data-agent-status]");
  var proposalNode = panel.querySelector("[data-agent-proposal]");
  var changeListNode = panel.querySelector("[data-agent-change-list]");
  var changeCountNode = panel.querySelector("[data-agent-change-count]");
  var newChatButton = panel.querySelector("[data-agent-new-chat]");
  var pendingOperations = [];
  var history = [];
  var conversationEpoch = 0;
  var activeChatController = null;
  var connectionCheckController = null;
  var modelName = "";
  var maxOperationsPerRequest = 20;
  var curveEditableFields = [
    "templateId", "title", "xTitle", "xUnitLabel", "yTitle", "yUnitLabel",
    "y2Title", "y2UnitLabel", "xUnit", "lineWidth", "fontSize", "legendLabels",
    "xMin", "xMax", "yMin", "yMax", "y2Min", "y2Max"
  ];

  var defaultSystemPrompt = [
    "你是射频芯片产品技术手册编辑助手。你会收到当前手册的字段、章节、性能特点和典型曲线列表。",
    "请用中文回答，最终只返回单个 JSON 对象，不要输出分析过程、思考过程、Markdown 或代码块。",
    "只咨询时返回：{\"message\":\"回答\",\"operations\":[]}。",
    "修改已有字段的完整文字：{\"op\":\"field.set_text\",\"target\":\"真实字段 id\",\"args\":{\"text\":\"完整纯文本\"},\"reason\":\"原因\"}。",
    "向已有段落追加用户明确提供的文字：{\"op\":\"field.append_text\",\"target\":\"真实字段 id\",\"args\":{\"text\":\"要追加的文字\"},\"reason\":\"原因\"}。产品简介字段通常是 product-intro。",
    "性能特点新增：{\"op\":\"feature.add\",\"target\":\"performance-features\",\"args\":{\"label\":\"指标名称\",\"value\":\"指标值和单位；未知时留空\",\"afterItemId\":\"可选条目 id\"},\"reason\":\"原因\"}。",
    "性能特点修改：{\"op\":\"feature.update\",\"target\":\"真实条目 id\",\"args\":{\"label\":\"可选的新名称\",\"value\":\"可选的新值\"},\"reason\":\"原因\"}。",
    "性能特点删除：{\"op\":\"feature.remove\",\"target\":\"真实条目 id\",\"args\":{},\"reason\":\"原因\"}。",
    "统一当前产品手册的型号：{\"op\":\"manual.set_model\",\"target\":\"manual\",\"args\":{\"model\":\"新型号\"},\"reason\":\"原因\"}。这会统一目录、各页页眉、外形尺寸标题和产品简介；原双型号中的 AM 型号及产品简介中的镜像版本表述应删除。",
    "统一当前产品手册的工作频率范围：{\"op\":\"manual.set_frequency_range\",\"target\":\"manual\",\"args\":{\"startGHz\":\"起始频率数字\",\"endGHz\":\"截止频率数字\"},\"reason\":\"原因\"}。目标为各页副标题、性能特点、微波电参数和产品简介中的工作频率范围；不要改曲线坐标单位。",
    "修改页眉中的芯片名称：{\"op\":\"manual.set_chip_name\",\"target\":\"manual\",\"args\":{\"name\":\"芯片名称\"},\"reason\":\"原因\"}。目标是第一页右上方副标题中的芯片名称，并同步其余页页眉，保留后面的工作频率。",
    "修改典型曲线：{\"op\":\"curve.update\",\"target\":\"典型曲线列表中真实的曲线 id\",\"args\":{\"lineWidth\":6},\"reason\":\"原因\"}。按图名定位，仅在 args 中提供用户要求修改的字段。可修改字段及当前值见典型曲线列表的 config 和 editableFields，包括 templateId、title、xTitle、xUnitLabel、yTitle、yUnitLabel、y2Title、y2UnitLabel、xUnit、lineWidth、fontSize、legendLabels、xMin、xMax、yMin、yMax、y2Min、y2Max。",
    "曲线字段对应编辑弹窗中的曲线类型、图名、各轴标题和单位、频率缩放单位、线宽、字体大小、图例标题及各轴最大最小值。曲线类型须从典型曲线章节的 templateOptions 中选择。用户要求修改 X 轴单位时，同时设置 xUnit 和 xUnitLabel；修改显示范围时设置对应轴的 Min 和 Max。",
    "曲线参数约束：lineWidth 为 1.5 到 6；fontSize 为 12 到 36 的整数；xUnit 可为 auto、GHz、MHz、kHz、Hz；坐标范围值为数字，null 表示自动。若用户同时修改频率缩放单位和 X 范围，X 范围数字应与新单位一致。只修改具备 curve.update capability 的已导入曲线；同名曲线无法唯一确定时请说明。",
    "内容已经存在时不要重复追加，返回 operations 为空并在 message 中说明；目标不存在或无法确定时也不要猜测。",
    "target 只能引用输入中真实存在的字段、章节或条目 id；不得杜撰器件参数。用户没有提供且上下文无法确定的技术数据应留空或说明需要补充。"
  ].join("\n");
  var shortSystemPrompt = "你是射频芯片产品技术手册智能助手。请用中文回答，只返回单个 JSON 对象：" +
    '{"message":"回答","operations":[]}。不要输出分析过程或 Markdown。';
  var curveQuestionSystemPrompt = "你是射频芯片产品手册的曲线数据助手。只根据提供的曲线数值摘要用中文回答。" +
    "不要猜测未提供的频率点或把图片目测值当成原始数据。只返回 JSON：" +
    '{"message":"回答","operations":[]}。';

  function isGeneralQuestion(prompt) {
    var text = String(prompt || "").trim().replace(/[。！？!?．.]+$/g, "").trim();
    return /^(?:你是谁|你叫什么(?:名字)?|你是什么|你能(?:帮我)?做什么|你会做什么|你好|您好|嗨|hi|hello|help)$/i.test(text);
  }

  function setStatus(text, state) {
    statusNode.classList.remove("is-ready", "is-error");
    if (state) statusNode.classList.add(state);
    statusNode.querySelector("b").textContent = text;
  }

  function addMessage(text, kind) {
    var node = document.createElement("div");
    node.className = "agent-message agent-message--" + kind;
    node.textContent = text;
    messagesNode.appendChild(node);
    messagesNode.scrollTop = messagesNode.scrollHeight;
  }

  function nodeText(node) {
    return (node && (node.innerText || node.textContent) || "").trim();
  }

  function stripFeatureColon(text) {
    return String(text || "").trim().replace(/[：:]\s*$/, "").trim();
  }

  function featureLabel(item) {
    var labelNode = item && item.querySelector(".feature-label");
    return stripFeatureColon(labelNode ? labelNode.textContent : item && item.getAttribute("data-feature-key"));
  }

  function featureValue(item) {
    return nodeText(item && item.querySelector(".feature-value"));
  }

  function fieldSectionTitle(node) {
    var section = node && node.closest("section");
    var heading = section && section.querySelector(".section-title");
    return nodeText(heading);
  }

  function findField(id) {
    var nodes = manual.querySelectorAll("[data-agent-id]");
    for (var index = 0; index < nodes.length; index += 1) {
      if (nodes[index].getAttribute("data-agent-id") === id) return nodes[index];
    }
    return null;
  }

  function findFeatureSection(id) {
    var targetId = id || "performance-features";
    var sections = manual.querySelectorAll("[data-agent-section-id]");
    for (var index = 0; index < sections.length; index += 1) {
      if (sections[index].getAttribute("data-agent-section-id") === targetId) return sections[index];
    }
    return null;
  }

  function findFeatureItem(idOrLabel) {
    var items = manual.querySelectorAll("[data-feature-list] > li");
    var wanted = String(idOrLabel || "").trim();
    for (var index = 0; index < items.length; index += 1) {
      if (items[index].getAttribute("data-agent-item-id") === wanted ||
          items[index].getAttribute("data-feature-key") === wanted ||
          featureLabel(items[index]) === wanted) {
        return items[index];
      }
    }
    return null;
  }

  function findCurveItem(id) {
    var curves = manual.querySelectorAll(".curve-embed[data-agent-curve-id]");
    for (var index = 0; index < curves.length; index += 1) {
      if (curves[index].getAttribute("data-agent-curve-id") === id) return curves[index];
    }
    return null;
  }

  function curvePayload(embed) {
    var data = embed && embed.querySelector("[data-curve-data]");
    if (!data || !data.textContent.trim()) return null;
    try {
      return JSON.parse(data.textContent);
    } catch (error) {
      return null;
    }
  }

  function curveTitle(embed) {
    return nodeText(embed && embed.querySelector(".curve-name")) ||
      normalizedText(embed && embed.dataset.curveName);
  }

  function curveLineWidth(payload) {
    var width = Number(payload && payload.config && payload.config.lineWidth);
    return Number.isFinite(width) && width > 0 ? width : 3.25;
  }

  function curveSupportsUpdate(payload) {
    return Boolean(payload && payload.type !== "image-package" &&
      Array.isArray(payload.resources) && payload.resources.length);
  }

  function curveConfigSnapshot(payload) {
    var config = payload && payload.config || {};
    var snapshot = { templateId: payload && payload.templateId || "" };
    curveEditableFields.forEach(function (key) {
      if (key === "templateId") return;
      if (key === "lineWidth") snapshot[key] = curveLineWidth(payload);
      else if (key === "fontSize") snapshot[key] = Number(config.fontSize) || 20;
      else if (/^(?:x|y|y2)(?:Min|Max)$/.test(key)) snapshot[key] = config[key] == null ? null : Number(config[key]);
      else if (key === "legendLabels") snapshot[key] = Array.isArray(config[key]) ? config[key].slice() : [];
      else snapshot[key] = config[key] || (key === "xUnit" ? "auto" : "");
    });
    return snapshot;
  }

  function normalizedCurveChanges(args, current) {
    var changes = {};
    var templateSelect = document.querySelector("[data-curve-template]");
    var textFields = ["title", "xTitle", "xUnitLabel", "yTitle", "yUnitLabel", "y2Title", "y2UnitLabel"];
    var rangeFields = ["xMin", "xMax", "yMin", "yMax", "y2Min", "y2Max"];
    var keys = Object.keys(args || {});
    if (!keys.length || keys.some(function (key) { return curveEditableFields.indexOf(key) < 0; })) return null;
    for (var index = 0; index < keys.length; index += 1) {
      var key = keys[index];
      var value = args[key];
      if (textFields.indexOf(key) >= 0) {
        if (typeof value !== "string" || value.length > 120 || /[\r\n]/.test(value)) return null;
        changes[key] = value.trim();
      } else if (key === "templateId") {
        if (typeof value !== "string" || !templateSelect ||
            !Array.from(templateSelect.options).some(function (option) { return option.value === value; })) return null;
        changes[key] = value;
      } else if (key === "xUnit") {
        if (["auto", "GHz", "MHz", "kHz", "Hz"].indexOf(value) < 0) return null;
        changes[key] = value;
      } else if (key === "lineWidth" || key === "fontSize") {
        var number = Number(value);
        if (!Number.isFinite(number) ||
            (key === "lineWidth" && (number < 1.5 || number > 6)) ||
            (key === "fontSize" && (number < 12 || number > 36 || !Number.isInteger(number)))) return null;
        changes[key] = number;
      } else if (key === "legendLabels") {
        var labels = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n|[;,，；]+/) : null;
        if (!labels || labels.length > 20 || labels.some(function (label) {
          return typeof label !== "string" || label.length > 80;
        })) return null;
        changes[key] = labels.map(function (label) { return label.trim(); }).filter(Boolean);
      } else if (rangeFields.indexOf(key) >= 0) {
        if (value === null || value === "") changes[key] = null;
        else {
          var bound = Number(value);
          if (typeof value === "boolean" || !Number.isFinite(bound)) return null;
          changes[key] = bound;
        }
      }
    }
    var effective = Object.assign({}, current, changes);
    if (["x", "y", "y2"].some(function (axis) {
      return effective[axis + "Min"] != null && effective[axis + "Max"] != null &&
        effective[axis + "Min"] >= effective[axis + "Max"];
    })) return null;
    if (keys.every(function (key) { return JSON.stringify(changes[key]) === JSON.stringify(current[key]); })) return null;
    return changes;
  }

  function curveOperationSignature(curve, payload) {
    return JSON.stringify([curveTitle(curve), payload.templateId, payload.config || {}]);
  }

  function uniqueFeatureItemId(label) {
    var base = "feature:" + String(label || "新指标").trim();
    var candidate = base;
    var suffix = 2;
    while (findFeatureItem(candidate)) {
      candidate = base + ":" + suffix;
      suffix += 1;
    }
    return candidate;
  }

  function annotateManualStructure() {
    var sectionNumber = 0;
    manual.querySelectorAll("[data-feature-list]").forEach(function (list) {
      sectionNumber += 1;
      if (!list.getAttribute("data-agent-section-id")) {
        list.setAttribute(
          "data-agent-section-id",
          sectionNumber === 1 ? "performance-features" : "performance-features-" + sectionNumber
        );
      }
      list.querySelectorAll(":scope > li").forEach(function (item, itemIndex) {
        var label = featureLabel(item) || item.getAttribute("data-feature-key") || "未命名指标";
        var itemId = item.getAttribute("data-agent-item-id") || "feature:" + label;
        if (findFeatureItem(itemId) && findFeatureItem(itemId) !== item) {
          itemId += ":" + (itemIndex + 1);
        }
        item.setAttribute("data-agent-item-id", itemId);
        item.setAttribute("data-feature-key", label);
        var valueNode = item.querySelector(".feature-value");
        if (valueNode) {
          valueNode.setAttribute("data-feature-value", label);
          valueNode.setAttribute("data-agent-id", itemId + ":value");
        }
      });
    });

    var usedCurveIds = {};
    var curveNumber = 0;
    manual.querySelectorAll(".curve-embed").forEach(function (embed) {
      var id = embed.getAttribute("data-agent-curve-id");
      if (!id || usedCurveIds[id]) {
        do {
          curveNumber += 1;
          id = "curve:" + curveNumber;
        } while (usedCurveIds[id]);
        embed.setAttribute("data-agent-curve-id", id);
      }
      usedCurveIds[id] = true;
    });

    var genericIndex = 0;
    manual.querySelectorAll('[contenteditable="true"]').forEach(function (node) {
      if (!node.getAttribute("data-agent-id")) {
        var candidate;
        do {
          genericIndex += 1;
          candidate = "field-" + genericIndex;
        } while (findField(candidate));
        node.setAttribute("data-agent-id", candidate);
      }
    });
  }

  function editableSnapshot() {
    annotateManualStructure();
    var fields = [];
    var groups = new Map();
    var seenIds = new Set();
    manual.querySelectorAll('[contenteditable="true"]').forEach(function (node) {
      var id = node.getAttribute("data-agent-id");
      var text = nodeText(node);
      if (seenIds.has(id) || !(text || node.matches("td, th") || node.hasAttribute("data-agent-role"))) return;
      seenIds.add(id);
      var sectionTitle = fieldSectionTitle(node);
      var group = groups.get(sectionTitle);
      if (!group) {
        group = [sectionTitle, []];
        groups.set(sectionTitle, group);
        fields.push(group);
      }
      group[1].push([id, text]);
    });
    return fields;
  }

  function curveMetricsFromQuestion(prompt) {
    var metrics = [];
    if (/增益|\bGain\b|\bS21\b/i.test(prompt)) metrics.push("gain");
    if (/输入输出驻波|输入(?:和|与|、|及)输出驻波|VSWR[\s_(-]*in.*VSWR[\s_(-]*out/i.test(prompt)) {
      metrics.push("vswr_in", "vswr_out");
    } else {
      if (/输入驻波|输入驻波比|VSWR[\s_(-]*in\b/i.test(prompt)) metrics.push("vswr_in");
      if (/输出驻波|输出驻波比|VSWR[\s_(-]*out\b/i.test(prompt)) metrics.push("vswr_out");
    }
    if (/反向隔离|隔离度|\bS12\b/i.test(prompt)) metrics.push("iso");
    if (/噪声系数|\bNF\b|noise\s*figure/i.test(prompt)) metrics.push("nf");
    if (/压缩点|\bP1dB\b/i.test(prompt)) metrics.push("p1db");
    return metrics;
  }

  function curveMetricUnit(metric) {
    return metric === "vswr_in" || metric === "vswr_out" ? "" :
      metric === "p1db" ? "dBm" : "dB";
  }

  function curveMetricName(metric) {
    return ({ gain: "增益", vswr_in: "输入驻波", vswr_out: "输出驻波",
      iso: "反向隔离", nf: "噪声系数", p1db: "输出 1dB 压缩点功率" })[metric] || metric;
  }

  function frequencyScale(unit) {
    return ({ Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 })[unit] || 1;
  }

  function formatCurveNumber(value) {
    return Number(value.toFixed(2)).toFixed(2);
  }

  function curveCharts(prompt) {
    var context = window.ProductManualTemplateToolContext;
    if (!context || typeof context.getCurveChartModel !== "function") return [];
    var charts = Array.from(manual.querySelectorAll(".curve-embed")).map(function (embed) {
      var plot;
      try {
        plot = context.getCurveChartModel(embed);
      } catch (error) {
        return null;
      }
      return plot && plot.series && plot.series.length ? { title: curveTitle(embed), plot: plot } : null;
    }).filter(Boolean);
    var named = charts.filter(function (chart) {
      return chart.title && String(prompt || "").indexOf(chart.title) >= 0;
    });
    return named.length ? named : charts;
  }

  function curveValueAt(points, x) {
    var sorted = (points || []).filter(function (point) {
      return Number.isFinite(point.x) && Number.isFinite(point.y);
    }).slice().sort(function (a, b) { return a.x - b.x; });
    if (!sorted.length) return null;
    var tolerance = Math.max(1e-9, Math.abs(x) * 1e-9);
    var first = sorted[0];
    var last = sorted[sorted.length - 1];
    if (x < first.x - tolerance || x > last.x + tolerance) {
      return { outside: true, first: first, last: last };
    }
    for (var index = 0; index < sorted.length; index += 1) {
      if (Math.abs(sorted[index].x - x) <= tolerance) {
        return { value: sorted[index].y, exact: true, point: sorted[index] };
      }
      if (index > 0 && sorted[index - 1].x < x && x < sorted[index].x) {
        var before = sorted[index - 1];
        var after = sorted[index];
        return { value: before.y + (after.y - before.y) * (x - before.x) / (after.x - before.x),
          exact: false, before: before, after: after };
      }
    }
    return null;
  }

  function curveFrequencyReadout(prompt) {
    var match = String(prompt || "").match(/(\d+(?:\.\d+)?)\s*(GHz|MHz|kHz|Hz)\b/i);
    var metrics = curveMetricsFromQuestion(prompt);
    if (!match || !metrics.length || /修改|设置|替换|改成|删除|新增|绘制|生成|调整/.test(prompt)) return null;
    var inputUnit = ({ ghz: "GHz", mhz: "MHz", khz: "kHz", hz: "Hz" })[match[2].toLowerCase()];
    var requestedHz = Number(match[1]) * frequencyScale(inputUnit);
    if (!Number.isFinite(requestedHz)) return null;
    var frequencyLabel = Number(match[1]) + " " + inputUnit;
    var charts = curveCharts(prompt);
    if (!charts.length) {
      return "当前手册没有可读取的曲线数据，请先导入 S 参数并生成曲线。";
    }
    var readings = [];
    charts.forEach(function (chart) {
      var plotUnit = chart.plot.xUnit || "GHz";
      var x = requestedHz / frequencyScale(plotUnit);
      chart.plot.series.filter(function (series) { return metrics.indexOf(series.metric) >= 0; }).forEach(function (series) {
        readings.push({ chart: chart.title, series: series, plotUnit: plotUnit,
          reading: curveValueAt(series.points, x) });
      });
    });
    var metricNames = metrics.map(curveMetricName).join("、");
    if (!readings.length) return "当前曲线没有“" + metricNames + "”数值，请指定包含该指标的曲线。";
    if (readings.length > 8) return "找到 " + readings.length + " 条“" + metricNames +
      "”曲线，请在问题中指定曲线标题或温度、电压条件。";
    return readings.map(function (item) {
      var reading = item.reading;
      var label = "曲线“" + item.chart + "”的“" + item.series.label + "”";
      var source = item.series.sourceName ? "（" + item.series.sourceName + "）" : "";
      if (!reading) return label + source + "没有可读取的数据点。";
      if (reading.outside) return label + source + "的数据范围为 " +
        formatCurveNumber(reading.first.x) + "–" + formatCurveNumber(reading.last.x) + " " +
        item.plotUnit + "；" + frequencyLabel + " 超出范围，不作外推。";
      var method = reading.exact ? "直接读取导入数据点" :
        "按 " + formatCurveNumber(reading.before.x) + " 与 " + formatCurveNumber(reading.after.x) +
        " " + item.plotUnit + " 两个数据点线性插值";
      return label + source + "在 " + frequencyLabel + " 的" + curveMetricName(item.series.metric) + "为 " +
        formatCurveNumber(reading.value) + (curveMetricUnit(item.series.metric) ? " " + curveMetricUnit(item.series.metric) : "") +
        "（" + method + "）。";
    }).join("\n");
  }

  function isCurveQuestion(prompt) {
    return /曲线|S\s*参数|S21|Gain|增益|驻波|VSWR|噪声系数|P1dB|隔离度/i.test(prompt) &&
      /多少|是多少|读数|数值|趋势|走势|最高|最低|最大|最小|峰值|谷值|变化|比较|如何|为什么|什么|哪|？|\?/i.test(prompt) &&
      !/修改|设置|替换|改成|删除|新增|绘制|生成|调整/.test(prompt);
  }

  function curveQuestionSummary(prompt) {
    var charts = curveCharts(prompt);
    if (!charts.length) return null;
    if (charts.length > 4) {
      return { needsSelection: true, totalCharts: charts.length,
        titles: charts.slice(0, 8).map(function (chart) { return chart.title; }) };
    }
    var summaries = charts.slice(0, 4).map(function (chart) {
      return {
        title: chart.title,
        xUnit: chart.plot.xUnit,
        series: chart.plot.series.slice(0, 5).map(function (series) {
          var points = series.points || [];
          var minimum = points.reduce(function (best, point) { return !best || point.y < best.y ? point : best; }, null);
          var maximum = points.reduce(function (best, point) { return !best || point.y > best.y ? point : best; }, null);
          var samples = [];
          for (var index = 0; index < Math.min(9, points.length); index += 1) {
            var point = points[Math.round(index * (points.length - 1) / Math.max(1, Math.min(9, points.length) - 1))];
            samples.push([Number(point.x.toFixed(4)), Number(point.y.toFixed(3))]);
          }
          return { label: series.label, metric: series.metric, unit: curveMetricUnit(series.metric),
            source: series.sourceName, count: points.length,
            range: points.length ? [points[0].x, points[points.length - 1].x] : null,
            minimum: minimum ? [minimum.x, Number(minimum.y.toFixed(3))] : null,
            maximum: maximum ? [maximum.x, Number(maximum.y.toFixed(3))] : null,
            samples: samples };
        })
      };
    });
    return { charts: summaries, totalCharts: charts.length,
      note: "摘要包含完整数据的极值与少量采样点；未列出的频率点不得猜测数值。" };
  }

  function structureSnapshot() {
    annotateManualStructure();
    var sections = [];
    manual.querySelectorAll("[data-agent-section-id]").forEach(function (list) {
      var items = [];
      list.querySelectorAll(":scope > li").forEach(function (item) {
        items.push({
          id: item.getAttribute("data-agent-item-id"),
          label: featureLabel(item),
          value: featureValue(item)
        });
      });
      sections.push({
        id: list.getAttribute("data-agent-section-id"),
        type: "feature-list",
        title: "性能特点",
        capabilities: ["feature.add", "feature.update", "feature.remove"],
        items: items
      });
    });
    if (manual.querySelector("[data-curve-section]")) {
      var curves = [];
      var curveTemplateSelect = document.querySelector("[data-curve-template]");
      manual.querySelectorAll(".curve-embed").forEach(function (embed) {
        var payload = curvePayload(embed);
        var editable = curveSupportsUpdate(payload);
        curves.push({
          id: embed.getAttribute("data-agent-curve-id"),
          title: curveTitle(embed),
          templateId: payload && payload.templateId || "",
          type: payload && payload.type || "snp-origin",
          config: editable ? curveConfigSnapshot(payload) : null,
          editableFields: editable ? curveEditableFields : [],
          capabilities: editable ? ["curve.update"] : []
        });
      });
      sections.push({
        id: "typical-curves",
        type: "curve-list",
        title: "典型曲线",
        templateOptions: Array.from(curveTemplateSelect ? curveTemplateSelect.options : []).map(function (option) {
          return { id: option.value, title: option.textContent.trim() };
        }),
        items: curves
      });
    }
    return sections;
  }

  function manualSnapshot() {
    return {
      fields: editableSnapshot(),
      sections: structureSnapshot(),
      manualOperations: ["manual.set_model", "manual.set_frequency_range", "manual.set_chip_name"]
    };
  }

  function parseModelContent(content) {
    var raw = String(content || "").trim()
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    try {
      return JSON.parse(raw);
    } catch (firstError) {
      var start = raw.indexOf("{");
      var end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(raw.slice(start, end + 1));
        } catch (secondError) {
          // Fall through and show a normal chat answer.
        }
      }
      return { message: raw || "模型未返回内容。", operations: [] };
    }
  }

  function normalizedText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function addManualEdit(edits, node, value, label) {
    if (!node) return;
    var before = nodeText(node);
    var after = String(value == null ? "" : value).trim();
    if (before !== after) edits.push({ node: node, before: before, after: after, label: label });
  }

  function currentTreeLabel() {
    return document.querySelector(".resource-tree .tree-node.is-active > .tree-row .tree-label");
  }

  function replaceModelNames(value, model) {
    return String(value || "").replace(/\bNC[A-Za-z0-9]+-[A-Za-z0-9]+(?:\s*[/／]\s*NC[A-Za-z0-9]+-[A-Za-z0-9]+)*\b/g, model);
  }

  function removeMirrorModelClause(value) {
    return String(value || "").replace(/[，,]\s*NC[A-Za-z0-9]+-[A-Za-z0-9]+\s*是镜像版本/g, "");
  }

  function microwaveFrequencyCells() {
    var sections = manual.querySelectorAll(".section.table-block");
    for (var index = 0; index < sections.length; index += 1) {
      var heading = sections[index].querySelector(":scope > .section-title");
      if (!heading || nodeText(heading).indexOf("微波电参数") < 0) continue;
      var rows = sections[index].querySelectorAll("tbody > tr");
      for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        var cells = rows[rowIndex].querySelectorAll("td");
        if (cells.length >= 6 && nodeText(cells[0]) === "频率范围") return cells;
      }
    }
    return null;
  }

  function buildManualEdits(operation) {
    var edits = [];
    var args = operation.args || {};
    if (operation.op === "manual.set_model") {
      var model = normalizedText(args.model);
      if (!/^NC[A-Za-z0-9]+-[A-Za-z0-9]+$/i.test(model)) return null;
      addManualEdit(edits, currentTreeLabel(), model, "产品目录");
      manual.querySelectorAll(".model").forEach(function (node, index) {
        addManualEdit(edits, node, model, "第 " + (index + 1) + " 页页眉型号");
      });
      manual.querySelectorAll(".dimension-caption").forEach(function (node) {
        addManualEdit(edits, node, replaceModelNames(nodeText(node), model), "外形尺寸标题");
      });
      var intro = findField("product-intro");
      if (intro) {
        addManualEdit(edits, intro, replaceModelNames(removeMirrorModelClause(nodeText(intro)), model), "产品简介");
      }
    } else if (operation.op === "manual.set_frequency_range") {
      var start = normalizedText(String(args.startGHz == null ? "" : args.startGHz));
      var end = normalizedText(String(args.endGHz == null ? "" : args.endGHz));
      if (!/^\d+(?:\.\d+)?$/.test(start) || !/^\d+(?:\.\d+)?$/.test(end) ||
          Number(start) <= 0 || Number(end) <= Number(start)) return null;
      var range = start + "GHz-" + end + "GHz";
      var rangePattern = /\d+(?:\.\d+)?\s*(?:GHz|MHz)?\s*[-~～—–至到]\s*\d+(?:\.\d+)?\s*(?:GHz|MHz)/gi;
      manual.querySelectorAll(".subtitle").forEach(function (node, index) {
        var before = nodeText(node);
        if (rangePattern.test(before)) {
          addManualEdit(edits, node, before.replace(rangePattern, range), "第 " + (index + 1) + " 页页眉频率");
        }
        rangePattern.lastIndex = 0;
      });
      var feature = findFeatureItem("频率范围");
      addManualEdit(edits, feature && feature.querySelector(".feature-value"), range, "性能特点频率范围");
      var cells = microwaveFrequencyCells();
      if (cells) {
        if (nodeText(cells[2]) && nodeText(cells[2]) !== "-") addManualEdit(edits, cells[2], start, "微波电参数最小频率");
        addManualEdit(edits, cells[3], start + "～" + end, "微波电参数典型频率范围");
        if (nodeText(cells[4]) && nodeText(cells[4]) !== "-") addManualEdit(edits, cells[4], end, "微波电参数最大频率");
        addManualEdit(edits, cells[5], "GHz", "微波电参数频率单位");
      }
      var frequencyIntro = findField("product-intro");
      if (frequencyIntro && rangePattern.test(nodeText(frequencyIntro))) {
        addManualEdit(edits, frequencyIntro, nodeText(frequencyIntro).replace(rangePattern, range), "产品简介工作频率");
      }
    } else if (operation.op === "manual.set_chip_name") {
      var name = normalizedText(args.name);
      if (!name || name.length > 100 || /[,，\r\n]/.test(name)) return null;
      manual.querySelectorAll(".subtitle").forEach(function (node, index) {
        var before = nodeText(node);
        var separator = before.search(/[,，]/);
        var after = separator >= 0 ? name + before.slice(separator) : name;
        addManualEdit(edits, node, after, "第 " + (index + 1) + " 页页眉芯片名称");
      });
    } else {
      return null;
    }
    return edits;
  }

  function manualEditSignature(edits) {
    return JSON.stringify(edits.map(function (edit) {
      return [edit.label, edit.before, edit.after];
    }));
  }

  function operationFromLegacyChange(change) {
    if (!change || typeof change.id !== "string" || typeof change.text !== "string") return null;
    return {
      op: "field.set_text",
      target: change.id,
      args: { text: change.text },
      reason: change.reason || "修改文字"
    };
  }

  function normalizeOperation(raw) {
    if (!raw || typeof raw !== "object") return null;
    var op = normalizedText(raw.op || raw.type);
    var aliases = {
      "append_text": "field.append_text",
      "field.append": "field.append_text",
      "field.append-text": "field.append_text",
      "set_text": "field.set_text",
      "curve.set_line_width": "curve.update",
      "feature.delete": "feature.remove",
      "feature.add_item": "feature.add",
      "feature.update_item": "feature.update",
      "feature.delete_item": "feature.remove"
    };
    op = aliases[op] || op;
    var args = raw.args && typeof raw.args === "object" ? raw.args : {};
    var target = normalizedText(raw.target || raw.id || raw.sectionId || raw.itemId);
    var normalized = {
      op: op,
      target: target,
      args: {},
      reason: normalizedText(raw.reason)
    };

    if (op === "field.set_text" || op === "field.append_text") {
      normalized.args.text = typeof args.text === "string" ? args.text : raw.text;
    } else if (op === "manual.set_model") {
      normalized.target = target || "manual";
      normalized.args.model = normalizedText(args.model || raw.model);
    } else if (op === "manual.set_frequency_range") {
      normalized.target = target || "manual";
      normalized.args.startGHz = normalizedText(String(args.startGHz == null ? "" : args.startGHz));
      normalized.args.endGHz = normalizedText(String(args.endGHz == null ? "" : args.endGHz));
    } else if (op === "manual.set_chip_name") {
      normalized.target = target || "manual";
      normalized.args.name = normalizedText(args.name || raw.name);
    } else if (op === "curve.update") {
      curveEditableFields.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(args, key)) normalized.args[key] = args[key];
      });
      if (raw.lineWidth != null && normalized.args.lineWidth == null) normalized.args.lineWidth = raw.lineWidth;
    } else if (op === "feature.add") {
      normalized.target = target || "performance-features";
      normalized.args.label = normalizedText(args.label || args.key || raw.label);
      normalized.args.value = typeof args.value === "string" ? args.value.trim() : normalizedText(raw.value);
      normalized.args.afterItemId = normalizedText(args.afterItemId || args.after || raw.afterItemId);
    } else if (op === "feature.update") {
      if (typeof args.label === "string" || typeof raw.label === "string") {
        normalized.args.label = normalizedText(args.label || raw.label);
      }
      if (typeof args.value === "string" || typeof raw.value === "string") {
        normalized.args.value = String(typeof args.value === "string" ? args.value : raw.value).trim();
      }
    } else if (op === "feature.remove") {
      normalized.args = {};
    } else if (op === "no_change") {
      normalized.args.note = normalizedText(args.note || raw.note);
    } else {
      return null;
    }
    return normalized;
  }

  function duplicateFeatureLabel(label, exceptItem) {
    var duplicate = null;
    manual.querySelectorAll("[data-feature-list] > li").forEach(function (item) {
      if (!duplicate && item !== exceptItem && featureLabel(item) === label) duplicate = item;
    });
    return duplicate;
  }

  function validateOperation(operation) {
    if (!operation) return null;
    var reason = operation.reason || "Agent 修改";

    if (operation.op === "curve.update") {
      var curve = findCurveItem(operation.target);
      var payload = curvePayload(curve);
      var context = window.ProductManualTemplateToolContext;
      if (!curve || !curveSupportsUpdate(payload) || !context ||
          typeof context.previewCurveConfigUpdate !== "function") return null;
      var matchingTitles = Array.from(manual.querySelectorAll(".curve-embed")).filter(function (embed) {
        return normalizeCurveTitle(curveTitle(embed)) === normalizeCurveTitle(curveTitle(curve));
      });
      if (matchingTitles.length !== 1) return null;
      var current = curveConfigSnapshot(payload);
      var changes = normalizedCurveChanges(operation.args, current);
      if (!changes || !context.previewCurveConfigUpdate(curve, changes)) return null;
      var title = curveTitle(curve);
      var labels = {
        templateId: "曲线类型", title: "图名", xTitle: "X 轴标题", xUnitLabel: "X 轴单位",
        yTitle: "Y 轴标题", yUnitLabel: "Y 轴单位", y2Title: "右 Y 轴标题",
        y2UnitLabel: "右 Y 轴单位", xUnit: "频率缩放单位", lineWidth: "线宽",
        fontSize: "字体大小", legendLabels: "图例标题", xMin: "X 最小值", xMax: "X 最大值",
        yMin: "Y 最小值", yMax: "Y 最大值", y2Min: "右 Y 最小值", y2Max: "右 Y 最大值"
      };
      var changedKeys = Object.keys(changes);
      function display(value) {
        if (value == null || value === "") return "自动";
        return Array.isArray(value) ? value.join("、") : String(value);
      }
      return {
        op: operation.op,
        target: operation.target,
        args: changes,
        reason: reason,
        title: "修改典型曲线 · " + title,
        before: changedKeys.map(function (key) { return labels[key] + "：" + display(current[key]); }).join("；"),
        after: changedKeys.map(function (key) { return labels[key] + "：" + display(changes[key]); }).join("；"),
        expected: { signature: curveOperationSignature(curve, payload) }
      };
    }

    if (/^manual\.set_(?:model|frequency_range|chip_name)$/.test(operation.op)) {
      if (operation.target !== "manual") return null;
      var edits = buildManualEdits(operation);
      if (!edits || !edits.length) return null;
      var titles = {
        "manual.set_model": "统一产品型号",
        "manual.set_frequency_range": "统一工作频率范围",
        "manual.set_chip_name": "修改芯片名称"
      };
      return {
        op: operation.op,
        target: "manual",
        args: operation.args,
        reason: reason,
        title: titles[operation.op],
        before: edits.map(function (edit) { return edit.label + "：" + (edit.before || "（空）"); }).join("；"),
        after: edits.map(function (edit) { return edit.label + "：" + edit.after; }).join("；"),
        expected: { signature: manualEditSignature(edits) }
      };
    }

    if (operation.op === "field.set_text") {
      var field = findField(operation.target);
      if (!field || typeof operation.args.text !== "string" || operation.args.text.length > 10000) return null;
      return {
        op: operation.op,
        target: operation.target,
        args: { text: operation.args.text },
        reason: reason,
        title: reason,
        before: nodeText(field),
        after: operation.args.text,
        expected: { text: nodeText(field) }
      };
    }

    if (operation.op === "field.append_text") {
      var appendField = findField(operation.target);
      var appendText = typeof operation.args.text === "string" ? operation.args.text.trim() : "";
      var appendBefore = nodeText(appendField);
      if (!appendField || !appendText || appendText.length > 10000 || appendBefore.indexOf(appendText) >= 0) return null;
      return {
        op: operation.op,
        target: operation.target,
        args: { text: appendText },
        reason: reason,
        title: reason,
        before: appendBefore || "（空）",
        after: appendBefore ? appendBefore + "\n" + appendText : appendText,
        expected: { text: appendBefore }
      };
    }

    if (operation.op === "feature.add") {
      var section = findFeatureSection(operation.target);
      var label = normalizedText(operation.args.label);
      var value = normalizedText(operation.args.value);
      if (!section || !label || label.length > 80 || value.length > 500 || duplicateFeatureLabel(label, null)) return null;
      return {
        op: operation.op,
        target: operation.target,
        args: {
          label: label,
          value: value,
          afterItemId: normalizedText(operation.args.afterItemId)
        },
        reason: reason,
        title: "新增性能特点 · " + label,
        before: "不存在",
        after: label + "：" + value,
        expected: { absentLabel: label }
      };
    }

    var item = findFeatureItem(operation.target);
    if (!item) return null;
    var currentLabel = featureLabel(item);
    var currentValue = featureValue(item);

    if (operation.op === "feature.update") {
      var hasLabel = Object.prototype.hasOwnProperty.call(operation.args, "label");
      var hasValue = Object.prototype.hasOwnProperty.call(operation.args, "value");
      var nextLabel = hasLabel ? normalizedText(operation.args.label) : currentLabel;
      var nextValue = hasValue ? String(operation.args.value || "").trim() : currentValue;
      if ((!hasLabel && !hasValue) || !nextLabel || nextLabel.length > 80 || nextValue.length > 500 ||
          duplicateFeatureLabel(nextLabel, item)) return null;
      return {
        op: operation.op,
        target: item.getAttribute("data-agent-item-id"),
        args: { label: nextLabel, value: nextValue },
        reason: reason,
        title: "修改性能特点 · " + currentLabel,
        before: currentLabel + "：" + currentValue,
        after: nextLabel + "：" + nextValue,
        expected: { label: currentLabel, value: currentValue }
      };
    }

    if (operation.op === "feature.remove") {
      return {
        op: operation.op,
        target: item.getAttribute("data-agent-item-id"),
        args: {},
        reason: reason,
        title: "删除性能特点 · " + currentLabel,
        before: currentLabel + "：" + currentValue,
        after: "将删除此条目",
        expected: { label: currentLabel, value: currentValue }
      };
    }
    return null;
  }

  function renderProposal(rawOperations) {
    pendingOperations = [];
    var rejected = 0;
    (rawOperations || []).slice(0, maxOperationsPerRequest).forEach(function (raw) {
      var operation = validateOperation(normalizeOperation(raw));
      if (operation) pendingOperations.push(operation);
      else rejected += 1;
    });

    changeListNode.innerHTML = "";
    pendingOperations.forEach(function (operation) {
      var item = document.createElement("div");
      item.className = "agent-change";
      var title = document.createElement("strong");
      title.textContent = operation.title;
      var before = document.createElement("del");
      before.textContent = "原：" + operation.before;
      var after = document.createElement("ins");
      after.textContent = "新：" + operation.after;
      item.append(title, before, after);
      changeListNode.appendChild(item);
    });
    changeCountNode.textContent = pendingOperations.length + " 项操作";
    proposalNode.hidden = pendingOperations.length === 0;
    return { accepted: pendingOperations.length, rejected: rejected };
  }

  function createFeatureItem(label, value) {
    var itemId = uniqueFeatureItemId(label);
    var item = document.createElement("li");
    item.setAttribute("data-feature-key", label);
    item.setAttribute("data-agent-item-id", itemId);

    var labelNode = document.createElement("span");
    labelNode.className = "feature-label";
    labelNode.textContent = label + "：";

    var valueNode = document.createElement("span");
    valueNode.className = "feature-value editable";
    valueNode.contentEditable = "true";
    valueNode.setAttribute("data-feature-value", label);
    valueNode.setAttribute("data-agent-id", itemId + ":value");
    valueNode.textContent = value;
    item.append(labelNode, valueNode);
    return item;
  }

  function itemStillMatches(item, expected) {
    return Boolean(item) && featureLabel(item) === expected.label && featureValue(item) === expected.value;
  }

  function applyOperation(operation) {
    if (operation.op === "curve.update") {
      var curve = findCurveItem(operation.target);
      var payload = curvePayload(curve);
      var context = window.ProductManualTemplateToolContext;
      if (!curve || !curveSupportsUpdate(payload) || !context ||
          typeof context.updateCurveConfig !== "function" ||
          curveOperationSignature(curve, payload) !== operation.expected.signature) return false;
      return context.updateCurveConfig(curve, operation.args);
    }
    if (/^manual\.set_(?:model|frequency_range|chip_name)$/.test(operation.op)) {
      var edits = buildManualEdits(operation);
      if (!edits || manualEditSignature(edits) !== operation.expected.signature) return false;
      edits.forEach(function (edit) { edit.node.textContent = edit.after; });
      edits.forEach(function (edit) { edit.node.dispatchEvent(new Event("input", { bubbles: true })); });
      return true;
    }
    if (operation.op === "field.set_text") {
      var field = findField(operation.target);
      if (!field || nodeText(field) !== operation.expected.text) return false;
      field.innerText = operation.args.text;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    if (operation.op === "field.append_text") {
      var appendField = findField(operation.target);
      var currentText = nodeText(appendField);
      if (!appendField || currentText !== operation.expected.text || currentText.indexOf(operation.args.text) >= 0) return false;
      appendField.innerText = currentText ? currentText + "\n" + operation.args.text : operation.args.text;
      appendField.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    if (operation.op === "feature.add") {
      var section = findFeatureSection(operation.target);
      if (!section || duplicateFeatureLabel(operation.args.label, null)) return false;
      var newItem = createFeatureItem(operation.args.label, operation.args.value);
      var afterItem = operation.args.afterItemId ? findFeatureItem(operation.args.afterItemId) : null;
      if (afterItem && afterItem.parentElement === section) afterItem.insertAdjacentElement("afterend", newItem);
      else section.appendChild(newItem);
      newItem.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    var item = findFeatureItem(operation.target);
    if (!itemStillMatches(item, operation.expected)) return false;

    if (operation.op === "feature.update") {
      if (duplicateFeatureLabel(operation.args.label, item)) return false;
      var labelNode = item.querySelector(".feature-label");
      var valueNode = item.querySelector(".feature-value");
      if (!labelNode || !valueNode) return false;
      labelNode.textContent = operation.args.label + "：";
      valueNode.textContent = operation.args.value;
      item.setAttribute("data-feature-key", operation.args.label);
      valueNode.setAttribute("data-feature-value", operation.args.label);
      valueNode.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    if (operation.op === "feature.remove") {
      var list = item.parentElement;
      item.remove();
      if (list) list.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }

  function persistAppliedOperations() {
    var context = window.ProductManualTemplateToolContext;
    if (context && typeof context.schedulePagination === "function") context.schedulePagination();
    if (context && typeof context.saveActivePage === "function") context.saveActivePage();
    manual.dispatchEvent(new CustomEvent("manual-agent:applied", { bubbles: true }));
  }

  function setBusy(busy) {
    input.disabled = busy;
    sendButton.disabled = busy;
    sendButton.textContent = busy ? "思考中…" : "发送";
  }

  function startNewConversation() {
    conversationEpoch += 1;
    if (activeChatController) activeChatController.abort();
    activeChatController = null;
    history = [];
    pendingOperations = [];
    proposalNode.hidden = true;
    changeListNode.innerHTML = "";
    changeCountNode.textContent = "0 项操作";
    messagesNode.innerHTML = "";
    addMessage("已开启新对话。之前的聊天记录不会发送给模型。", "assistant");
    input.value = "";
    setBusy(false);
    input.focus();
  }

  async function requestJson(url, options) {
    return window.ProductManualApi.requestLegacy(url, options || {});
  }

  function applyPublicConfig(config) {
    modelName = config.model || "";
    if (config.configured) {
      setStatus("正在验证模型连接 · " + modelName);
    } else {
      setStatus("模型未配置，请在后端配置 APP_LLM_MODEL", "is-error");
    }
  }

  function checkModelConnection() {
    var controller = new AbortController();
    connectionCheckController = controller;
    requestJson("/api/agent/config", { signal: controller.signal }).then(function (config) {
      if (connectionCheckController !== controller) return;
      applyPublicConfig(config);
      if (!config.configured) return;
      return requestJson("/api/agent/test", { method: "POST", signal: controller.signal }).then(function (result) {
        if (connectionCheckController !== controller) return;
        if (result && result.ok === true) {
          setStatus("模型连接正常 · " + (result.model || modelName), "is-ready");
        } else {
          setStatus("模型连接失败", "is-error");
        }
      });
    }).catch(function (error) {
      if (controller.signal.aborted || connectionCheckController !== controller) return;
      setStatus(error.message || "模型连接失败", "is-error");
    }).finally(function () {
      if (connectionCheckController === controller) connectionCheckController = null;
    });
  }

  function resultOperations(result) {
    var operations = Array.isArray(result.operations) ? result.operations.slice() : [];
    if (!operations.length && typeof result.op === "string") operations = [result];
    if (!operations.length && Array.isArray(result.changes)) {
      operations = result.changes.map(operationFromLegacyChange).filter(Boolean);
    }
    return operations.filter(function (operation) {
      return operation && normalizedText(operation.op || operation.type) !== "no_change";
    });
  }

  function resultMessage(result, proposal) {
    var message = normalizedText(result && result.message);
    if (message && !/^我们需要回答用户要求/.test(message) &&
        (proposal.accepted || !/已生成修改建议|请确认后应用/.test(message))) return message;
    if (proposal.accepted) return "已生成 " + proposal.accepted + " 项修改建议，请在下方确认后应用。";
    if (proposal.rejected) return "模型建议未能对应到当前手册的可编辑项目，请明确栏目和条目名称。";
    return "未生成可应用的修改建议，请说明具体栏目和修改内容。";
  }

  function promptClause(prompt, startMarker, endMarkers) {
    var start = String(prompt || "").indexOf(startMarker);
    if (start < 0) return "";
    var clause = String(prompt || "").slice(start + startMarker.length);
    (endMarkers || []).forEach(function (marker) {
      var end = clause.indexOf(marker);
      if (end >= 0) clause = clause.slice(0, end);
    });
    return clause;
  }

  function parseCurveWidthRequest(prompt) {
    var text = String(prompt || "").trim();
    var match = text.match(/^(?:请)?[将把]典型曲线中(?:的)?(.+?)的曲线(?:增粗|线宽(?:设置|调整|修改)?)(?:为|到|成)\s*(\d+(?:\.\d+)?)(?:\s*(?:px|像素))?[。！!]?$/i) ||
      text.match(/^(?:请)?[将把]典型曲线中(?:的)?(.+?)的线宽(?:设置|调整|修改|改)?(?:为|到|成)\s*(\d+(?:\.\d+)?)(?:\s*(?:px|像素))?[。！!]?$/i);
    if (!match) return null;
    return {
      title: match[1].trim().replace(/^图名(?:为|是)\s*[“"'「]?/, "").replace(/[”"'」]$/, ""),
      args: { lineWidth: Number(match[2]) }
    };
  }

  function parseCurveUpdateRequest(prompt) {
    var widthRequest = parseCurveWidthRequest(prompt);
    if (widthRequest) return widthRequest;
    var text = String(prompt || "").trim().replace(/[。！!]$/, "");
    var match = text.match(/^(?:请)?[将把]典型曲线中(?:的)?(.+?)的(.+)$/);
    if (!match) return null;
    var title = match[1].trim().replace(/^图名(?:为|是)\s*[“"'「]?/, "").replace(/[”"'」]$/, "");
    var action = match[2].trim();
    var value;
    var range;
    var args = {};
    if ((value = action.match(/^字体大小(?:设置|调整|修改|设|改)?(?:为|到|成)\s*(\d+(?:\.\d+)?)$/))) {
      args.fontSize = Number(value[1]);
    } else if ((value = action.match(/^X\s*轴单位(?:设置|调整|修改|设|改)?(?:为|到|成)\s*(GHz|MHz|kHz|Hz)$/i))) {
      args.xUnit = value[1];
      args.xUnitLabel = value[1];
    } else if ((value = action.match(/^频率缩放单位(?:设置|调整|修改|设|改)?(?:为|到|成)\s*(auto|GHz|MHz|kHz|Hz)$/i))) {
      args.xUnit = value[1];
    } else if ((value = action.match(/^(?:右\s*Y|Y2)\s*轴单位(?:设置|调整|修改|设|改)?(?:为|到|成)\s*(.+)$/i))) {
      args.y2UnitLabel = value[1].trim();
    } else if ((value = action.match(/^Y\s*轴单位(?:设置|调整|修改|设|改)?(?:为|到|成)\s*(.+)$/i))) {
      args.yUnitLabel = value[1].trim();
    } else if ((value = action.match(/^图名(?:设置|调整|修改|设|改)?(?:为|到|成)\s*(.+)$/))) {
      args.title = value[1].trim();
    } else if ((range = action.match(/^(右\s*Y|Y2|X|Y)\s*轴(?:显示|截取)?范围(?:设置|调整|修改|设|改)?(?:为|到|成)\s*(-?\d+(?:\.\d+)?)\s*(GHz|MHz|kHz|Hz)?\s*[-~～—–至到]\s*(-?\d+(?:\.\d+)?)\s*(GHz|MHz|kHz|Hz)?$/i))) {
      var axis = /^右|^Y2/i.test(range[1]) ? "y2" : range[1].toLowerCase();
      args[axis + "Min"] = Number(range[2]);
      args[axis + "Max"] = Number(range[4]);
      var unit = range[3] || range[5];
      if (axis === "x" && unit) {
        args.xUnit = unit;
        args.xUnitLabel = unit;
      }
    } else {
      return null;
    }
    return { title: title, args: args };
  }

  function normalizeCurveTitle(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function resolveCurveInstruction(prompt) {
    var request = parseCurveUpdateRequest(prompt);
    if (!request) return { recognized: false };
    annotateManualStructure();
    var title = normalizeCurveTitle(request.title);
    var curves = Array.from(manual.querySelectorAll(".curve-embed"));
    var matches = curves.filter(function (embed) {
      return normalizeCurveTitle(curveTitle(embed)) === title;
    });
    if (!matches.length && /图$/.test(request.title)) {
      title = normalizeCurveTitle(request.title.slice(0, -1));
      matches = curves.filter(function (embed) {
        return normalizeCurveTitle(curveTitle(embed)) === title;
      });
    }
    if (!matches.length) {
      matches = curves.filter(function (embed) {
        return normalizeCurveTitle(curveTitle(embed)).indexOf(title + " - ") === 0;
      });
    }
    if (!matches.length) return { recognized: true, message: "当前手册的典型曲线中未找到图名“" + request.title + "”。" };
    if (matches.length !== 1) return { recognized: true, message: "找到多张同名曲线，请先用曲线编辑弹窗为目标图设置唯一图名。" };
    var payload = curvePayload(matches[0]);
    if (!curveSupportsUpdate(payload)) return { recognized: true, message: "该曲线是图片，无法通过参数设置重绘。" };
    var current = curveConfigSnapshot(payload);
    var changes = normalizedCurveChanges(request.args, current);
    if (!changes) return { recognized: true, message: "目标参数已是指定值，或输入值超出曲线编辑器允许的范围。" };
    return {
      recognized: true,
      operation: {
        op: "curve.update",
        target: matches[0].getAttribute("data-agent-curve-id"),
        args: changes,
        reason: "按图名修改典型曲线"
      }
    };
  }

  function inferOperationsFromPrompt(prompt) {
    var text = String(prompt || "").trim().replace(/^[：:·•\s]+/, "");
    var inferred = [];
    var modelMatch = text.match(/^请[把将](?:当前)?产品手册中(?:的)?全部型号(?:替换|修改|改)成\s*(NC[A-Za-z0-9]+-[A-Za-z0-9]+)[。！!]?$/i);
    if (modelMatch) return [{
      op: "manual.set_model", target: "manual", args: { model: modelMatch[1] }, reason: "统一产品手册中的型号"
    }];
    var frequencyMatch = text.match(/^请[把将](?:当前)?产品手册中(?:的)?全部(?:工作)?频率(?:范围)?(?:替换|修改|改)成\s*(\d+(?:\.\d+)?)\s*GHz\s*[-~～—–至到]\s*(\d+(?:\.\d+)?)\s*GHz[。！!]?$/i);
    if (frequencyMatch) return [{
      op: "manual.set_frequency_range", target: "manual",
      args: { startGHz: frequencyMatch[1], endGHz: frequencyMatch[2] }, reason: "统一产品手册中的工作频率范围"
    }];
    var chipNameMatch = text.match(/^请[把将](?:当前)?产品手册中(?:的)?芯片名称(?:替换|修改|改)成\s*(.+?)[。！!]?$/);
    if (chipNameMatch) return [{
      op: "manual.set_chip_name", target: "manual", args: { name: chipNameMatch[1].trim() }, reason: "修改页眉中的芯片名称"
    }];
    var featureClause = promptClause(text, "性能特点", ["产品简介"]);
    var addMatch = featureClause.match(/新增\s*([^，,。；;:：]+?)(?:这个)?(?:指标)?(?:\s*[：:]\s*([^，,。；;]+))?(?=[，,。；;]|$)/);
    if (addMatch && addMatch[1] && !duplicateFeatureLabel(addMatch[1].trim(), null)) {
      inferred.push({
        op: "feature.add",
        target: "performance-features",
        args: { label: addMatch[1].trim(), value: (addMatch[2] || "").trim() },
        reason: "根据用户指令新增性能指标"
      });
    }
    var removeMatch = featureClause.match(/删除\s*([^，,。；;:：]+?)(?:的类别|这个类别|这一项|这个)?(?:指标)?(?=[，,。；;]|$)/);
    var removeItem = removeMatch && findFeatureItem(removeMatch[1].trim());
    if (removeItem) {
      inferred.push({
        op: "feature.remove",
        target: removeItem.getAttribute("data-agent-item-id"),
        args: {},
        reason: "根据用户指令删除性能指标"
      });
    }
    var introClause = promptClause(text, "产品简介中新增", []);
    introClause = introClause.split(/[。；;]/)[0].trim();
    var introField = findField("product-intro");
    if (introClause && introField && nodeText(introField).indexOf(introClause) < 0) {
      inferred.push({
        op: "field.append_text",
        target: "product-intro",
        args: { text: introClause },
        reason: "根据用户指令补充产品简介"
      });
    }
    return inferred;
  }

  function operationMatches(left, right) {
    if (!left || !right) return false;
    var leftOp = normalizedText(left.op || left.type);
    var rightOp = normalizedText(right.op || right.type);
    if (leftOp === "feature.delete" || leftOp === "feature.delete_item") leftOp = "feature.remove";
    if (rightOp === "feature.delete" || rightOp === "feature.delete_item") rightOp = "feature.remove";
    if (leftOp === "append_text" || leftOp === "field.append") leftOp = "field.append_text";
    if (rightOp === "append_text" || rightOp === "field.append") rightOp = "field.append_text";
    if ((leftOp === "field.set_text" || leftOp === "field.append_text") &&
        (rightOp === "field.set_text" || rightOp === "field.append_text")) {
      return normalizedText(left.target || left.id) === normalizedText(right.target || right.id);
    }
    if (leftOp !== rightOp) return false;
    var leftArgs = left.args && typeof left.args === "object" ? left.args : {};
    var rightArgs = right.args && typeof right.args === "object" ? right.args : {};
    if (leftOp === "feature.add") {
      return normalizedText(leftArgs.label || left.label) === normalizedText(rightArgs.label || right.label);
    }
    if (leftOp === "feature.remove") {
      return normalizedText(left.target || left.id).replace(/^feature:/, "") ===
        normalizedText(right.target || right.id).replace(/^feature:/, "");
    }
    return normalizedText(left.target || left.id) === normalizedText(right.target || right.id);
  }

  async function sendPrompt(prompt) {
    var requestEpoch = conversationEpoch;
    var controller = null;
    addMessage(prompt, "user");
    var previousHistory = history.slice(-4);
    while (previousHistory.length && previousHistory.reduce(function (size, item) {
      return size + item.content.length;
    }, 0) > 1200) previousHistory.shift();
    history.push({ role: "user", content: prompt });
    setBusy(true);
    proposalNode.hidden = true;
    pendingOperations = [];
    try {
      var curveInstruction = resolveCurveInstruction(prompt);
      if (curveInstruction.recognized) {
        var curveOperations = curveInstruction.operation ? [curveInstruction.operation] : [];
        var curveProposal = renderProposal(curveOperations);
        var curveResult = {
          message: curveInstruction.message || (curveProposal.accepted
            ? "已按图名定位典型曲线，请确认修改建议。"
            : "曲线设置无效，或目标参数已是指定值。"),
          operations: curveOperations
        };
        addMessage(curveResult.message, "assistant");
        history.push({ role: "assistant", content: JSON.stringify(curveResult) });
        return;
      }
      var curveReadout = curveFrequencyReadout(prompt);
      if (curveReadout) {
        addMessage(curveReadout, "assistant");
        history.push({ role: "assistant", content: JSON.stringify({ message: curveReadout, operations: [] }) });
        return;
      }
      var curveQuestion = isCurveQuestion(prompt);
      var curveSummary = curveQuestion ? curveQuestionSummary(prompt) : null;
      if (curveQuestion && !curveSummary) {
        var noCurveMessage = "当前手册没有可读取的曲线数据，请先导入 S 参数并生成曲线。";
        addMessage(noCurveMessage, "assistant");
        history.push({ role: "assistant", content: JSON.stringify({ message: noCurveMessage, operations: [] }) });
        return;
      }
      if (curveQuestion && curveSummary.needsSelection) {
        var selectCurveMessage = "当前有 " + curveSummary.totalCharts + " 张匹配的曲线，请在问题中指定曲线标题。" +
          "可选标题：" + curveSummary.titles.join("、") + "。";
        addMessage(selectCurveMessage, "assistant");
        history.push({ role: "assistant", content: JSON.stringify({ message: selectCurveMessage, operations: [] }) });
        return;
      }
      if (connectionCheckController) connectionCheckController.abort();
      connectionCheckController = null;
      var config = await requestJson("/api/agent/config");
      if (requestEpoch !== conversationEpoch) return;
      applyPublicConfig(config);
      if (!config.configured) throw new Error("模型未配置，请在后端配置 APP_LLM_MODEL。");
      var requestMessages;
      if (isGeneralQuestion(prompt)) {
        requestMessages = [
          { role: "system", content: shortSystemPrompt },
          { role: "user", content: prompt }
        ];
      } else if (curveQuestion) {
        requestMessages = [
          { role: "system", content: curveQuestionSystemPrompt },
          { role: "user", content: "用户问题：\n" + prompt + "\n\n曲线数据摘要：\n" + JSON.stringify(curveSummary) }
        ];
      } else {
        var snapshot = manualSnapshot();
        requestMessages = [{ role: "system", content: defaultSystemPrompt }]
          .concat(previousHistory).concat([{
            role: "user",
            content: "用户要求：\n" + prompt +
              "\n\n当前手册结构（fields 为 [章节, [[id,文字],...]]）：\n" + JSON.stringify(snapshot)
          }]);
      }
      controller = new AbortController();
      activeChatController = controller;
      var data = await requestJson("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages }),
        signal: controller.signal
      });
      if (requestEpoch !== conversationEpoch) return;
      var result = parseModelContent(data.content);
      var modelOperations = curveQuestion ? [] : resultOperations(result);
      var inferredOperations = curveQuestion ? [] : inferOperationsFromPrompt(prompt);
      var exactManualInstruction = inferredOperations.length === 1 && /^manual\.set_/.test(inferredOperations[0].op);
      if (exactManualInstruction) {
        var currentEdits = buildManualEdits(inferredOperations[0]);
        if (currentEdits && !currentEdits.length) inferredOperations = [];
      }
      var combinedOperations = exactManualInstruction ? [] : modelOperations.slice();
      inferredOperations.forEach(function (inferred) {
        if (!combinedOperations.some(function (existing) { return operationMatches(existing, inferred); })) {
          combinedOperations.push(inferred);
        }
      });
      var proposal = renderProposal(combinedOperations);
      if (exactManualInstruction) {
        result.operations = combinedOperations;
        result.message = proposal.accepted ? "已定位手册中的目标位置，请确认修改建议。" : "手册中的目标内容已是指定值，或当前页面没有对应内容。";
      } else if (inferredOperations.length && combinedOperations.length > modelOperations.length) {
        result.operations = combinedOperations;
        result.message = modelOperations.length
          ? "已补充用户原句中未覆盖的明确修改。"
          : "模型未返回完整可执行 JSON，已按用户明确指令补充修改建议。";
      }
      var answer = resultMessage(result, proposal);
      addMessage(answer, "assistant");
      if (proposal.accepted) proposalNode.scrollIntoView({ block: "nearest", behavior: "smooth" });
      history.push({ role: "assistant", content: JSON.stringify(result) });
      if (proposal.rejected) {
        addMessage("有 " + proposal.rejected + " 项操作因目标不存在、内容重复或参数不合法而未进入修改建议。", "error");
      }
      setStatus("调用成功 · " + (data.model || modelName) + " · " + data.elapsedMs + " ms", "is-ready");
    } catch (error) {
      if (requestEpoch !== conversationEpoch || (controller && controller.signal.aborted)) return;
      addMessage(error.message || String(error), "error");
      setStatus(error.message && error.message.indexOf("模型未配置") === 0
        ? "模型未配置，请在后端配置 APP_LLM_MODEL"
        : "模型连接异常", "is-error");
    } finally {
      if (activeChatController === controller) activeChatController = null;
      if (requestEpoch === conversationEpoch) {
        setBusy(false);
        input.focus();
      }
    }
  }

  newChatButton.addEventListener("click", startNewConversation);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var prompt = input.value.trim();
    if (!prompt) return;
    input.value = "";
    sendPrompt(prompt);
  });

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  panel.querySelector("[data-agent-apply]").addEventListener("click", function () {
    var applied = 0;
    var skipped = 0;
    pendingOperations.forEach(function (operation) {
      if (applyOperation(operation)) applied += 1;
      else skipped += 1;
    });
    if (applied) persistAppliedOperations();
    proposalNode.hidden = true;
    pendingOperations = [];
    var message = "已应用 " + applied + " 项修改。";
    if (skipped) message += "另有 " + skipped + " 项因手册内容已变化或校验失败而跳过。";
    addMessage(message, skipped ? "error" : "assistant");
  });

  panel.querySelector("[data-agent-discard]").addEventListener("click", function () {
    proposalNode.hidden = true;
    pendingOperations = [];
  });

  annotateManualStructure();
  checkModelConnection();
  window.ProductManualAgentDispose = function () {
    conversationEpoch += 1;
    if (connectionCheckController) connectionCheckController.abort();
    connectionCheckController = null;
    if (activeChatController) activeChatController.abort();
    activeChatController = null;
  };
}());
