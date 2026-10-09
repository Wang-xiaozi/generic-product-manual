    (function () {
      "use strict";

      var currentImageZone = null;
      var activeImageResize = null;
      var currentTableImportTarget = null;
      var selectedCell = null;
      var imageInput = document.getElementById("imageInput");
      var tableImportInput = document.getElementById("tableImportInput");
      var manual = document.getElementById("manual");
      var initialManualHtml = manual.innerHTML;
      var pageStore = {};
      var activePageId = null;
      var nodeIdSeed = 0;
      var selectedTreeNode = null;
      var activeTreeNode = null;
      var lastManualEditable = null;
      var imageInputBound = false;
      var tableImportInputBound = false;
      var boundTables = new WeakSet();
      var boundTableBlocks = new WeakSet();
      var boundImageZones = new WeakSet();
      var boundManualImageLoads = new WeakSet();
      var boundCurveRemoveButtons = new WeakSet();
      var boundCurveEmbeds = new WeakSet();
      var boundCurveLists = new WeakSet();
      var boundHeaderFields = new WeakSet();
      var isPaginating = false;
      var paginationTimer = null;
      var paginationJobSeed = 0;
      var autosaveTimer = null;
      var globalListeners = [];
      var fixedFooterText = "产品手册  ◆  技术支持信息请自行填写";
      var snpDirectoryPath = window.ProductManualApi.snpDirectoryPath || "";
      var snpFileManifest = window.manualSnpFiles || [];
      var curveResources = [];
      var selectedCurveIds = new Set();
      var selectedCurveIndex = 0;
      var selectedCurveEmbed = null;
      var curveReadBatchId = 0;
      var toolContext = null;
      var featureFields = [
        { key: "频率范围", aliases: ["频率范围"] },
        { key: "增益", aliases: ["增益"] },
        { key: "噪声系数", aliases: ["噪声系数", "噪声"] },
        { key: "输出1dB压缩功率", aliases: ["输出1dB压缩功率", "输出1db压缩功率", "输出1 dB压缩功率", "P-1", "P1dB", "P₁dB"] },
        { key: "直流供电", aliases: ["直流供电", "供电", "电源"] },
        { key: "芯片尺寸", aliases: ["芯片尺寸", "尺寸"] }
      ];
      var lnaDcRows = [
        { key: "漏极工作电压", aliases: ["漏极工作电压", "漏源工作电压", "工作电压", "Vd"], symbol: "Vd", unit: "V" },
        { key: "静态漏极电流", aliases: ["静态漏极电流", "漏极电流", "静态电流", "Id"], symbol: "Id", unit: "mA" }
      ];
      var lnaMicrowaveRows = [
        { key: "频率范围", aliases: ["频率范围", "工作频率范围"], symbol: "f", unit: "GHz" },
        { key: "增益", aliases: ["增益", "线性增益"], symbol: "Gain", unit: "dB" },
        { key: "增益平坦度", aliases: ["增益平坦度", "增益波动", "Gain Flatness"], symbol: "△Gain", unit: "dB" },
        { key: "噪声系数", aliases: ["噪声系数", "带内噪声系数", "内带噪声系数", "NF", "Nf"], symbol: "NF", unit: "dB" },
        { key: "输出1dB压缩功率", aliases: ["输出1dB压缩功率", "输出1db压缩功率", "输出 1dB 压缩功率", "P1dB", "P-1", "P₁dB"], symbol: "P1dB", unit: "dBm" },
        { key: "输入驻波", aliases: ["输入驻波", "输入驻波比", "VSWR(in)", "VSWRin"], symbol: "VSWR(in)", unit: "-" },
        { key: "输出驻波", aliases: ["输出驻波", "输出驻波比", "VSWR(out)", "VSWRout"], symbol: "VSWR(out)", unit: "-" }
      ];
      var paginationAnchorTitles = [
        "性能特点",
        "产品简介",
        "直流电参数",
        "微波电参数",
        "使用限制参数",
        "典型曲线",
        "外形尺寸",
        "键合压点定义",
        "建议装配图",
        "注意事项"
      ];
      var importableTableTitles = [
        "直流电参数",
        "微波电参数",
        "使用限制参数",
        "键合压点定义"
      ];

      function addGlobalListener(type, handler) {
        document.addEventListener(type, handler);
        globalListeners.push({ type: type, handler: handler });
      }

      function makeCellsEditable(scope) {
        scope.querySelectorAll("th, td").forEach(function (cell) {
          cell.setAttribute("contenteditable", "true");
        });
      }

      function escapeHtml(value) {
        var holder = document.createElement("div");
        holder.textContent = value == null ? "" : String(value);
        return holder.innerHTML;
      }

      function curveFileNameFromPath(pathValue) {
        var value = String(pathValue || "").replace(/\\/g, "/");
        var parts = value.split("/");
        return parts[parts.length - 1] || "未命名曲线";
      }

      function curveFileStem(pathValue) {
        return curveFileNameFromPath(pathValue).replace(/\.[^.]+$/, "");
      }

      function isSupportedSnpFile(pathValue) {
        return /\.s\d+p$/i.test(String(pathValue || "")) || /\.snp$/i.test(String(pathValue || ""));
      }

      function numberOrNull(value) {
        if (value == null || String(value).trim() === "") return null;
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }

      function clampNumber(value, min, max, fallback) {
        var parsed = numberOrNull(value);
        if (parsed == null) return fallback;
        return Math.max(min, Math.min(max, parsed));
      }

      function cleanNumber(value) {
        return Number.isFinite(value) ? Number(Number(value).toPrecision(12)) : null;
      }

      function parseTouchstoneNumber(value) {
        return Number(String(value || "").replace(/[dD]/g, "E"));
      }

      function detectTouchstonePortCount(fileName, text) {
        var extensionMatch = /\.s(\d+)p$/i.exec(fileName || "");
        if (extensionMatch) return Number(extensionMatch[1]) || 2;
        var keywordMatch = /\[\s*Number\s+of\s+Ports\s*\]\s*(\d+)/i.exec(text || "");
        if (keywordMatch) return Number(keywordMatch[1]) || 2;
        return 2;
      }

      function parseTouchstoneOption(line, option) {
        var tokens = String(line || "").replace(/^#/, "").trim().split(/\s+/);
        for (var i = 0; i < tokens.length; i += 1) {
          var token = tokens[i].toUpperCase();
          if (/^(HZ|KHZ|MHZ|GHZ)$/.test(token)) option.frequencyUnit = token;
          if (/^(S|Y|Z|G|H)$/.test(token)) option.parameterType = token;
          if (/^(MA|DB|RI)$/.test(token)) option.format = token;
          if (token === "R" && i + 1 < tokens.length) {
            option.resistance = parseTouchstoneNumber(tokens[i + 1]) || option.resistance;
            i += 1;
          }
        }
      }

      function frequencyScale(unit) {
        var normalized = String(unit || "HZ").toUpperCase();
        if (normalized === "GHZ") return 1e9;
        if (normalized === "MHZ") return 1e6;
        if (normalized === "KHZ") return 1e3;
        return 1;
      }

      function touchstoneParameterOrder(portCount) {
        var order = [];
        for (var column = 1; column <= portCount; column += 1) {
          for (var row = 1; row <= portCount; row += 1) {
            order.push("S" + row + column);
          }
        }
        return order;
      }

      function touchstonePairToComplex(first, second, format) {
        var angle;
        var magnitude;
        if (format === "RI") {
          return [cleanNumber(first), cleanNumber(second)];
        }
        angle = second * Math.PI / 180;
        magnitude = format === "DB" ? Math.pow(10, first / 20) : first;
        return [cleanNumber(magnitude * Math.cos(angle)), cleanNumber(magnitude * Math.sin(angle))];
      }

      function parseTouchstoneText(fileName, text) {
        var option = { frequencyUnit: "GHZ", parameterType: "S", format: "MA", resistance: 50 };
        var portCount = detectTouchstonePortCount(fileName, text);
        var order = touchstoneParameterOrder(portCount);
        var rowSize = 1 + order.length * 2;
        var pending = [];
        var rows = [];

        String(text || "").replace(/\r/g, "").split("\n").forEach(function (rawLine) {
          var line = rawLine.split("!")[0].trim();
          var numbers;
          if (!line) return;
          if (line.charAt(0) === "#") {
            parseTouchstoneOption(line, option);
            return;
          }
          if (line.charAt(0) === "[") return;
          numbers = line.split(/\s+/).map(parseTouchstoneNumber).filter(Number.isFinite);
          if (!numbers.length) return;
          pending = pending.concat(numbers);
          while (pending.length >= rowSize) {
            var rowTokens = pending.splice(0, rowSize);
            var row = { f: cleanNumber(rowTokens[0] * frequencyScale(option.frequencyUnit)), p: {} };
            order.forEach(function (parameterName, index) {
              var offset = 1 + index * 2;
              row.p[parameterName] = touchstonePairToComplex(rowTokens[offset], rowTokens[offset + 1], option.format);
            });
            rows.push(row);
          }
        });

        if (option.parameterType !== "S") {
          throw new Error("仅支持 S 参数 Touchstone 文件");
        }
        if (!rows.length) {
          throw new Error("未解析到有效 S 参数数据");
        }
        return {
          ports: portCount,
          option: option,
          parameters: order,
          rows: rows
        };
      }

      function complexMagnitude(value) {
        if (!value || value.length < 2) return null;
        return Math.sqrt(value[0] * value[0] + value[1] * value[1]);
      }

      function complexDb(value) {
        var magnitude = complexMagnitude(value);
        return magnitude && magnitude > 0 ? 20 * Math.log(magnitude) / Math.LN10 : null;
      }

      function complexPhaseDeg(value) {
        if (!value || value.length < 2) return null;
        return Math.atan2(value[1], value[0]) * 180 / Math.PI;
      }

      function complexVswr(value) {
        var magnitude = complexMagnitude(value);
        if (magnitude == null || magnitude >= 1) return null;
        return (1 + magnitude) / (1 - magnitude);
      }

      var curvePalette = ["#111111", "#ff0000", "#003cff", "#008000", "#7a3db8", "#d47a00"];
      var temperatureSeriesOrder = [-55, 25, 125];
      var voltageSeriesOrder = [4.5, 5, 5.5];
      var manualCurveTemplates = {
        "gain_vswr": {
          title: "增益和输入输出驻波",
          kind: "s",
          mode: "single",
          xLabel: "Freq(GHz)",
          yLabel: "Gain(dB)",
          y2Label: "VSWR",
          legend: "left",
          dualAxis: true
        },
        "wide_gain": {
          title: "宽带线性增益 vs.频率",
          kind: "s",
          mode: "single",
          xLabel: "Freq(GHz)",
          yLabel: "Gain(dB)",
          legend: "right"
        },
        "gain_temp": {
          title: "增益 vs.温度",
          kind: "s",
          groupBy: "temperature",
          mode: "group",
          metric: "gain",
          xLabel: "Freq(GHz)",
          yLabel: "Gain(dB)",
          legend: "right"
        },
        "gain_voltage": {
          title: "增益 vs.电压",
          kind: "s",
          groupBy: "voltage",
          mode: "group",
          metric: "gain",
          xLabel: "Freq(GHz)",
          yLabel: "Gain(dB)",
          legend: "right"
        },
        "nf_frequency": {
          title: "噪声系数 vs.频率",
          kind: "nf",
          mode: "single",
          metric: "nf",
          xLabel: "Freq(GHz)",
          yLabel: "NF(dB)",
          legend: "right"
        },
        "nf_temp": {
          title: "噪声系数 vs.温度",
          kind: "nf",
          groupBy: "temperature",
          mode: "group",
          metric: "nf",
          xLabel: "Freq(GHz)",
          yLabel: "NF(dB)",
          legend: "right"
        },
        "vswr_in_temp": {
          title: "输入驻波 vs.温度",
          kind: "s",
          groupBy: "temperature",
          mode: "group",
          metric: "vswr_in",
          xLabel: "Freq(GHz)",
          yLabel: "VSWR(in)",
          legend: "center"
        },
        "vswr_out_temp": {
          title: "输出驻波 vs.温度",
          kind: "s",
          groupBy: "temperature",
          mode: "group",
          metric: "vswr_out",
          xLabel: "Freq(GHz)",
          yLabel: "VSWR(out)",
          legend: "center"
        },
        "iso_temp": {
          title: "反向隔离 vs.温度",
          kind: "s",
          groupBy: "temperature",
          mode: "group",
          metric: "iso",
          xLabel: "Freq(GHz)",
          yLabel: "ISO(dB)",
          legend: "center"
        },
        "p1db_frequency": {
          title: "输出 1dB 压缩点功率 vs.频率",
          kind: "p",
          mode: "single",
          metric: "p1db",
          xLabel: "Freq(GHz)",
          yLabel: "P1dB(dBm)",
          legend: "right"
        },
        "p1db_temp": {
          title: "P1dB vs.温度",
          kind: "p",
          groupBy: "temperature",
          mode: "group",
          metric: "p1db",
          xLabel: "Freq(GHz)",
          yLabel: "P1dB(dBm)",
          legend: "center"
        }
      };

      function classifyCurveKind(pathValue) {
        var name = curveFileNameFromPath(pathValue).toUpperCase();
        if (/NF\.S\d+P$/.test(name)) return "nf";
        if (/P\.S\d+P$/.test(name)) return "p";
        return "s";
      }

      function detectCurveTemperature(pathValue) {
        var text = String(pathValue || "").toUpperCase().replace(/\\/g, "/");
        if (/(^|[^0-9])[-_]?55(C|℃)([^0-9]|$)/.test(text) || /N55C/.test(text) || /LOW[_-]?TEMP/.test(text) || /(^|\/)A4(\/|$)/.test(text)) return -55;
        if (/(^|[^0-9])125(C|℃)([^0-9]|$)/.test(text) || /HIGH[_-]?TEMP/.test(text) || /(^|\/)A6(\/|$)/.test(text)) return 125;
        if (/0025C/.test(text) || /025C/.test(text) || /NORMAL[_-]?TEMP/.test(text) || /(^|[^0-9])25(C|℃)([^0-9]|$)/.test(text) || /\+25/.test(text) || /(^|\/)A5(\/|$)/.test(text)) return 25;
        return null;
      }

      function detectCurveVoltage(pathValue) {
        var text = String(pathValue || "").toUpperCase();
        var decimalMatch = /([0-9])P([0-9])V/.exec(text);
        var integerMatch;
        if (decimalMatch) return Number(decimalMatch[1] + "." + decimalMatch[2]);
        integerMatch = /(^|[^0-9])0*([1-9][0-9]?)V([^0-9]|$)/.exec(text);
        if (integerMatch) return Number(integerMatch[2]);
        return null;
      }

      function curveKindLabel(kind) {
        if (kind === "nf") return "NF";
        if (kind === "p") return "P1dB";
        return "S 参数";
      }

      function curveTemperatureLabel(value) {
        if (value == null) return "";
        return (value > 0 ? "+" : "") + value + "℃";
      }

      function curveVoltageLabel(value) {
        if (value == null) return "";
        return Number(value).toString().replace(/\.0$/, "") + "V";
      }

      function curveSeriesLabel(resource) {
        if (!resource) return "";
        if (resource.temperature != null) return curveTemperatureLabel(resource.temperature);
        if (resource.voltage != null) return curveVoltageLabel(resource.voltage);
        return curveFileStem(resource.name || resource.sourcePath || "");
      }

      function curveTextFingerprint(text) {
        var value = String(text || "").replace(/\r\n?/g, "\n").trim();
        var hash = 2166136261;
        for (var index = 0; index < value.length; index += 1) {
          hash ^= value.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
        return value.length.toString(36) + "-" + (hash >>> 0).toString(36);
      }

      function curveResourceImportKey(resource) {
        var location = String(resource && (resource.sourcePath || resource.name) || "").replace(/\\/g, "/").toLowerCase();
        var fingerprint = resource && resource.importFingerprint ? String(resource.importFingerprint) : "";
        if (fingerprint) return location + "::" + fingerprint;
        return location || String(resource && resource.id || "");
      }

      function normalizeSnpResource(item, index) {
        var sourcePath;
        var text;
        var network;
        var name;
        var normalized;
        if (!item) return null;
        if (typeof item === "string") return null;
        sourcePath = item.sourcePath || item.path || item.webkitRelativePath || item.name || "";
        name = item.name || curveFileNameFromPath(sourcePath);
        text = item.text || item.content || "";
        network = item.network || null;
        if (!network && text) {
          network = parseTouchstoneText(name || sourcePath, text);
        }
        if (!network || !network.rows || !network.rows.length) return null;
        normalized = {
          id: item.id || ("snp-" + Date.now().toString(36) + "-" + index),
          name: name || ("SNP 文件 " + (index + 1)),
          sourcePath: sourcePath || name || "",
          importFingerprint: item.importFingerprint || item.fingerprint || (text ? curveTextFingerprint(text) : ""),
          network: network
        };
        normalized.kind = item.kind || classifyCurveKind(normalized.sourcePath || normalized.name);
        normalized.temperature = item.temperature != null ? item.temperature : detectCurveTemperature(normalized.sourcePath || normalized.name);
        normalized.voltage = item.voltage != null ? item.voltage : detectCurveVoltage(normalized.sourcePath || normalized.name);
        normalized.seriesLabel = item.seriesLabel || curveSeriesLabel(normalized);
        return normalized;
      }

      function resourceFrequencySummary(resource) {
        var rows = resource && resource.network && resource.network.rows ? resource.network.rows : [];
        var first = rows[0];
        var last = rows[rows.length - 1];
        var scale = 1e9;
        if (!first || !last) return "";
        return formatAxisValue(first.f / scale) + "～" + formatAxisValue(last.f / scale) + "GHz，" + rows.length + "点";
      }

      function setCurveResources(resources) {
        var normalized = [];
        (resources || []).forEach(function (item, index) {
          var resource;
          try {
            resource = normalizeSnpResource(item, index);
          } catch (error) {
            resource = null;
          }
          if (resource) normalized.push(resource);
        });
        curveResources = normalized;
        selectedCurveIds.clear();
        selectedCurveIndex = curveResources.length ? Math.min(selectedCurveIndex, curveResources.length - 1) : 0;
        renderCurveList();
      }

      function appendCurveResources(resources) {
        var existing = curveResources.slice();
        var keys = new Set();
        var added = 0;
        existing.forEach(function (resource) {
          keys.add(curveResourceImportKey(resource));
        });
        (resources || []).forEach(function (item, index) {
          var resource;
          var key;
          try {
            resource = normalizeSnpResource(item, curveResources.length + index);
          } catch (error) {
            resource = null;
          }
          if (!resource) return;
          key = curveResourceImportKey(resource);
          if (keys.has(key)) return;
          keys.add(key);
          existing.push(resource);
          added += 1;
        });
        curveResources = existing;
        selectedCurveIndex = added ? (curveResources.length - added) : (curveResources.length ? Math.min(selectedCurveIndex, curveResources.length - 1) : 0);
        renderCurveList();
        return added;
      }

      function deleteSelectedCurveResources() {
        var selectedKeys = new Set(selectedCurveIds);
        var deletedCount = 0;
        if (!selectedKeys.size) {
          setCurveStatus("请先勾选要删除的 S 参数文件", true);
          return 0;
        }
        curveResources = curveResources.filter(function (resource) {
          if (!selectedKeys.has(curveResourceSelectionKey(resource))) return true;
          deletedCount += 1;
          return false;
        });
        selectedCurveIds.clear();
        selectedCurveIndex = curveResources.length ? Math.min(selectedCurveIndex, curveResources.length - 1) : 0;
        renderCurveList();
        setCurveStatus("已删除 " + deletedCount + " 个已选择的 S 参数文件，剩余 " + curveResources.length + " 个", false);
        return deletedCount;
      }

      function curveResourceSelectionKey(resource) {
        return resource && resource.id ? String(resource.id) : "";
      }

      function selectedCurveResources() {
        return curveResources.filter(function (resource) {
          return selectedCurveIds.has(curveResourceSelectionKey(resource));
        });
      }

      function setCurveResourceSelected(index, isSelected) {
        var numericIndex = Number(index);
        var resource = curveResources[numericIndex];
        var key = curveResourceSelectionKey(resource);
        if (!key) return;
        if (isSelected) {
          selectedCurveIds.add(key);
          selectedCurveIndex = numericIndex;
        } else {
          selectedCurveIds.delete(key);
        }
      }

      function toggleAllCurveResources() {
        var selected = selectedCurveResources();
        selectedCurveIds.clear();
        if (selected.length !== curveResources.length) {
          curveResources.forEach(function (resource) {
            selectedCurveIds.add(curveResourceSelectionKey(resource));
          });
        }
      }

      function normalizeFeatureKey(value) {
        return String(value || "")
          .replace(/[\uFEFF\u00A0]/g, "")
          .replace(/[：:\s\r\n\t]/g, "")
          .replace(/[（）()\[\]【】]/g, "")
          .replace(/[._－—–-]/g, "")
          .toLowerCase();
      }

      function featureFieldByName(name) {
        var normalized = normalizeFeatureKey(name);
        if (!normalized) return null;
        return featureFields.find(function (field) {
          return field.aliases.some(function (alias) {
            return normalizeFeatureKey(alias) === normalized;
          });
        }) || null;
      }

      function splitFeatureText(text) {
        var raw = String(text || "").trim();
        if (!raw) return null;
        var colonIndex = raw.search(/[：:]/);
        if (colonIndex !== -1) {
          var field = featureFieldByName(raw.slice(0, colonIndex));
          if (field) {
            return {
              key: field.key,
              value: raw.slice(colonIndex + 1).trim()
            };
          }
        }
        for (var i = 0; i < featureFields.length; i += 1) {
          var aliases = featureFields[i].aliases;
          for (var j = 0; j < aliases.length; j += 1) {
            if (normalizeFeatureKey(raw).indexOf(normalizeFeatureKey(aliases[j])) === 0) {
              return {
                key: featureFields[i].key,
                value: raw.slice(aliases[j].length).replace(/^[：:\s]+/, "").trim()
              };
            }
          }
        }
        return null;
      }

      function featureListIsStructured(list) {
        var nodes = Array.from(list.querySelectorAll("[data-feature-value]"));
        return featureFields.every(function (field) {
          return nodes.some(function (node) {
            return normalizeFeatureKey(node.dataset.featureValue) === normalizeFeatureKey(field.key);
          });
        });
      }

      function collectFeatureValues(list) {
        var values = {};
        list.querySelectorAll("[data-feature-value]").forEach(function (node) {
          var field = featureFieldByName(node.dataset.featureValue);
          if (field) values[field.key] = node.textContent.trim();
        });
        list.querySelectorAll("li").forEach(function (item) {
          if (item.querySelector("[data-feature-value]")) return;
          var pair = splitFeatureText(item.textContent);
          if (pair) values[pair.key] = pair.value;
        });
        return values;
      }

      function rebuildFeatureList(list, values) {
        list.classList.remove("editable");
        list.removeAttribute("contenteditable");
        list.dataset.featureList = "true";
        list.innerHTML = "";
        featureFields.forEach(function (field) {
          var item = document.createElement("li");
          var label = document.createElement("span");
          var value = document.createElement("span");
          item.dataset.featureKey = field.key;
          label.className = "feature-label";
          label.textContent = field.key + "：";
          value.className = "feature-value editable";
          value.contentEditable = "true";
          value.dataset.featureValue = field.key;
          if (values && values[field.key]) {
            value.textContent = values[field.key];
          } else {
            markEditablePlaceholder(value, "点击填写内容");
          }
          item.appendChild(label);
          item.appendChild(value);
          list.appendChild(item);
        });
      }

      function ensurePerformanceFeatureLists(scope) {
        (scope || document).querySelectorAll(".feature-list").forEach(function (list) {
          list.classList.remove("editable");
          list.removeAttribute("contenteditable");
          list.dataset.featureList = "true";
          if (!featureListIsStructured(list)) {
            rebuildFeatureList(list, collectFeatureValues(list));
          }
        });
      }

      function featureValueNodes(scope, key) {
        var field = featureFieldByName(key);
        if (!field) return [];
        return Array.from((scope || document).querySelectorAll("[data-feature-value]")).filter(function (node) {
          return normalizeFeatureKey(node.dataset.featureValue) === normalizeFeatureKey(field.key);
        });
      }

      function cleanSpreadsheetValue(value) {
        return String(value == null ? "" : value).replace(/\u00A0/g, " ").trim();
      }

      function rowsToFeatureData(rows) {
        var data = {};
        (rows || []).forEach(function (row) {
          if (!row || !row.length) return;
          var keyCell = cleanSpreadsheetValue(row[0]);
          var valueCell = row.slice(1).map(cleanSpreadsheetValue).filter(Boolean).join(" ");
          var field = featureFieldByName(keyCell);
          var colonIndex = keyCell.search(/[：:]/);
          if (!field && colonIndex !== -1) {
            field = featureFieldByName(keyCell.slice(0, colonIndex));
            if (!valueCell) valueCell = keyCell.slice(colonIndex + 1).trim();
          }
          if (field && valueCell) data[field.key] = valueCell;
        });
        return data;
      }

      function normalizeSpecKey(value) {
        return normalizeFeatureKey(value).replace(/[＊*]/g, "");
      }

      function cleanSpecValue(value) {
        return cleanSpreadsheetValue(value).replace(/[＊*]+$/g, "").trim();
      }

      function isBlankSpecValue(value) {
        return cleanSpecValue(value) === "";
      }

      function dashSpecValue(value) {
        var cleaned = cleanSpecValue(value);
        return cleaned ? normalizeRangeText(cleaned) : "-";
      }

      function findColumnIndex(header, aliases) {
        var normalizedAliases = aliases.map(normalizeSpecKey);
        var index = -1;
        (header || []).some(function (cell, cellIndex) {
          if (normalizedAliases.indexOf(normalizeSpecKey(cell)) === -1) return false;
          index = cellIndex;
          return true;
        });
        return index;
      }

      function headerLooksLikeLnaSpec(row) {
        return findColumnIndex(row, ["指标", "参数"]) !== -1 &&
          findColumnIndex(row, ["典型值", "典型"]) !== -1;
      }

      function rowsToLnaManualData(rows) {
        var cleanRows = (rows || []).map(function (row) {
          return (row || []).map(cleanSpreadsheetValue);
        });
        var headerIndex = -1;
        var header = [];
        var columns;
        var data = {
          fixedFormat: false,
          params: {}
        };

        cleanRows.some(function (row, index) {
          if (!headerLooksLikeLnaSpec(row)) return false;
          headerIndex = index;
          header = row;
          return true;
        });
        if (headerIndex === -1) return data;

        columns = {
          name: findColumnIndex(header, ["指标", "参数"]),
          typical: findColumnIndex(header, ["典型值", "典型"]),
          min: findColumnIndex(header, ["最小值", "最小"]),
          max: findColumnIndex(header, ["最大值", "最大"]),
          unit: findColumnIndex(header, ["单位"]),
          symbol: findColumnIndex(header, ["符号"]),
          module: findColumnIndex(header, ["显示模块", "模块"]),
          remark: findColumnIndex(header, ["备注"])
        };

        cleanRows.slice(headerIndex + 1).forEach(function (row) {
          var name = columns.name >= 0 ? cleanSpecValue(row[columns.name]) : "";
          var record;
          if (!name) return;
          record = {
            name: name,
            typical: columns.typical >= 0 ? cleanSpecValue(row[columns.typical]) : "",
            min: columns.min >= 0 ? cleanSpecValue(row[columns.min]) : "",
            max: columns.max >= 0 ? cleanSpecValue(row[columns.max]) : "",
            unit: columns.unit >= 0 ? cleanSpecValue(row[columns.unit]) : "",
            symbol: columns.symbol >= 0 ? cleanSpecValue(row[columns.symbol]) : "",
            module: columns.module >= 0 ? cleanSpecValue(row[columns.module]) : "",
            remark: columns.remark >= 0 ? cleanSpecValue(row[columns.remark]) : ""
          };
          data.params[normalizeSpecKey(name)] = record;
        });

        data.fixedFormat = Object.keys(data.params).length > 0;
        return data;
      }

      function paramByAliases(manualData, aliases) {
        var params = manualData && manualData.params ? manualData.params : {};
        var found = null;
        (aliases || []).some(function (alias) {
          var key = normalizeSpecKey(alias);
          if (!params[key]) return false;
          found = params[key];
          return true;
        });
        return found;
      }

      function paramByConfig(manualData, config) {
        return paramByAliases(manualData, [config.key].concat(config.aliases || []));
      }

      function normalizeRangeText(value) {
        var text = String(value || "").trim();
        var simpleRange = /^([+]?\d+(?:\.\d+)?)\s*[-~]\s*([+]?\d+(?:\.\d+)?)$/.exec(text);
        if (simpleRange) return simpleRange[1] + "～" + simpleRange[2];
        return text.replace(/\s*[~]\s*/g, "～");
      }

      function normalizeUnitText(unit, fallback) {
        var cleaned = cleanSpecValue(unit);
        if (!cleaned && fallback) cleaned = fallback;
        if (!cleaned) return "";
        return cleaned.replace(/\*/g, "×");
      }

      function valueAlreadyHasUnit(value, unit) {
        if (!value || !unit || unit === "-") return false;
        return normalizeSpecKey(value).indexOf(normalizeSpecKey(unit)) !== -1;
      }

      function formatRangeWithUnit(value, unit) {
        var text = normalizeRangeText(cleanSpecValue(value));
        var normalizedUnit = normalizeUnitText(unit);
        var parts;
        if (!text) return "-";
        if (!normalizedUnit || normalizedUnit === "-" || valueAlreadyHasUnit(text, normalizedUnit)) return text;
        parts = text.split("～");
        if (parts.length === 2) return parts[0] + normalizedUnit + "～" + parts[1] + normalizedUnit;
        return text + normalizedUnit;
      }

      function formatValueWithUnit(record, valueKey, fallbackUnit, options) {
        var value = record ? record[valueKey || "typical"] : "";
        var unit = normalizeUnitText(record && record.unit, fallbackUnit);
        var text = normalizeRangeText(cleanSpecValue(value));
        if (!text) return "-";
        if (!unit || unit === "-" || valueAlreadyHasUnit(text, unit)) return text;
        if (options && options.rangeUnitEachSide) return formatRangeWithUnit(text, unit);
        return text + unit;
      }

      function formatDimensionValue(record) {
        var value = record ? cleanSpecValue(record.typical) : "";
        var unit = normalizeUnitText(record && record.unit, "mm");
        var partUnit = unit.split(/[×xX]/)[0] || unit;
        var parts;
        if (!value) return "-";
        value = value.replace(/\*/g, "×").replace(/[xX]/g, "×");
        if (!partUnit || partUnit === "-" || valueAlreadyHasUnit(value, partUnit)) return value;
        parts = value.split("×");
        if (parts.length > 1) {
          return parts.map(function (part) {
            return part + partUnit;
          }).join("×");
        }
        return value + partUnit;
      }

      function bestRecordValueWithUnit(manualData, names, preferredKey, fallbackKey, fallbackUnit, options) {
        var fallbackRecord = null;
        var fallbackValueKey = fallbackKey || "typical";
        var result = "-";
        (names || []).some(function (name) {
          var record = paramByAliases(manualData, [name]);
          if (!record) return false;
          if (!fallbackRecord) fallbackRecord = record;
          if (!isBlankSpecValue(record[preferredKey])) {
            result = formatValueWithUnit(record, preferredKey, fallbackUnit, options);
            return true;
          }
          if (!isBlankSpecValue(record[fallbackValueKey])) {
            result = formatValueWithUnit(record, fallbackValueKey, fallbackUnit, options);
            return true;
          }
          return false;
        });
        return result !== "-" ? result : (fallbackRecord ? formatValueWithUnit(fallbackRecord, fallbackValueKey, fallbackUnit, options) : "-");
      }

      function composeDcSupplyValue(manualData) {
        var direct = paramByAliases(manualData, ["直流供电", "供电", "电源"]);
        var voltage = paramByAliases(manualData, ["漏极工作电压", "工作电压", "Vd"]);
        var current = paramByAliases(manualData, ["静态漏极电流", "静态电流", "Id"]);
        var voltageText;
        var currentText;
        if (direct && !isBlankSpecValue(direct.typical)) {
          return formatValueWithUnit(direct, "typical", direct.unit || "V");
        }
        voltageText = formatValueWithUnit(voltage, "typical", "V");
        currentText = formatValueWithUnit(current, "typical", "mA");
        if (voltageText !== "-" && currentText !== "-") return voltageText + " @" + currentText;
        return voltageText !== "-" ? voltageText : currentText;
      }

      function composeIntroDcVoltage(manualData) {
        var direct = paramByAliases(manualData, ["直流供电", "供电", "电源"]);
        if (direct && !isBlankSpecValue(direct.typical)) return formatValueWithUnit(direct, "typical", direct.unit || "V");
        return bestRecordValueWithUnit(manualData, ["漏极工作电压", "工作电压", "Vd"], "typical", "typical", "V");
      }

      function buildFeatureDataFromLnaManual(manualData) {
        var frequency = paramByAliases(manualData, ["频率范围", "工作频率范围"]);
        var gain = paramByAliases(manualData, ["增益"]);
        var nf = paramByAliases(manualData, ["噪声系数"]);
        var p1db = paramByAliases(manualData, ["输出1dB压缩功率", "输出1db压缩功率", "P1dB", "P-1"]);
        var size = paramByAliases(manualData, ["芯片尺寸", "尺寸"]);
        return {
          "频率范围": formatValueWithUnit(frequency, "typical", "GHz", { rangeUnitEachSide: true }),
          "增益": formatValueWithUnit(gain, "typical", "dB"),
          "噪声系数": formatValueWithUnit(nf, "typical", "dB"),
          "输出1dB压缩功率": formatValueWithUnit(p1db, "typical", "dBm"),
          "直流供电": composeDcSupplyValue(manualData),
          "芯片尺寸": formatDimensionValue(size)
        };
      }

      function buildIntroTextFromLnaManual(manualData) {
        var model = bestRecordValueWithUnit(manualData, ["型号", "产品型号"], "typical", "typical", "");
        var mirrorModel = bestRecordValueWithUnit(manualData, ["镜像型号", "镜像产品型号"], "typical", "typical", "");
        var processType = bestRecordValueWithUnit(manualData, ["工艺类型", "工艺"], "typical", "typical", "");
        var frequency = bestRecordValueWithUnit(manualData, ["频率范围", "工作频率范围"], "typical", "typical", "GHz", { rangeUnitEachSide: true });
        var gain = bestRecordValueWithUnit(manualData, ["线性增益", "增益"], "min", "typical", "dB");
        var noise = bestRecordValueWithUnit(manualData, ["带内噪声系数", "内带噪声系数", "噪声系数"], "max", "typical", "dB");
        var dcVoltage = composeIntroDcVoltage(manualData);
        var processPhrase = processType.indexOf("工艺") === -1 ? ("采用" + processType + "工艺制作") : ("采用" + processType + "制作");
        return model + " 是一款低噪声放大器芯片，" + mirrorModel + " 是镜像版本，" + processPhrase + "。工作频率范围覆盖" + frequency + "，线性增益大于" + gain + "，带内噪声系数小于" + noise + "。芯片通过背面通孔接地，单电源工作，典型工作电压" + dcVoltage + "。该芯片主要应用于微波系统中，实现信号的放大功能。";
      }

      function setEditableText(node, value) {
        if (!node) return;
        node.classList.remove("editable-placeholder");
        node.removeAttribute("data-edit-placeholder");
        node.textContent = value == null ? "" : String(value);
      }

      function sectionByTitle(scope, title) {
        return Array.from((scope || document).querySelectorAll(".section, .half-panel")).find(function (section) {
          var titleNode = section.querySelector(":scope > .section-title");
          return titleNode && titleNode.textContent.trim().indexOf(title) !== -1;
        }) || null;
      }

      function createEditableRow(cells, cellTag) {
        var row = document.createElement("tr");
        (cells || []).forEach(function (value) {
          row.appendChild(createCell(cellTag || "td", value));
        });
        return row;
      }

      function replaceManualTable(table, headers, bodyRows) {
        var thead = table.tHead || table.createTHead();
        var tbody = table.tBodies[0] || table.createTBody();
        thead.innerHTML = "";
        tbody.innerHTML = "";
        thead.appendChild(createEditableRow(headers, "th"));
        (bodyRows || []).forEach(function (row) {
          tbody.appendChild(createEditableRow(row, "td"));
        });
        makeCellsEditable(table);
      }

      function blankRowsFromConfigs(configs, includeRemark) {
        return configs.map(function (config) {
          var row = [config.key, "", "", "", "", ""];
          if (includeRemark) row.push("");
          return row;
        });
      }

      function tableRowsFromConfigs(manualData, configs, includeRemark) {
        return configs.map(function (config) {
          var record = paramByConfig(manualData, config) || {};
          var row = [
            config.key,
            dashSpecValue(record.symbol || config.symbol),
            dashSpecValue(record.min),
            dashSpecValue(record.typical),
            dashSpecValue(record.max),
            dashSpecValue(record.unit || config.unit)
          ];
          if (includeRemark) row.push(dashSpecValue(record.remark));
          return row;
        });
      }

      function prepareBlankLnaExcelSections(scope) {
        var featureSection = sectionByTitle(scope, "性能特点");
        var introSection = sectionByTitle(scope, "产品简介");
        var dcSection = sectionByTitle(scope, "直流电参数");
        var microwaveSection = sectionByTitle(scope, "微波电参数");
        var dcTable = dcSection && dcSection.querySelector("[data-editable-table]");
        var microwaveTable = microwaveSection && microwaveSection.querySelector("[data-editable-table]");

        ensurePerformanceFeatureLists(scope);
        if (featureSection) {
          featureSection.querySelectorAll("[data-feature-value]").forEach(function (node) {
            setEditableText(node, "");
          });
        }
        if (introSection) setEditableText(introSection.querySelector(".intro-text"), "");
        if (dcTable) {
          replaceManualTable(dcTable, ["指标", "符号", "最小值", "典型值", "最大值", "单位", "备注"], blankRowsFromConfigs(lnaDcRows, true));
        }
        if (microwaveTable) {
          replaceManualTable(microwaveTable, ["指标", "符号", "最小值", "典型值", "最大值", "单位"], blankRowsFromConfigs(lnaMicrowaveRows, false));
        }
      }

      function applyLnaManualData(manualData) {
        var featureData = buildFeatureDataFromLnaManual(manualData);
        var featureUpdated = applyPerformanceFeatureData(featureData);
        var introSection = sectionByTitle(manual, "产品简介");
        var dcSection = sectionByTitle(manual, "直流电参数");
        var microwaveSection = sectionByTitle(manual, "微波电参数");
        var dcTable = dcSection && dcSection.querySelector("[data-editable-table]");
        var microwaveTable = microwaveSection && microwaveSection.querySelector("[data-editable-table]");
        var updated = featureUpdated;

        if (introSection) {
          setEditableText(introSection.querySelector(".intro-text"), buildIntroTextFromLnaManual(manualData));
          updated += 1;
        }
        if (dcTable) {
          replaceManualTable(dcTable, ["指标", "符号", "最小值", "典型值", "最大值", "单位", "备注"], tableRowsFromConfigs(manualData, lnaDcRows, true));
          updated += 1;
        }
        if (microwaveTable) {
          replaceManualTable(microwaveTable, ["指标", "符号", "最小值", "典型值", "最大值", "单位"], tableRowsFromConfigs(manualData, lnaMicrowaveRows, false));
          updated += 1;
        }
        if (updated) {
          selectedCell = null;
          bindTableControls(manual);
          schedulePagination(120, { afterPaint: true });
          saveActivePage();
        }
        return updated;
      }

      function applyPerformanceFeatureData(data) {
        ensurePerformanceFeatureLists(manual);
        var updated = 0;
        featureFields.forEach(function (field) {
          if (!Object.prototype.hasOwnProperty.call(data, field.key)) return;
          featureValueNodes(manual, field.key).forEach(function (node) {
            node.classList.remove("editable-placeholder");
            node.removeAttribute("data-edit-placeholder");
            node.textContent = data[field.key];
            updated += 1;
          });
        });
        if (updated) {
          schedulePagination(120, { afterPaint: true });
          saveActivePage();
        }
        return updated;
      }

      function readFeatureRows(file) {
        return importRowsFromFile(file);
      }

      function setFeatureImportStatus(message, isError) {
        var status = document.querySelector("[data-feature-import-status]");
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? "#9d1f1a" : "";
      }

      function importFeatureFile(file) {
        if (!file) return;
        setFeatureImportStatus("正在读取：" + file.name);
        readFeatureRows(file).then(function (rows) {
          var manualData = rowsToLnaManualData(rows);
          var data;
          var updated;
          var matched;
          if (manualData.fixedFormat) {
            updated = applyLnaManualData(manualData);
            matched = Object.keys(manualData.params).length;
            if (!updated) {
              setFeatureImportStatus("当前页面没有可填写的低噪放参数区域。", true);
              return;
            }
            setFeatureImportStatus("已识别 " + matched + " 个指标，并生成性能特点、产品简介、直流电参数、微波电参数。");
            return;
          }
          data = rowsToFeatureData(rows);
          updated = applyPerformanceFeatureData(data);
          matched = Object.keys(data).length;
          if (!matched) {
            setFeatureImportStatus("未识别到固定格式指标表，请检查表头：指标、典型值、最小值、最大值、单位、符号、显示模块。", true);
            return;
          }
          if (!updated) {
            setFeatureImportStatus("当前页面没有可填写的性能特点区域。", true);
            return;
          }
          setFeatureImportStatus("已按双列表格导入性能特点 " + matched + " 项。");
        }).catch(function (error) {
          setFeatureImportStatus(error && error.message ? error.message : "导入失败", true);
        });
      }

      function normalizePaginationTitle(value) {
        return String(value || "").replace(/\s+/g, "");
      }

      function isPaginationAnchorTitle(title) {
        var normalizedTitle = normalizePaginationTitle(title);
        return paginationAnchorTitles.some(function (anchorTitle) {
          return normalizedTitle.indexOf(normalizePaginationTitle(anchorTitle)) !== -1;
        });
      }

      function directSectionTitle(node) {
        return node ? node.querySelector(":scope > .section-title") : null;
      }

      function nodeHasPaginationAnchor(node) {
        if (!node) return false;
        var titleNode = directSectionTitle(node);
        if (titleNode && isPaginationAnchorTitle(titleNode.textContent)) return true;
        return !!node.querySelector('[data-pagination-anchor="true"]');
      }

      function markPaginationAnchors(scope) {
        scope = scope || document;
        scope.querySelectorAll('[data-pagination-anchor="true"]').forEach(function (node) {
          delete node.dataset.paginationAnchor;
        });
        scope.querySelectorAll('[data-pagination-block="true"]').forEach(function (node) {
          delete node.dataset.paginationBlock;
        });
        scope.querySelectorAll(".section, .half-panel").forEach(function (section) {
          var titleNode = directSectionTitle(section);
          if (!titleNode || !isPaginationAnchorTitle(titleNode.textContent)) return;
          section.dataset.paginationAnchor = "true";
          section.removeAttribute("data-page-break-before");
        });
        scope.querySelectorAll(".page > .page-content > *").forEach(function (block) {
          if (nodeHasPaginationAnchor(block)) block.dataset.paginationBlock = "true";
        });
      }

      function encodeStoredHtml(html) {
        return encodeURIComponent(html || "");
      }

      function decodeStoredHtml(value) {
        if (!value) return "";
        try {
          return decodeURIComponent(value);
        } catch (error) {
          return value;
        }
      }

      function getNodeTitle(node) {
        var label = node && node.querySelector(":scope > .tree-row .tree-label");
        return label ? (label.textContent.trim() || "未命名目录") : "未命名目录";
      }

      function ensurePageId(node) {
        if (!node) return "";
        if (!node.dataset.pageId) {
          nodeIdSeed += 1;
          node.dataset.pageId = "page-" + nodeIdSeed;
        } else {
          var match = node.dataset.pageId.match(/(\d+)$/);
          var numericId = match ? Number(match[1]) : 0;
          if (numericId > nodeIdSeed) nodeIdSeed = numericId;
        }
        return node.dataset.pageId;
      }

      function createPageHeaderHtml(title) {
        var safeTitle = escapeHtml(title || "未命名目录");
        return [
          '<header class="manual-header">',
          '<div class="header-top">',
          '<div class="header-title">',
          '<div class="model editable" contenteditable="true" data-linked-node-title="true">' + safeTitle + "</div>",
          '<div class="subtitle editable" contenteditable="true">产品名称与规格（点击编辑）</div>',
          "</div>",
          "</div>",
          '<div class="header-strip">',
          '<div class="version editable" contenteditable="true">v1.0</div>',
          "</div>",
          "</header>"
        ].join("");
      }

      function createPageFooterHtml() {
        return '<footer class="footer editable" contenteditable="true">' + escapeHtml(fixedFooterText) + "</footer>";
      }

      function createBlankPageHtml(title) {
        return [
          '<section class="page page-blank">',
          '<div class="page-content page-content-empty"></div>',
          "</section>"
        ].join("");
      }

      function ensureLinkedTitleMarkers(html) {
        var wrapper = document.createElement("div");
        wrapper.innerHTML = html || "";
        var markers = wrapper.querySelectorAll("[data-linked-node-title]");
        if (!markers.length) {
          wrapper.querySelectorAll(".model").forEach(function (model) {
            model.setAttribute("data-linked-node-title", "true");
          });
        }
        if (!wrapper.querySelector("[data-linked-node-title]")) {
          var fallback = wrapper.querySelector(".page .section-title");
          if (fallback) fallback.setAttribute("data-linked-node-title", "true");
        }
        return wrapper.innerHTML;
      }

      function syncPageTitleInHtml(html, title) {
        var wrapper = document.createElement("div");
        wrapper.innerHTML = html || createBlankPageHtml(title);
        if (!wrapper.querySelector("[data-linked-node-title]")) {
          wrapper.innerHTML = ensureLinkedTitleMarkers(wrapper.innerHTML);
        }
        wrapper.querySelectorAll("[data-linked-node-title]").forEach(function (titleNode) {
          titleNode.textContent = title || "未命名目录";
        });
        return wrapper.innerHTML;
      }

      function syncCurrentManualTitle(title) {
        var titleNodes = manual.querySelectorAll("[data-linked-node-title]");
        if (!titleNodes.length) {
          manual.querySelectorAll(".model").forEach(function (model) {
            model.setAttribute("data-linked-node-title", "true");
          });
          if (!manual.querySelector("[data-linked-node-title]")) {
            var fallback = manual.querySelector(".page .section-title");
            if (fallback) fallback.setAttribute("data-linked-node-title", "true");
          }
          titleNodes = manual.querySelectorAll("[data-linked-node-title]");
        }
        titleNodes.forEach(function (titleNode) {
          titleNode.textContent = title || "未命名目录";
        });
      }

      function setNodePageHtml(node, html, persistToNode) {
        var pageId = ensurePageId(node);
        pageStore[pageId] = html;
        delete node.dataset.pageTemplate;
        if (persistToNode) {
          node.dataset.pageHtml = encodeStoredHtml(html);
        } else {
          delete node.dataset.pageHtml;
        }
      }

      function getNodePageHtml(node) {
        var pageId = ensurePageId(node);
        if (Object.prototype.hasOwnProperty.call(pageStore, pageId)) {
          return pageStore[pageId];
        }
        if (node.dataset.pageHtml) {
          pageStore[pageId] = decodeStoredHtml(node.dataset.pageHtml);
          delete node.dataset.pageHtml;
          return pageStore[pageId];
        }
        if (node.dataset.pageTemplate === "manual") {
          setNodePageHtml(node, createEditableTemplateHtml(initialManualHtml, getNodeTitle(node)));
          return pageStore[pageId];
        }
        setNodePageHtml(node, createBlankPageHtml(getNodeTitle(node)));
        return pageStore[pageId];
      }

      function setNodePageTemplate(node, templateId) {
        var pageId = ensurePageId(node);
        delete pageStore[pageId];
        delete node.dataset.pageHtml;
        node.dataset.pageTemplate = templateId;
      }

      function saveActivePage(persistToNode) {
        if (!activeTreeNode || !activePageId) return;
        pageStore[activePageId] = manual.innerHTML;
        if (persistToNode) {
          activeTreeNode.dataset.pageHtml = encodeStoredHtml(pageStore[activePageId]);
        }
      }

      function persistStoredPages() {
        saveActivePage(true);
        document.querySelectorAll(".resource-tree .tree-node").forEach(function (node) {
          var pageId = ensurePageId(node);
          if (Object.prototype.hasOwnProperty.call(pageStore, pageId)) {
            node.dataset.pageHtml = encodeStoredHtml(pageStore[pageId]);
          }
        });
      }

      function clearPersistedPageAttributes(root) {
        root.querySelectorAll(".resource-tree .tree-node[data-page-html]").forEach(function (node) {
          delete node.dataset.pageHtml;
        });
      }

      function scheduleActivePageSave() {
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(function () {
          saveActivePage();
        }, 350);
      }

      function markEditablePlaceholder(element, placeholder) {
        element.innerHTML = "";
        element.classList.add("editable-placeholder");
        element.setAttribute("data-edit-placeholder", placeholder || "点击填写内容");
        if (!element.hasAttribute("contenteditable")) {
          element.setAttribute("contenteditable", "true");
        }
      }

      function clearTemplateSection(section) {
        section.querySelectorAll(".image-drop").forEach(function (zone) {
          zone.classList.remove("has-images", "dragover");
          var imageList = zone.querySelector(".image-list");
          if (imageList) imageList.innerHTML = "";
        });
        section.querySelectorAll("[data-curve-frame-list]").forEach(function (list) {
          list.innerHTML = "";
          updateCurveSectionState(list.closest("[data-curve-section]") || section);
        });
        section.querySelectorAll("tbody th, tbody td").forEach(function (cell) {
          cell.innerHTML = "";
          cell.setAttribute("contenteditable", "true");
        });
        section.querySelectorAll('[contenteditable="true"]').forEach(function (editable) {
          if (editable.classList.contains("section-title")) return;
          if (editable.closest("thead") || editable.closest("tbody")) return;
          markEditablePlaceholder(editable, "点击填写内容");
        });
      }

      function createTypicalCurveSection() {
        var section = document.createElement("section");
        section.className = "section curve-section";
        section.dataset.curveSection = "true";
        section.innerHTML = [
          '<h2 class="section-title editable" contenteditable="true">典型曲线</h2>',
          '<div class="curve-drop" data-curve-target>',
          '<div class="placeholder">从右侧工具读取 S参数并生成手册曲线图，点击曲线可编辑</div>',
          '<div class="curve-frame-list" data-curve-frame-list></div>',
          "</div>"
        ].join("");
        return section;
      }

      function isTypicalCurveSection(section) {
        var titleNode = section && section.querySelector(":scope > .section-title");
        return !!titleNode && titleNode.textContent.trim().indexOf("典型曲线") !== -1;
      }

      function upgradeTypicalCurveSection(section) {
        if (!section) return null;
        section.classList.add("curve-section");
        section.dataset.curveSection = "true";
        var target = section.querySelector(":scope > [data-curve-target]");
        if (!target) {
          var oldImageZone = section.querySelector(":scope > .image-drop");
          if (oldImageZone) {
            target = document.createElement("div");
            target.className = "curve-drop";
            target.dataset.curveTarget = "true";
            target.innerHTML = [
              '<div class="placeholder">从右侧工具读取 S参数并生成手册曲线图，点击曲线可编辑</div>',
              '<div class="curve-frame-list" data-curve-frame-list></div>'
            ].join("");
            oldImageZone.replaceWith(target);
          }
        }
        if (!target) {
          target = document.createElement("div");
          target.className = "curve-drop";
          target.dataset.curveTarget = "true";
          target.innerHTML = [
            '<div class="placeholder">从右侧工具读取 S参数并生成手册曲线图，点击曲线可编辑</div>',
            '<div class="curve-frame-list" data-curve-frame-list></div>'
          ].join("");
          section.appendChild(target);
        }
        if (!target.querySelector("[data-curve-frame-list]")) {
          var list = document.createElement("div");
          list.className = "curve-frame-list";
          list.dataset.curveFrameList = "true";
          target.appendChild(list);
        }
        updateCurveSectionState(section);
        return section;
      }

      function addTypicalCurveSection(wrapper) {
        var existingSection = Array.from(wrapper.querySelectorAll(".section")).find(function (section) {
          return isTypicalCurveSection(section);
        });
        if (existingSection) {
          upgradeTypicalCurveSection(existingSection);
          return existingSection;
        }
        var limitSection = Array.from(wrapper.querySelectorAll(".section")).find(function (section) {
          var titleNode = section.querySelector(":scope > .section-title");
          return titleNode && titleNode.textContent.trim().indexOf("使用限制参数") !== -1;
        });
        if (!limitSection) return;
        var section = createTypicalCurveSection();
        limitSection.insertAdjacentElement("afterend", section);
        return section;
      }

      function markTemplatePageBreaks(wrapper) {
        markPaginationAnchors(wrapper);
      }

      function createOriginalManualHtml(sourceHtml) {
        var wrapper = document.createElement("div");
        wrapper.innerHTML = ensureLinkedTitleMarkers(sourceHtml || "");
        ensurePerformanceFeatureLists(wrapper);
        addTypicalCurveSection(wrapper);
        markTemplatePageBreaks(wrapper);
        return wrapper.innerHTML || createBlankPageHtml("PRODUCT-001");
      }

      function createEditableTemplateHtml(sourceHtml, title) {
        var wrapper = document.createElement("div");
        wrapper.innerHTML = sourceHtml || "";
        wrapper.querySelectorAll(".model").forEach(function (model) {
          model.setAttribute("data-linked-node-title", "true");
          model.textContent = title || "未命名目录";
        });
        ensurePerformanceFeatureLists(wrapper);
        wrapper.querySelectorAll(".section, .half-panel").forEach(function (section) {
          var titleNode = section.querySelector(":scope > .section-title");
          var sectionTitle = titleNode ? titleNode.textContent.trim() : "";
          if (sectionTitle.indexOf("注意事项") !== -1) return;
          if (sectionTitle.indexOf("使用限制参数") !== -1) return;
          clearTemplateSection(section);
        });
        prepareBlankLnaExcelSections(wrapper);
        addTypicalCurveSection(wrapper);
        markTemplatePageBreaks(wrapper);
        return wrapper.innerHTML || createBlankPageHtml(title);
      }

      function ensureEditableParameterTitles(scope) {
        scope.querySelectorAll(".section-title").forEach(function (titleNode) {
          var titleText = titleNode.textContent.trim();
          if (titleText.indexOf("直流电参数") !== -1 || titleText.indexOf("微波电参数") !== -1) {
            titleNode.classList.add("editable");
            titleNode.setAttribute("contenteditable", "true");
          }
        });
      }

      function hydrateManual() {
        selectedCell = null;
        currentImageZone = null;
        lastManualEditable = null;
        selectedCurveEmbed = null;
        closeCurveEditor();
        addTypicalCurveSection(manual);
        ensureEditableParameterTitles(manual);
        ensurePerformanceFeatureLists(manual);
        markPaginationAnchors(manual);
        manual.querySelectorAll(".page").forEach(syncPageContentLimit);
        ensureImageEditActions(manual);
        ensureManualImageResizeHandles(manual);
        bindTableControls(manual);
        bindImageZones(manual);
        bindCurveEmbeds(manual);
        bindSyncedHeaderFields(manual);
      }

      function getCurrentPageChrome(title) {
        var firstPage = manual.querySelector(".page");
        var header = firstPage && firstPage.querySelector(":scope > .manual-header");
        var footer = firstPage && firstPage.querySelector(":scope > .footer");
        return {
          header: header ? header.outerHTML : createPageHeaderHtml(title),
          footer: footer ? footer.outerHTML : createPageFooterHtml()
        };
      }

      function createManualPage(chrome) {
        var page = document.createElement("section");
        page.className = "page page-generated";
        page.innerHTML = [
          chrome.header,
          '<div class="page-content"></div>',
          chrome.footer
        ].join("");
        return page;
      }

      function pageContent(page) {
        return page.querySelector(":scope > .page-content");
      }

      function pageMm(page, value) {
        return page.getBoundingClientRect().height * value / 297;
      }

      function syncPageContentLimit(page) {
        var content = pageContent(page);
        if (!content || content.classList.contains("page-content-empty")) return;
        var footer = page.querySelector(":scope > .footer");
        var pageRect = page.getBoundingClientRect();
        var footerRect = footer ? footer.getBoundingClientRect() : null;
        var footerTop = footerRect ? footerRect.top : pageRect.bottom;
        var contentTop = content.getBoundingClientRect().top;
        var safeBottom = Math.min(footerTop - pageMm(page, 7), pageRect.bottom - pageMm(page, 16));
        var contentHeight = Math.max(pageMm(page, 40), safeBottom - contentTop);
        content.style.height = contentHeight + "px";
      }

      function pageSafeBottom(page) {
        var content = pageContent(page);
        syncPageContentLimit(page);
        return content ? content.getBoundingClientRect().bottom : page.getBoundingClientRect().bottom;
      }

      function measurableElements(root) {
        return [root].concat(Array.from(root.querySelectorAll([
          ".section-title",
          ".feature-list",
          ".intro-text",
          ".free-text",
          ".note-text",
          ".static-warning",
          ".dimension-caption",
          ".dimension-note",
          ".table-toolbar",
          "table",
          "tbody",
          "tr",
          "figure",
          "img",
          "iframe",
          ".image-drop",
          ".image-list",
          ".curve-drop",
          ".curve-frame-list",
          ".curve-embed",
          ".curve-frame"
        ].join(","))));
      }

      function elementVisualBottom(root) {
        var bottom = 0;
        measurableElements(root).forEach(function (candidate) {
          var rect = candidate.getBoundingClientRect();
          if (rect.width || rect.height) bottom = Math.max(bottom, rect.bottom);
        });
        return bottom;
      }

      function contentBottom(content) {
        return Array.from(content.children).reduce(function (bottom, child) {
          return Math.max(bottom, elementVisualBottom(child));
        }, 0);
      }

      function pageOverflows(page) {
        var content = pageContent(page);
        if (!content || !content.children.length) return false;
        syncPageContentLimit(page);
        return content.scrollHeight > content.clientHeight + 2 || contentBottom(content) >= pageSafeBottom(page) - 0.5;
      }

      function blockOverlapsFooter(block, page) {
        syncPageContentLimit(page);
        return elementVisualBottom(block) >= pageSafeBottom(page) - 0.5;
      }

      function anchoredSectionOverlapsFooter(block, page) {
        var anchors = [];
        if (block && block.matches && block.matches('[data-pagination-anchor="true"]')) {
          anchors.push(block);
        }
        anchors = anchors.concat(Array.from(block.querySelectorAll('[data-pagination-anchor="true"]')));
        if (!anchors.length) return false;
        syncPageContentLimit(page);
        var safeBottom = pageSafeBottom(page);
        return anchors.some(function (anchor) {
          return elementVisualBottom(anchor) >= safeBottom - 0.5;
        });
      }

      function createPaginatorPage(state) {
        var page = createManualPage(state.chrome);
        manual.appendChild(page);
        syncPageContentLimit(page);
        state.page = page;
        state.content = pageContent(page);
        return page;
      }

      function cloneSectionForContinuation(section, mode) {
        var clone = section.cloneNode(true);
        var sourceKey = normalizeSectionKey(section);
        clone.dataset.paginationContinuation = mode || "true";
        if (sourceKey) clone.dataset.continuationSourceKey = sourceKey;
        if (mode === "table") {
          var tbody = clone.querySelector("tbody");
          if (tbody) tbody.innerHTML = "";
          clone.dataset.tableContinuation = "true";
        }
        if (mode === "image") {
          clone.querySelectorAll(".image-list").forEach(function (list) {
            list.innerHTML = "";
          });
          clone.querySelectorAll(".image-drop").forEach(function (zone) {
            zone.classList.remove("has-images", "image-count-1", "image-count-2", "image-count-many");
          });
        }
        if (mode === "curve") {
          clone.querySelectorAll("[data-curve-frame-list]").forEach(function (list) {
            list.innerHTML = "";
          });
          clone.querySelectorAll("[data-curve-target]").forEach(function (target) {
            target.classList.remove("has-curves");
          });
          clone.querySelectorAll(":scope > .section-title").forEach(function (titleNode) {
            titleNode.remove();
          });
          delete clone.dataset.paginationAnchor;
          delete clone.dataset.paginationBlock;
          clone.removeAttribute("data-page-break-before");
          clone.dataset.curveContinuation = "true";
        }
        if (mode === "image") {
          clone.dataset.imageContinuation = "true";
        }
        return clone;
      }

      function normalizeSectionKey(section) {
        var titleNode = directSectionTitle(section);
        return titleNode ? normalizePaginationTitle(titleNode.textContent) : "";
      }

      function isTableContinuationOf(block, previousBlock) {
        if (!block || !previousBlock) return false;
        if (!block.querySelector || !previousBlock.querySelector) return false;
        if (!block.querySelector("[data-editable-table]") || !previousBlock.querySelector("[data-editable-table]")) return false;
        if (block.dataset.tableContinuation === "true") return true;
        return normalizeSectionKey(block) && normalizeSectionKey(block) === normalizeSectionKey(previousBlock);
      }

      function mergeTableContinuation(previousBlock, block) {
        var previousBody = previousBlock.querySelector("[data-editable-table] tbody");
        var body = block.querySelector("[data-editable-table] tbody");
        if (!previousBody || !body) return false;
        while (body.firstElementChild) {
          previousBody.appendChild(body.firstElementChild);
        }
        return true;
      }

      function continuationSourceKey(block) {
        return block && block.dataset ? (block.dataset.continuationSourceKey || "") : "";
      }

      function isCurveContinuationOf(block, previousBlock) {
        if (!block || !previousBlock) return false;
        if (block.dataset.curveContinuation !== "true") return false;
        if (!block.querySelector || !previousBlock.querySelector) return false;
        if (!block.querySelector("[data-curve-frame-list]") || !previousBlock.querySelector("[data-curve-frame-list]")) return false;
        return continuationSourceKey(block) && continuationSourceKey(block) === normalizeSectionKey(previousBlock);
      }

      function mergeCurveContinuation(previousBlock, block) {
        var previousList = previousBlock.querySelector("[data-curve-frame-list]");
        var list = block.querySelector("[data-curve-frame-list]");
        if (!previousList || !list) return false;
        while (list.firstElementChild) {
          previousList.appendChild(list.firstElementChild);
        }
        return true;
      }

      function isImageContinuationOf(block, previousBlock) {
        if (!block || !previousBlock) return false;
        if (block.dataset.imageContinuation !== "true") return false;
        if (!block.querySelector || !previousBlock.querySelector) return false;
        if (!block.querySelector(".image-list") || !previousBlock.querySelector(".image-list")) return false;
        return continuationSourceKey(block) && continuationSourceKey(block) === normalizeSectionKey(previousBlock);
      }

      function mergeImageContinuation(previousBlock, block) {
        var previousList = previousBlock.querySelector(".image-list");
        var list = block.querySelector(".image-list");
        if (!previousList || !list) return false;
        while (list.firstElementChild) {
          previousList.appendChild(list.firstElementChild);
        }
        return true;
      }

      function normalizePaginatedBlocks(blocks) {
        var normalized = [];
        blocks.forEach(function (block) {
          var previousBlock = normalized[normalized.length - 1];
          if (isCurveContinuationOf(block, previousBlock) && mergeCurveContinuation(previousBlock, block)) {
            return;
          }
          if (isImageContinuationOf(block, previousBlock) && mergeImageContinuation(previousBlock, block)) {
            return;
          }
          if (isTableContinuationOf(block, previousBlock) && mergeTableContinuation(previousBlock, block)) {
            return;
          }
          delete block.dataset.paginationContinuation;
          delete block.dataset.tableContinuation;
          delete block.dataset.curveContinuation;
          delete block.dataset.imageContinuation;
          delete block.dataset.continuationSourceKey;
          normalized.push(block);
        });
        return normalized;
      }

      function splitTableBlock(block, state) {
        var table = block.querySelector("[data-editable-table]");
        var tbody = table && table.tBodies && table.tBodies[0];
        if (!tbody || tbody.rows.length <= 1) return false;
        var clone = cloneSectionForContinuation(block, "table");
        var cloneBody = clone.querySelector("tbody");
        while (pageOverflows(state.page) && tbody.rows.length > 1) {
          cloneBody.insertBefore(tbody.lastElementChild, cloneBody.firstElementChild);
        }
        if (!cloneBody.children.length) return false;
        createPaginatorPage(state);
        state.content.appendChild(clone);
        if (pageOverflows(state.page)) splitOversizedBlock(clone, state);
        return true;
      }

      function splitImageBlock(block, state) {
        var imageList = block.querySelector(".image-list");
        if (!imageList || imageList.children.length <= 1) return false;
        var clone = cloneSectionForContinuation(block, "image");
        var cloneList = clone.querySelector(".image-list");
        while (pageOverflows(state.page) && imageList.children.length > 1) {
          cloneList.insertBefore(imageList.lastElementChild, cloneList.firstElementChild);
        }
        if (!cloneList.children.length) return false;
        updateImageZoneState(block.querySelector("[data-image-zone]") || block);
        createPaginatorPage(state);
        state.content.appendChild(clone);
        updateImageZoneState(clone.querySelector("[data-image-zone]") || clone);
        if (pageOverflows(state.page)) splitOversizedBlock(clone, state);
        return true;
      }

      function splitCurveBlock(block, state) {
        var curveList = block.querySelector("[data-curve-frame-list]");
        if (!curveList || curveList.children.length <= 1) return false;
        var clone = cloneSectionForContinuation(block, "curve");
        var cloneList = clone.querySelector("[data-curve-frame-list]");
        while (pageOverflows(state.page) && curveList.children.length > 1) {
          cloneList.insertBefore(curveList.lastElementChild, cloneList.firstElementChild);
        }
        if (!cloneList.children.length) return false;
        updateCurveSectionState(block);
        createPaginatorPage(state);
        state.content.appendChild(clone);
        updateCurveSectionState(clone);
        bindCurveEmbeds(clone);
        if (pageOverflows(state.page)) splitOversizedBlock(clone, state);
        return true;
      }

      function splitOversizedBlock(block, state) {
        if (block.querySelector("[data-editable-table]") && splitTableBlock(block, state)) return true;
        if (block.querySelector(".image-list") && splitImageBlock(block, state)) return true;
        if (block.querySelector("[data-curve-frame-list]") && splitCurveBlock(block, state)) return true;
        return false;
      }

      function blockRequiresNewPage(block) {
        return block && block.getAttribute("data-page-break-before") === "true";
      }

      function moveBlockToFreshPage(block, state) {
        state.content.removeChild(block);
        createPaginatorPage(state);
        state.content.appendChild(block);
      }

      function appendBlockToPaginator(block, state) {
        state.content.appendChild(block);
        var needsAnchoredBreak = anchoredSectionOverlapsFooter(block, state.page);
        var needsLayoutBreak = blockOverlapsFooter(block, state.page) || pageOverflows(state.page);
        var canKeepCurveSectionOnCurrentPage =
          state.content.children.length > 1 &&
          !blockRequiresNewPage(block) &&
          block.querySelector("[data-curve-frame-list]") &&
          (needsAnchoredBreak || needsLayoutBreak);
        if (canKeepCurveSectionOnCurrentPage && splitCurveBlock(block, state)) {
          return;
        }
        if (
          state.content.children.length > 1 &&
          (blockRequiresNewPage(block) || needsAnchoredBreak || needsLayoutBreak)
        ) {
          moveBlockToFreshPage(block, state);
        }
        if (pageOverflows(state.page)) splitOversizedBlock(block, state);
      }

      function repaginateManual() {
        if (isPaginating) return;
        addTypicalCurveSection(manual);
        markPaginationAnchors(manual);
        var blocks = [];
        manual.querySelectorAll(".page > .page-content").forEach(function (content) {
          if (content.classList.contains("page-content-empty")) return;
          while (content.firstElementChild) {
            blocks.push(content.removeChild(content.firstElementChild));
          }
        });
        blocks = normalizePaginatedBlocks(blocks);
        if (!blocks.length) return;
        isPaginating = true;
        try {
          var chrome = getCurrentPageChrome(activeTreeNode ? getNodeTitle(activeTreeNode) : "产品手册");
          var state = { chrome: chrome, page: null, content: null };
          manual.innerHTML = "";
          createPaginatorPage(state);
          blocks.forEach(function (block) {
            appendBlockToPaginator(block, state);
          });
          manual.querySelectorAll("[data-image-zone]").forEach(updateImageZoneState);
          manual.querySelectorAll("[data-curve-section]").forEach(updateCurveSectionState);
          hydrateManual();
          saveActivePage();
        } finally {
          isPaginating = false;
        }
      }

      function schedulePagination(delay, options) {
        if (isPaginating) return;
        if (!manual.querySelector(".page > .page-content:not(.page-content-empty) > *")) return;
        options = options || {};
        clearTimeout(paginationTimer);
        paginationJobSeed += 1;
        var jobId = paginationJobSeed;
        var wait = typeof delay === "number" ? delay : 500;
        paginationTimer = setTimeout(function () {
          var run = function () {
            if (jobId === paginationJobSeed) repaginateManual();
          };
          if (options.afterPaint && window.requestAnimationFrame) {
            window.requestAnimationFrame(run);
          } else if (window.requestIdleCallback) {
            window.requestIdleCallback(run, { timeout: 700 });
          } else {
            run();
          }
        }, wait);
      }

      function cellCount(table) {
        var row = table.querySelector("thead tr, tbody tr");
        return row ? row.children.length : 0;
      }

      function createCell(tagName, text) {
        var cell = document.createElement(tagName);
        cell.contentEditable = "true";
        cell.textContent = text == null ? "" : String(text);
        return cell;
      }

      function addRow(table, options) {
        var count = cellCount(table) || 1;
        var row = document.createElement("tr");
        for (var i = 0; i < count; i += 1) {
          row.appendChild(createCell("td", ""));
        }
        table.tBodies[0].appendChild(row);
        if (!options || !options.silent) {
          row.cells[0].focus();
          schedulePagination();
        }
      }

      function deleteRow(table) {
        var activeRow = selectedCell && selectedCell.closest("tr");
        var bodyRow = activeRow && activeRow.parentElement.tagName === "TBODY" ? activeRow : table.tBodies[0].lastElementChild;
        if (bodyRow && table.tBodies[0].rows.length > 1) {
          bodyRow.remove();
          schedulePagination();
        }
      }

      function addCol(table, options) {
        var rows = table.querySelectorAll("tr");
        rows.forEach(function (row) {
          var tagName = row.parentElement.tagName === "THEAD" ? "th" : "td";
          row.appendChild(createCell(tagName, ""));
        });
        if (!options || !options.silent) schedulePagination();
      }

      function deleteCol(table) {
        var index = selectedCell ? selectedCell.cellIndex : cellCount(table) - 1;
        if (index < 0 || cellCount(table) <= 1) return;
        table.querySelectorAll("tr").forEach(function (row) {
          if (row.children[index]) row.children[index].remove();
        });
        schedulePagination();
      }

      function clearTable(table) {
        table.querySelectorAll("th, td").forEach(function (cell) {
          cell.innerHTML = "";
        });
        schedulePagination();
      }

      function getTableBlockTitle(block) {
        var titleNode = block && block.querySelector(":scope > .section-title");
        return titleNode ? titleNode.textContent.trim() : "";
      }

      function isImportableTableBlock(block) {
        var titleText = getTableBlockTitle(block);
        return importableTableTitles.some(function (title) {
          return titleText.indexOf(title) !== -1;
        });
      }

      function ensureTableImportControls(block) {
        if (!block || !isImportableTableBlock(block)) return;
        var toolbar = block.querySelector(":scope > .table-toolbar");
        if (!toolbar || toolbar.querySelector('[data-action="import-table"]')) return;

        var importButton = document.createElement("button");
        importButton.className = "btn";
        importButton.type = "button";
        importButton.dataset.action = "import-table";
        importButton.textContent = "导入表格";
        importButton.title = "读取 .xlsx/.csv/.tsv 并替换当前表格";
        toolbar.appendChild(importButton);

        var status = document.createElement("span");
        status.className = "table-import-status";
        status.dataset.tableImportStatus = "true";
        status.setAttribute("aria-live", "polite");
        toolbar.appendChild(status);
      }

      function setTableImportStatus(table, message, isError) {
        var block = table && table.closest("[data-table-block]");
        var status = block && block.querySelector("[data-table-import-status]");
        if (!status) return;
        status.textContent = message || "";
        status.classList.toggle("is-error", !!isError);
      }

      function readFileAsArrayBuffer(file) {
        if (file.arrayBuffer) return file.arrayBuffer();
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { reject(reader.error || new Error("文件读取失败")); };
          reader.readAsArrayBuffer(file);
        });
      }

      function decodeTextBuffer(buffer) {
        var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        var text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (text.indexOf("\uFFFD") !== -1) {
          try {
            text = new TextDecoder("gb18030", { fatal: false }).decode(bytes);
          } catch (error) {
            // Keep the UTF-8 result when the browser has no GB18030 decoder.
          }
        }
        return text.replace(/^\uFEFF/, "");
      }

      function parseDelimitedText(text, delimiter) {
        var rows = [];
        var row = [];
        var value = "";
        var inQuotes = false;
        var i;
        var ch;

        text = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        for (i = 0; i < text.length; i += 1) {
          ch = text.charAt(i);
          if (inQuotes) {
            if (ch === '"') {
              if (text.charAt(i + 1) === '"') {
                value += '"';
                i += 1;
              } else {
                inQuotes = false;
              }
            } else {
              value += ch;
            }
            continue;
          }

          if (ch === '"' && value === "") {
            inQuotes = true;
          } else if (ch === delimiter) {
            row.push(value);
            value = "";
          } else if (ch === "\n") {
            row.push(value);
            rows.push(row);
            row = [];
            value = "";
          } else {
            value += ch;
          }
        }
        row.push(value);
        rows.push(row);
        return rows;
      }

      function rowsFromDelimitedBuffer(buffer, fileName) {
        var delimiter = /\.tsv$/i.test(fileName || "") ? "\t" : ",";
        return parseDelimitedText(decodeTextBuffer(buffer), delimiter);
      }

      function readUint16(view, offset) {
        return view.getUint16(offset, true);
      }

      function readUint32(view, offset) {
        return view.getUint32(offset, true);
      }

      function decodeZipName(bytes, isUtf8) {
        if (isUtf8) return new TextDecoder("utf-8").decode(bytes);
        try {
          return new TextDecoder("ibm437").decode(bytes);
        } catch (error) {
          return new TextDecoder("utf-8").decode(bytes);
        }
      }

      function findZipEndOffset(view) {
        var minOffset = Math.max(0, view.byteLength - 65558);
        var offset;
        for (offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
          if (readUint32(view, offset) === 0x06054b50) return offset;
        }
        return -1;
      }

      function parseZip(buffer) {
        var view = new DataView(buffer);
        var bytes = new Uint8Array(buffer);
        var endOffset = findZipEndOffset(view);
        var entryCount;
        var directoryOffset;
        var offset;
        var entries = {};
        var i;

        if (endOffset < 0) throw new Error("无法识别 XLSX 文件结构");
        entryCount = readUint16(view, endOffset + 10);
        directoryOffset = readUint32(view, endOffset + 16);
        offset = directoryOffset;

        for (i = 0; i < entryCount; i += 1) {
          var signature = readUint32(view, offset);
          var flags;
          var method;
          var compressedSize;
          var fileNameLength;
          var extraLength;
          var commentLength;
          var localOffset;
          var nameBytes;
          var name;

          if (signature !== 0x02014b50) break;
          flags = readUint16(view, offset + 8);
          method = readUint16(view, offset + 10);
          compressedSize = readUint32(view, offset + 20);
          fileNameLength = readUint16(view, offset + 28);
          extraLength = readUint16(view, offset + 30);
          commentLength = readUint16(view, offset + 32);
          localOffset = readUint32(view, offset + 42);
          nameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
          name = decodeZipName(nameBytes, !!(flags & 0x0800)).replace(/\\/g, "/");

          entries[name] = {
            method: method,
            compressedSize: compressedSize,
            localOffset: localOffset
          };
          offset += 46 + fileNameLength + extraLength + commentLength;
        }

        return {
          buffer: buffer,
          bytes: bytes,
          view: view,
          entries: entries
        };
      }

      function inflateZipData(bytes) {
        var formats = ["deflate-raw", "deflate"];

        function tryFormat(index, lastError) {
          var stream;
          if (index >= formats.length) {
            return Promise.reject(lastError || new Error("当前浏览器不支持 XLSX 解压"));
          }
          try {
            stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(formats[index]));
            return new Response(stream).arrayBuffer().then(function (buffer) {
              return new Uint8Array(buffer);
            }, function (error) {
              return tryFormat(index + 1, error);
            });
          } catch (error) {
            return tryFormat(index + 1, error);
          }
        }

        if (typeof DecompressionStream !== "function") {
          return Promise.reject(new Error("当前浏览器不支持 XLSX 解压，请使用最新版 Chrome 或 Edge"));
        }
        return tryFormat(0);
      }

      function readZipEntry(zip, path) {
        var entry = zip.entries[path];
        var localOffset;
        var nameLength;
        var extraLength;
        var dataStart;
        var data;

        if (!entry) return Promise.reject(new Error("XLSX 缺少文件：" + path));
        localOffset = entry.localOffset;
        if (readUint32(zip.view, localOffset) !== 0x04034b50) {
          return Promise.reject(new Error("XLSX 文件头损坏：" + path));
        }
        nameLength = readUint16(zip.view, localOffset + 26);
        extraLength = readUint16(zip.view, localOffset + 28);
        dataStart = localOffset + 30 + nameLength + extraLength;
        data = zip.bytes.subarray(dataStart, dataStart + entry.compressedSize);

        if (entry.method === 0) return Promise.resolve(data);
        if (entry.method === 8) return inflateZipData(data);
        return Promise.reject(new Error("不支持的 XLSX 压缩方式：" + entry.method));
      }

      function readZipText(zip, path) {
        return readZipEntry(zip, path).then(function (bytes) {
          return new TextDecoder("utf-8").decode(bytes);
        });
      }

      function parseXml(text, fileName) {
        var doc = new DOMParser().parseFromString(text, "application/xml");
        if (doc.getElementsByTagName("parsererror").length) {
          throw new Error("XLSX XML 解析失败：" + fileName);
        }
        return doc;
      }

      function xmlElements(root, localName) {
        return Array.from(root.getElementsByTagName("*")).filter(function (node) {
          return node.localName === localName;
        });
      }

      function firstXmlElement(root, localName) {
        return xmlElements(root, localName)[0] || null;
      }

      function normalizeZipPath(path) {
        var parts = [];
        path.split("/").forEach(function (part) {
          if (!part || part === ".") return;
          if (part === "..") {
            parts.pop();
          } else {
            parts.push(part);
          }
        });
        return parts.join("/");
      }

      function resolveZipRelationshipTarget(basePath, target) {
        var baseParts;
        if (!target) return "";
        if (target.charAt(0) === "/") return normalizeZipPath(target.slice(1));
        baseParts = basePath.split("/");
        baseParts.pop();
        return normalizeZipPath(baseParts.concat(target.split("/")).join("/"));
      }

      function parseSharedStrings(doc) {
        return xmlElements(doc, "si").map(function (si) {
          return xmlElements(si, "t").map(function (textNode) {
            return textNode.textContent || "";
          }).join("");
        });
      }

      function cellRefToIndexes(ref) {
        var match = /^([A-Z]+)([0-9]+)$/i.exec(ref || "");
        var letters;
        var col = 0;
        var i;
        if (!match) return null;
        letters = match[1].toUpperCase();
        for (i = 0; i < letters.length; i += 1) {
          col = col * 26 + letters.charCodeAt(i) - 64;
        }
        return {
          row: parseInt(match[2], 10) - 1,
          col: col - 1
        };
      }

      function getXlsxCellText(cell, sharedStrings) {
        var type = cell.getAttribute("t") || "";
        var valueNode;
        var value;
        if (type === "inlineStr") {
          return xmlElements(cell, "t").map(function (textNode) {
            return textNode.textContent || "";
          }).join("");
        }
        valueNode = firstXmlElement(cell, "v");
        value = valueNode ? valueNode.textContent : "";
        if (type === "s") return sharedStrings[parseInt(value || "0", 10)] || "";
        if (type === "b") return value === "1" ? "TRUE" : "FALSE";
        return value;
      }

      function rowsFromWorksheetXml(doc, sharedStrings) {
        var rows = [];
        var maxRow = -1;
        var maxCol = -1;
        var currentRowIndex = 0;

        xmlElements(doc, "row").forEach(function (rowNode) {
          var rowIndex = rowNode.getAttribute("r") ? parseInt(rowNode.getAttribute("r"), 10) - 1 : currentRowIndex;
          var colCursor = 0;
          Array.from(rowNode.children).forEach(function (cell) {
            var position;
            var value;
            if (cell.localName !== "c") return;
            position = cellRefToIndexes(cell.getAttribute("r")) || { row: rowIndex, col: colCursor };
            value = getXlsxCellText(cell, sharedStrings);
            if (!rows[position.row]) rows[position.row] = [];
            rows[position.row][position.col] = value;
            maxRow = Math.max(maxRow, position.row);
            maxCol = Math.max(maxCol, position.col);
            colCursor = position.col + 1;
          });
          currentRowIndex = rowIndex + 1;
        });

        if (maxRow < 0 || maxCol < 0) return [];
        return Array.from({ length: maxRow + 1 }).map(function (_, rowIndex) {
          var source = rows[rowIndex] || [];
          return Array.from({ length: maxCol + 1 }).map(function (__, colIndex) {
            return source[colIndex] == null ? "" : String(source[colIndex]);
          });
        });
      }

      function rowsFromXlsxBuffer(buffer) {
        var zip = parseZip(buffer);
        var workbookPath = "xl/workbook.xml";
        var relsPath = "xl/_rels/workbook.xml.rels";
        var workbookDoc;
        var sheetNode;
        var relId;

        return readZipText(zip, workbookPath).then(function (text) {
          workbookDoc = parseXml(text, workbookPath);
          sheetNode = xmlElements(workbookDoc, "sheet")[0];
          if (!sheetNode) throw new Error("XLSX 中没有可读取的工作表");
          relId = sheetNode.getAttribute("r:id") || sheetNode.getAttribute("id");
          return readZipText(zip, relsPath);
        }).then(function (text) {
          var relsDoc = parseXml(text, relsPath);
          var relationship = xmlElements(relsDoc, "Relationship").find(function (rel) {
            return rel.getAttribute("Id") === relId;
          });
          var target = relationship && relationship.getAttribute("Target");
          var sheetPath = resolveZipRelationshipTarget(workbookPath, target);
          var sharedStringsPromise = zip.entries["xl/sharedStrings.xml"] ?
            readZipText(zip, "xl/sharedStrings.xml").then(function (sharedText) {
              return parseSharedStrings(parseXml(sharedText, "xl/sharedStrings.xml"));
            }) :
            Promise.resolve([]);

          if (!sheetPath || !zip.entries[sheetPath]) throw new Error("XLSX 工作表文件缺失");
          return Promise.all([readZipText(zip, sheetPath), sharedStringsPromise]).then(function (parts) {
            return rowsFromWorksheetXml(parseXml(parts[0], sheetPath), parts[1]);
          });
        });
      }

      function cleanImportedRows(rows) {
        var maxCols = 0;
        var firstUsedCol = 0;
        var lastUsedCol = -1;
        rows = (rows || []).map(function (row) {
          return (row || []).map(function (cell) {
            return cell == null ? "" : String(cell);
          });
        });
        while (rows.length && rows[0].every(function (cell) { return cell.trim() === ""; })) {
          rows.shift();
        }
        while (rows.length && rows[rows.length - 1].every(function (cell) { return cell.trim() === ""; })) {
          rows.pop();
        }
        rows.forEach(function (row) {
          maxCols = Math.max(maxCols, row.length);
        });
        rows = rows.map(function (row) {
          while (row.length < maxCols) row.push("");
          return row;
        });

        for (firstUsedCol = 0; firstUsedCol < maxCols; firstUsedCol += 1) {
          if (rows.some(function (row) { return String(row[firstUsedCol] || "").trim() !== ""; })) break;
        }
        for (lastUsedCol = maxCols - 1; lastUsedCol >= firstUsedCol; lastUsedCol -= 1) {
          if (rows.some(function (row) { return String(row[lastUsedCol] || "").trim() !== ""; })) break;
        }
        if (lastUsedCol < firstUsedCol) return [];
        return rows.map(function (row) {
          return row.slice(firstUsedCol, lastUsedCol + 1);
        });
      }

      function replaceTableWithRows(table, rows) {
        var thead = table.tHead || table.createTHead();
        var tbody = table.tBodies[0] || table.createTBody();
        var headerRow;
        var bodyRows;
        var colCount;

        rows = cleanImportedRows(rows);
        if (!rows.length || !rows[0].length) throw new Error("文件中没有可导入的表格数据");

        colCount = rows[0].length;
        thead.innerHTML = "";
        tbody.innerHTML = "";

        headerRow = document.createElement("tr");
        rows[0].forEach(function (value) {
          headerRow.appendChild(createCell("th", value));
        });
        thead.appendChild(headerRow);

        bodyRows = rows.slice(1);
        if (!bodyRows.length) bodyRows = [Array.from({ length: colCount }).map(function () { return ""; })];
        bodyRows.forEach(function (rowData) {
          var row = document.createElement("tr");
          rowData.forEach(function (value) {
            row.appendChild(createCell("td", value));
          });
          tbody.appendChild(row);
        });

        makeCellsEditable(table);
        selectedCell = null;
        schedulePagination(80, { afterPaint: true });
        saveActivePage();
      }

      function importRowsFromFile(file) {
        var fileName = file && file.name ? file.name : "";
        return readFileAsArrayBuffer(file).then(function (buffer) {
          if (/\.xlsx$/i.test(fileName)) return rowsFromXlsxBuffer(buffer);
          if (/\.(csv|tsv)$/i.test(fileName)) return rowsFromDelimitedBuffer(buffer, fileName);
          throw new Error("仅支持 .xlsx、.csv、.tsv 文件");
        });
      }

      function openTableImport(table) {
        currentTableImportTarget = table;
        if (!tableImportInput) return;
        tableImportInput.value = "";
        tableImportInput.click();
      }

      function bindTableImportInput() {
        if (!tableImportInput || tableImportInputBound) return;
        tableImportInputBound = true;
        tableImportInput.addEventListener("change", function () {
          var file = tableImportInput.files && tableImportInput.files[0];
          var table = currentTableImportTarget;
          if (!file || !table) return;
          setTableImportStatus(table, "正在导入...", false);
          importRowsFromFile(file).then(function (rows) {
            replaceTableWithRows(table, rows);
            setTableImportStatus(table, "已导入：" + file.name, false);
          }, function (error) {
            var message = error && error.message ? error.message : "导入失败";
            setTableImportStatus(table, message, true);
            alert(message);
          });
        });
      }

      function ensureColumnCount(table, count) {
        while (cellCount(table) < count) {
          addCol(table, { silent: true });
        }
      }

      function ensureBodyRow(table, rowIndex) {
        while (table.tBodies[0].rows.length <= rowIndex) {
          addRow(table, { silent: true });
        }
        return table.tBodies[0].rows[rowIndex];
      }

      function normalizeRows(rows) {
        return rows.filter(function (row) {
          return row.some(function (cell) {
            return String(cell).trim() !== "";
          });
        });
      }

      function rowsFromHtmlTable(html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var table = doc.querySelector("table");
        if (!table) return null;
        return Array.from(table.rows).map(function (row) {
          return Array.from(row.cells).map(function (cell) {
            return (cell.innerText || cell.textContent || "").trim();
          });
        });
      }

      function rowsFromPlainText(text) {
        return text.replace(/\r/g, "").split("\n").map(function (line) {
          return line.split("\t");
        });
      }

      function pasteRowsIntoTable(table, startCell, rows) {
        rows = normalizeRows(rows);
        if (!rows.length) return;

        var startRow = 0;
        var startCol = 0;
        if (startCell) {
          startCol = startCell.cellIndex;
          var row = startCell.closest("tr");
          startRow = row.parentElement.tagName === "THEAD" ? -1 : Array.prototype.indexOf.call(table.tBodies[0].rows, row);
        }

        var neededCols = startCol + Math.max.apply(null, rows.map(function (row) { return row.length; }));
        ensureColumnCount(table, neededCols);

        rows.forEach(function (rowData, rowOffset) {
          var targetRow;
          if (startRow === -1 && rowOffset === 0) {
            targetRow = table.tHead.rows[0];
          } else {
            var bodyIndex = startRow === -1 ? rowOffset - 1 : startRow + rowOffset;
            targetRow = ensureBodyRow(table, bodyIndex);
          }

          rowData.forEach(function (value, colOffset) {
            var cell = targetRow.cells[startCol + colOffset];
            if (cell) {
              cell.textContent = value;
              cell.contentEditable = "true";
            }
          });
        });
        schedulePagination();
      }

      function handleTablePaste(event) {
        var cell = event.target.closest("td, th");
        var table = event.target.closest("[data-editable-table]");
        if (!cell || !table) return;

        var clipboard = event.clipboardData;
        if (!clipboard) return;

        var html = clipboard.getData("text/html");
        var plain = clipboard.getData("text/plain");
        var rows = html ? rowsFromHtmlTable(html) : null;
        if (!rows && plain && (plain.indexOf("\t") !== -1 || plain.indexOf("\n") !== -1)) {
          rows = rowsFromPlainText(plain);
        }

        if (rows && rows.length) {
          event.preventDefault();
          pasteRowsIntoTable(table, cell, rows);
        }
      }

      function bindTableControls(scope) {
        scope = scope || document;
        bindTableImportInput();
        scope.querySelectorAll("[data-editable-table]").forEach(function (table) {
          makeCellsEditable(table);
          if (boundTables.has(table)) return;
          boundTables.add(table);
          table.addEventListener("focusin", function (event) {
            var cell = event.target.closest("td, th");
            if (cell) selectedCell = cell;
          });
          table.addEventListener("paste", handleTablePaste);
        });

        scope.querySelectorAll("[data-table-block]").forEach(function (block) {
          ensureTableImportControls(block);
          if (boundTableBlocks.has(block)) return;
          boundTableBlocks.add(block);
          var table = block.querySelector("[data-editable-table]");
          block.querySelectorAll("[data-action]").forEach(function (button) {
            button.addEventListener("click", function () {
              var action = button.dataset.action;
              if (action === "add-row") addRow(table);
              if (action === "delete-row") deleteRow(table);
              if (action === "add-col") addCol(table);
              if (action === "delete-col") deleteCol(table);
              if (action === "clear-table") clearTable(table);
              if (action === "import-table") openTableImport(table);
            });
          });
        });
      }

      function updateImageZoneState(zone) {
        var hasImages = zone.querySelectorAll(".image-item").length > 0;
        var imageCount = zone.querySelectorAll(".image-item").length;
        zone.classList.toggle("has-images", hasImages);
        zone.classList.remove("image-count-1", "image-count-2", "image-count-many");
        if (imageCount === 1) zone.classList.add("image-count-1");
        if (imageCount === 2) zone.classList.add("image-count-2");
        if (imageCount > 2) zone.classList.add("image-count-many");
      }

      function createImageEditActions(config) {
        var actions = document.createElement("div");
        actions.className = "image-edit-actions";

        var editButton = document.createElement("button");
        editButton.className = "btn";
        editButton.type = "button";
        editButton.setAttribute("data-open-overlay-editor", config.zoneType);
        editButton.textContent = config.editLabel;
        actions.appendChild(editButton);

        var clearButton = document.createElement("button");
        clearButton.className = "btn";
        clearButton.type = "button";
        clearButton.setAttribute("data-clear-image-zone", config.zoneType);
        clearButton.textContent = config.clearLabel;
        actions.appendChild(clearButton);

        var hint = document.createElement("span");
        hint.className = "image-edit-hint";
        hint.textContent = config.hint;
        actions.appendChild(hint);

        return actions;
      }

      function ensureImageEditActions(scope) {
        [
          ".function-block-image[data-image-zone]",
          ".dimension-images[data-image-zone]",
          ".assembly-image[data-image-zone]"
        ].forEach(function (selector) {
          var zone = scope.querySelector(selector);
          if (!zone || !zone.parentNode) return;
          var actions = zone.previousElementSibling;
          if (actions && actions.classList && actions.classList.contains("image-edit-actions")) {
            actions.parentNode.removeChild(actions);
          }
        });
      }

      function clearImageZone(zone) {
        var list = zone && zone.querySelector(".image-list");
        if (!zone || !list) return;
        list.innerHTML = "";
        delete zone.dataset.layoutDimensionScene;
        delete zone.dataset.layoutAssemblyScene;
        delete zone.dataset.layoutFunctionBlockScene;
        updateImageZoneState(zone);
        schedulePagination();
        saveActivePage();
      }

      function ensureManualImageResizeHandle(item) {
        if (!item || (item.dataset.manualImage !== "true" && !item.classList.contains("scene-item"))) return;
        item.querySelectorAll(".image-resize-handle:not([data-resize-mode])").forEach(function (handle) {
          handle.remove();
        });
        [
          { mode: "width", label: "左右拖动，单独调整图片宽度" },
          { mode: "height", label: "上下拖动，单独调整图片高度" },
          { mode: "proportional", label: "拖动，按当前比例整体缩放图片" }
        ].forEach(function (config) {
          if (item.querySelector('.image-resize-handle[data-resize-mode="' + config.mode + '"]')) return;
          var handle = document.createElement("button");
          handle.className = "image-resize-handle image-resize-handle--" + config.mode;
          handle.type = "button";
          handle.dataset.resizeMode = config.mode;
          handle.title = config.label;
          handle.setAttribute("aria-label", config.label + "；按方向键可微调");
          item.appendChild(handle);
        });
      }

      function initializeManualImageFrame(item) {
        if (!item || item.dataset.manualImage !== "true" || item.dataset.imageSizeInitialized === "true") return;
        if (!document.documentElement.contains(item)) return;
        var img = item.querySelector("img");
        if (!img) return;
        if (item.style.width && item.style.height) {
          item.dataset.imageSizeInitialized = "true";
          return;
        }
        if (!img.complete || !img.naturalWidth || !img.naturalHeight) {
          if (!boundManualImageLoads.has(img)) {
            boundManualImageLoads.add(img);
            img.addEventListener("load", function () {
              initializeManualImageFrame(item);
            }, { once: true });
          }
          return;
        }
        var rect = item.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          window.requestAnimationFrame(function () {
            initializeManualImageFrame(item);
          });
          return;
        }
        var imageRatio = img.naturalWidth / img.naturalHeight;
        var frameRatio = rect.width / rect.height;
        var width = rect.width;
        var height = rect.height;
        if (frameRatio > imageRatio) {
          width = height * imageRatio;
        } else {
          height = width / imageRatio;
        }
        item.dataset.imageSizeInitialized = "true";
        item.style.width = Math.max(24, Math.round(width)) + "px";
        item.style.height = Math.max(24, Math.round(height)) + "px";
        schedulePagination(80, { afterPaint: true });
        saveActivePage();
      }

      function ensureManualImageResizeHandles(scope) {
        (scope || document).querySelectorAll('.image-item[data-manual-image="true"], .image-item.scene-item').forEach(function (item) {
          ensureManualImageResizeHandle(item);
          initializeManualImageFrame(item);
        });
      }

      function addImageToZone(zone, dataUrl, options) {
        options = options || {};
        var multiple = zone.dataset.multiple === "true";
        var list = zone.querySelector(".image-list");
        if (!multiple) list.innerHTML = "";

        var item = document.createElement("figure");
        item.className = "image-item";
        if (options.manual !== false) item.dataset.manualImage = "true";

        var img = document.createElement("img");
        img.src = dataUrl;
        img.alt = "产品手册图片";
        img.draggable = false;

        var remove = document.createElement("button");
        remove.className = "remove-image";
        remove.type = "button";
        remove.textContent = "\u00d7";
        remove.title = "\u5220\u9664\u56fe\u7247";
        remove.setAttribute("aria-label", "\u5220\u9664\u56fe\u7247");
        remove.addEventListener("click", function (event) {
          event.stopPropagation();
          item.remove();
          updateImageZoneState(zone);
          schedulePagination();
          saveActivePage();
        });

        item.appendChild(img);
        item.appendChild(remove);
        list.appendChild(item);
        ensureManualImageResizeHandle(item);
        initializeManualImageFrame(item);
        updateImageZoneState(zone);
        schedulePagination();
        saveActivePage();
      }

      function replaceImageZoneImages(zone, sources) {
        var list = zone && zone.querySelector(".image-list");
        if (!zone || !list) return;
        list.innerHTML = "";
        (sources || []).forEach(function (src) {
          if (!src) return;
          addImageToZone(zone, src, { manual: false });
        });
        updateImageZoneState(zone);
        schedulePagination();
        saveActivePage();
      }

      function readFilesIntoZone(zone, files) {
        Array.from(files).forEach(function (file) {
          if (!file.type || file.type.indexOf("image/") !== 0) return;
          var reader = new FileReader();
          reader.onload = function (event) {
            addImageToZone(zone, event.target.result, { manual: true });
          };
          reader.readAsDataURL(file);
        });
      }

      function manualImageResizeLimits(item) {
        var list = item.closest(".image-list");
        var listStyle = list ? window.getComputedStyle(list) : null;
        var columns = listStyle && listStyle.gridTemplateColumns !== "none"
          ? listStyle.gridTemplateColumns.split(/\s+/).map(parseFloat).filter(Number.isFinite)
          : [];
        var horizontalPadding = listStyle
          ? parseFloat(listStyle.paddingLeft || 0) + parseFloat(listStyle.paddingRight || 0)
          : 0;
        var availableWidth = list ? Math.max(72, list.clientWidth - horizontalPadding) : 720;
        var pageContent = item.closest(".page-content");
        return {
          minWidth: 72,
          minHeight: 54,
          maxWidth: Math.max(72, columns.length ? columns[0] : availableWidth),
          maxHeight: Math.max(54, Math.min(680, pageContent ? pageContent.clientHeight * 0.72 : 680))
        };
      }

      function applyManualImageSize(item, width, height, limits) {
        limits = limits || manualImageResizeLimits(item);
        var nextWidth = Math.max(limits.minWidth, Math.min(limits.maxWidth, width));
        var nextHeight = Math.max(limits.minHeight, Math.min(limits.maxHeight, height));
        item.style.width = Math.round(nextWidth) + "px";
        item.style.height = Math.round(nextHeight) + "px";
        var sceneSvg = item.classList.contains("scene-item") && item.querySelector("svg.scene-svg");
        if (sceneSvg) sceneSvg.setAttribute("preserveAspectRatio", "none");
        item.querySelectorAll(".image-resize-handle").forEach(function (handle) {
          handle.setAttribute("aria-valuetext", Math.round(nextWidth) + " × " + Math.round(nextHeight) + " 像素");
        });
      }

      function finishManualImageResize(event) {
        if (!activeImageResize || (event && event.pointerId != null && event.pointerId !== activeImageResize.pointerId)) return;
        activeImageResize.item.classList.remove("is-resizing");
        document.body.classList.remove(
          "is-resizing-image",
          "is-resizing-image-width",
          "is-resizing-image-height",
          "is-resizing-image-proportional"
        );
        activeImageResize = null;
        schedulePagination(80, { afterPaint: true });
        saveActivePage();
      }

      function bindManualImageResizing() {
        addGlobalListener("pointerdown", function (event) {
          var handle = event.target.closest(".image-resize-handle");
          var item = handle && handle.closest('.image-item[data-manual-image="true"], .image-item.scene-item');
          if (!item || !manual.contains(item) || (event.button != null && event.button !== 0)) return;
          var rect = item.getBoundingClientRect();
          var mode = handle.dataset.resizeMode || "proportional";
          event.preventDefault();
          event.stopPropagation();
          activeImageResize = {
            item: item,
            handle: handle,
            mode: mode,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: rect.width,
            startHeight: rect.height,
            limits: manualImageResizeLimits(item)
          };
          item.classList.add("is-resizing");
          document.body.classList.add("is-resizing-image", "is-resizing-image-" + mode);
          if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
        });

        addGlobalListener("pointermove", function (event) {
          if (!activeImageResize || event.pointerId !== activeImageResize.pointerId) return;
          var state = activeImageResize;
          var nextWidth = state.startWidth;
          var nextHeight = state.startHeight;
          var widthCandidate = state.startWidth + (event.clientX - state.startX) * 2;
          var heightCandidate = state.startHeight + (event.clientY - state.startY);
          event.preventDefault();
          if (state.mode === "width") {
            nextWidth = widthCandidate;
          } else if (state.mode === "height") {
            nextHeight = heightCandidate;
          } else {
            var widthScale = widthCandidate / state.startWidth;
            var heightScale = heightCandidate / state.startHeight;
            var scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;
            var minScale = Math.max(state.limits.minWidth / state.startWidth, state.limits.minHeight / state.startHeight);
            var maxScale = Math.min(state.limits.maxWidth / state.startWidth, state.limits.maxHeight / state.startHeight);
            scale = Math.max(minScale, Math.min(maxScale, scale));
            nextWidth = state.startWidth * scale;
            nextHeight = state.startHeight * scale;
          }
          applyManualImageSize(state.item, nextWidth, nextHeight, state.limits);
        });

        addGlobalListener("pointerup", finishManualImageResize);
        addGlobalListener("pointercancel", finishManualImageResize);
        addGlobalListener("keydown", function (event) {
          var handle = event.target.closest && event.target.closest(".image-resize-handle");
          var item = handle && handle.closest('.image-item[data-manual-image="true"], .image-item.scene-item');
          if (!item || !manual.contains(item) || !/^Arrow/.test(event.key)) return;
          var rect = item.getBoundingClientRect();
          var step = event.shiftKey ? 2 : 10;
          var width = rect.width;
          var height = rect.height;
          var mode = handle.dataset.resizeMode || "proportional";
          event.preventDefault();
          event.stopPropagation();
          if (mode === "width") {
            if (event.key === "ArrowLeft") width -= step;
            if (event.key === "ArrowRight") width += step;
          } else if (mode === "height") {
            if (event.key === "ArrowUp") height -= step;
            if (event.key === "ArrowDown") height += step;
          } else {
            var direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
            var scale = Math.max(0.01, (width + direction * step) / width);
            width *= scale;
            height *= scale;
          }
          applyManualImageSize(item, width, height);
          schedulePagination(80, { afterPaint: true });
          saveActivePage();
        });
      }

      function updateCurveSectionState(section) {
        if (!section) return;
        var target = section.matches && section.matches("[data-curve-target]") ? section : section.querySelector("[data-curve-target]");
        if (!target) return;
        target.classList.toggle("has-curves", target.querySelectorAll(".curve-embed").length > 0);
      }

      function findTypicalCurveSection(scope) {
        scope = scope || manual;
        return Array.from(scope.querySelectorAll(".section")).find(function (section) {
          return isTypicalCurveSection(section);
        });
      }

      function curvePayloadTitle(payload) {
        var config = payload && payload.config ? payload.config : {};
        var template = curveTemplateById(payload && payload.templateId);
        var resources = payload && payload.resources || [];
        var resourceName = resources.length === 1 ? curveFileStem(resources[0].name || resources[0].sourcePath || "") : "";
        if (config.title) return config.title;
        if (resourceName && template.mode === "single") return (template.title || "典型曲线") + " - " + resourceName;
        return template.title || "典型曲线";
      }

      function curveTemplateById(templateId) {
        return manualCurveTemplates[templateId] || manualCurveTemplates.gain_vswr;
      }

      function setCurveStatus(message, isError) {
        var status = document.querySelector("[data-curve-status]");
        if (!status) return;
        status.textContent = message || "";
        status.classList.toggle("is-error", !!isError);
      }

      function compactCurveResource(resource) {
        return {
          id: resource.id,
          name: resource.name,
          sourcePath: resource.sourcePath,
          kind: resource.kind,
          temperature: resource.temperature,
          voltage: resource.voltage,
          seriesLabel: resource.seriesLabel,
          importFingerprint: resource.importFingerprint,
          network: resource.network
        };
      }

      function readCurvePayload(embed) {
        var script = embed && embed.querySelector("[data-curve-data]");
        if (!script || !script.textContent.trim()) return null;
        try {
          return JSON.parse(script.textContent);
        } catch (error) {
          return null;
        }
      }

      function writeCurvePayload(embed, payload) {
        var script = embed.querySelector("[data-curve-data]");
        if (!script) {
          script = document.createElement("script");
          script.type = "application/json";
          script.dataset.curveData = "true";
          embed.appendChild(script);
        }
        script.textContent = JSON.stringify(payload);
      }

      function packagePayloadTitle(payload) {
        var config = payload && payload.config ? payload.config : {};
        return config.title || "典型曲线";
      }

      function updateCurveEmbedImage(embed, payload) {
        var title = packagePayloadTitle(payload);
        var config = payload.config || {};
        var mediaHost = embed.querySelector("[data-curve-media]");
        var image = document.createElement("img");
        embed.dataset.curveName = title;
        embed.dataset.curveType = "image-package";
        embed.draggable = true;
        embed.querySelector(".curve-name").textContent = title;
        image.className = "curve-frame";
        image.alt = title;
        image.src = payload.imageData || payload.src || "";
        mediaHost.innerHTML = "";
        mediaHost.appendChild(image);
        if (config.caption || config.notes) {
          var meta = document.createElement("div");
          meta.className = "curve-caption editable";
          meta.contentEditable = "true";
          meta.textContent = [config.caption, config.notes].filter(Boolean).join("  ");
          mediaHost.appendChild(meta);
        }
        writeCurvePayload(embed, payload);
      }

      function resolveFrequencyUnit(configUnit, networks) {
        var requested = String(configUnit || "auto");
        var maxHz = 0;
        if (requested !== "auto") return requested;
        (Array.isArray(networks) ? networks : [networks]).forEach(function (network) {
          (network && network.rows || []).forEach(function (row) {
            if (Number.isFinite(row.f)) maxHz = Math.max(maxHz, row.f);
          });
        });
        if (maxHz >= 1e9) return "GHz";
        if (maxHz >= 1e6) return "MHz";
        if (maxHz >= 1e3) return "kHz";
        return "Hz";
      }

      function splitAxisLabel(label) {
        var text = String(label || "").trim();
        var match;
        if (!text) return { title: "", unit: "" };
        match = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(text);
        if (match) {
          return { title: match[1].trim(), unit: match[2].trim() };
        }
        return { title: text, unit: "" };
      }

      function joinAxisLabel(title, unit, fallbackLabel) {
        var finalTitle = String(title || "").trim();
        var finalUnit = String(unit || "").trim();
        var fallback = splitAxisLabel(fallbackLabel || "");
        if (!finalTitle) finalTitle = fallback.title;
        if (!finalUnit) finalUnit = fallback.unit;
        if (!finalTitle) return finalUnit || "";
        return finalUnit ? (finalTitle + "(" + finalUnit + ")") : finalTitle;
      }

      function displayFrequencyScale(unit) {
        if (unit === "GHz") return 1e9;
        if (unit === "MHz") return 1e6;
        if (unit === "kHz") return 1e3;
        return 1;
      }

      function curveMetricValue(resource, row, metric) {
        var parameters = row && row.p ? row.p : {};
        if (metric === "gain") {
          if (resource.kind === "p" && parameters.S11) return complexDb(parameters.S11);
          return parameters.S21 ? complexDb(parameters.S21) : null;
        }
        if (metric === "vswr_in") return parameters.S11 ? complexVswr(parameters.S11) : null;
        if (metric === "vswr_out") return parameters.S22 ? complexVswr(parameters.S22) : null;
        if (metric === "iso") return parameters.S12 ? complexDb(parameters.S12) : null;
        if (metric === "nf") {
          if (!parameters.S11) return null;
          if (Math.abs(parameters.S11[1] || 0) < 1e-6) return parameters.S11[0];
          return complexDb(parameters.S11);
        }
        if (metric === "p1db") {
          if (parameters.S21) return complexDb(parameters.S21);
          return parameters.S11 ? complexDb(parameters.S11) : null;
        }
        return null;
      }

      function lineStyleForSeries(resource, index, groupBy, metric, axis) {
        var value = groupBy === "temperature" ? resource.temperature : (groupBy === "voltage" ? resource.voltage : null);
        if (groupBy === "temperature") {
          if (value === -55) return { color: "#ff0000", dash: [16, 10] };
          if (value === 25) return { color: "#111111", dash: [] };
          if (value === 125) return { color: "#003cff", dash: [8, 8] };
        }
        if (groupBy === "voltage") {
          if (value === 4.5) return { color: "#ff0000", dash: [16, 10] };
          if (value === 5) return { color: "#111111", dash: [] };
          if (value === 5.5) return { color: "#003cff", dash: [8, 8] };
        }
        if (metric === "vswr_in") return { color: "#ff0000", dash: [16, 10] };
        if (metric === "vswr_out") return { color: "#003cff", dash: [8, 8] };
        if (axis === "right") return { color: "#003cff", dash: [8, 8] };
        return { color: curvePalette[index % curvePalette.length], dash: index % 3 === 0 ? [] : (index % 3 === 1 ? [16, 10] : [8, 8]) };
      }

      function curveLegendLabel(resource, groupBy, fallback) {
        if (groupBy === "temperature" && resource.temperature != null) {
          return (resource.temperature > 0 ? "+" : "") + resource.temperature + "C";
        }
        if (groupBy === "voltage" && resource.voltage != null) return curveVoltageLabel(resource.voltage);
        return fallback || resource.seriesLabel || curveFileStem(resource.name || "");
      }

      function sortCurveResources(resources, groupBy) {
        var order = groupBy === "temperature" ? temperatureSeriesOrder : voltageSeriesOrder;
        return resources.slice().sort(function (a, b) {
          var av = groupBy ? a[groupBy] : null;
          var bv = groupBy ? b[groupBy] : null;
          var ai = order.indexOf(av);
          var bi = order.indexOf(bv);
          if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          if (av != null && bv != null && av !== bv) return av - bv;
          return String(a.name).localeCompare(String(b.name));
        });
      }

      function nominalCurveResource(resources, kind) {
        var candidates = (resources || []).filter(function (resource) {
          return !kind || resource.kind === kind;
        });
        return candidates.find(function (resource) { return resource.temperature === 25 && resource.voltage === 5; }) ||
          candidates.find(function (resource) { return resource.temperature === 25; }) ||
          candidates.find(function (resource) { return resource.voltage === 5; }) ||
          candidates.find(function (resource) { return resource.temperature == null && resource.voltage == null; }) ||
          candidates[0] || null;
      }

      function resourcesForTemplate(templateId, resources, selectedResource) {
        var template = curveTemplateById(templateId);
        var pool = (resources || []).filter(function (resource) {
          return !template.kind || resource.kind === template.kind;
        });
        var selected = selectedResource && (!template.kind || selectedResource.kind === template.kind) ? selectedResource : null;
        if (template.groupBy === "temperature" || template.groupBy === "voltage") {
          var keyed = pool.filter(function (resource) {
            return resource[template.groupBy] != null;
          });
          return sortCurveResources(keyed.length ? keyed : pool, template.groupBy);
        }
        if (selected) return [selected];
        selected = nominalCurveResource(pool, template.kind);
        return selected ? [selected] : [];
      }

      function defaultCurveConfig() {
        return {
          templateId: "auto-suite",
          title: "",
          xTitle: "",
          xUnitLabel: "",
          yTitle: "",
          yUnitLabel: "",
          y2Title: "",
          y2UnitLabel: "",
          xUnit: "auto",
          xMin: null,
          xMax: null,
          yMin: null,
          yMax: null,
          y2Min: null,
          y2Max: null,
          lineWidth: 3.25,
          fontSize: 20,
          legendLabels: []
        };
      }

      function normalizeLegendLabels(labels) {
        if (Array.isArray(labels)) {
          return labels.map(function (label) {
            return String(label || "").trim();
          }).filter(Boolean);
        }
        return String(labels || "").split(/\r?\n|[;,，；]+/).map(function (label) {
          return label.trim();
        }).filter(Boolean);
      }

      function curveFontSizes(baseSize) {
        var base = clampNumber(baseSize, 12, 36, 20);
        return {
          tick: base,
          axisTitle: base + 4,
          title: base + 10,
          legend: Math.max(12, base - 1),
          empty: base + 2
        };
      }

      function curveEditorRoot() {
        return document.querySelector("[data-curve-editor-modal]");
      }

      function readCurveConfigFromRoot(root) {
        var config = defaultCurveConfig();
        function value(selector) {
          var node = root && root.querySelector(selector);
          return node ? node.value : "";
        }
        if (!root) return config;
        config.templateId = value("[data-curve-template]") || config.templateId;
        config.title = value("[data-curve-title]").trim();
        config.xTitle = value("[data-curve-x-title]").trim();
        config.xUnitLabel = value("[data-curve-x-unit-label]").trim();
        config.yTitle = value("[data-curve-y-title]").trim();
        config.yUnitLabel = value("[data-curve-y-unit-label]").trim();
        config.y2Title = value("[data-curve-y2-title]").trim();
        config.y2UnitLabel = value("[data-curve-y2-unit-label]").trim();
        config.xUnit = value("[data-curve-x-unit]") || config.xUnit;
        config.xMin = numberOrNull(value("[data-curve-x-min]"));
        config.xMax = numberOrNull(value("[data-curve-x-max]"));
        config.yMin = numberOrNull(value("[data-curve-y-min]"));
        config.yMax = numberOrNull(value("[data-curve-y-max]"));
        config.y2Min = numberOrNull(value("[data-curve-y2-min]"));
        config.y2Max = numberOrNull(value("[data-curve-y2-max]"));
        config.lineWidth = clampNumber(value("[data-curve-line-width]"), 1.5, 6, config.lineWidth);
        config.fontSize = clampNumber(value("[data-curve-font-size]"), 12, 36, config.fontSize);
        config.legendLabels = normalizeLegendLabels(value("[data-curve-legend-labels]"));
        return config;
      }

      function readCurveConfigFromEditor() {
        return readCurveConfigFromRoot(curveEditorRoot());
      }

      function fillCurveEditorFromPayload(payload) {
        var root = curveEditorRoot();
        var config = payload && payload.config ? payload.config : {};
        var xInfo = splitAxisLabel(config.xLabel || "");
        var yInfo = splitAxisLabel(config.yLabel || "");
        var y2Info = splitAxisLabel(config.y2Label || "");
        var legendLabels = payload && payload.type !== "image-package"
          ? createChartModel(payload).series.map(function (item) { return item.label; })
          : normalizeLegendLabels(config.legendLabels);
        var subtitle = root && root.querySelector("[data-curve-editor-selected]");
        if (!root) return;
        function setValue(selector, value) {
          var node = root.querySelector(selector);
          if (node) node.value = value == null ? "" : value;
        }
        setValue("[data-curve-template]", payload && payload.templateId || "gain_vswr");
        setValue("[data-curve-title]", config.title || "");
        setValue("[data-curve-x-title]", config.xTitle || xInfo.title || "");
        setValue("[data-curve-x-unit-label]", config.xUnitLabel || xInfo.unit || "");
        setValue("[data-curve-y-title]", config.yTitle || yInfo.title || "");
        setValue("[data-curve-y-unit-label]", config.yUnitLabel || yInfo.unit || "");
        setValue("[data-curve-y2-title]", config.y2Title || y2Info.title || "");
        setValue("[data-curve-y2-unit-label]", config.y2UnitLabel || y2Info.unit || "");
        setValue("[data-curve-x-unit]", config.xUnit || "auto");
        setValue("[data-curve-line-width]", config.lineWidth || 3.25);
        setValue("[data-curve-font-size]", config.fontSize || 20);
        setValue("[data-curve-legend-labels]", legendLabels.join("\n"));
        setValue("[data-curve-x-min]", config.xMin);
        setValue("[data-curve-x-max]", config.xMax);
        setValue("[data-curve-y-min]", config.yMin);
        setValue("[data-curve-y-max]", config.yMax);
        setValue("[data-curve-y2-min]", config.y2Min);
        setValue("[data-curve-y2-max]", config.y2Max);
        if (subtitle) {
          subtitle.textContent = payload ? ("当前曲线：" + curvePayloadTitle(payload)) : "请点击手册中的曲线图进行编辑";
        }
      }

      function closeCurveEditor() {
        var root = curveEditorRoot();
        if (!root) return;
        root.classList.add("is-hidden");
        root.setAttribute("aria-hidden", "true");
      }

      function openCurveEditor(payload) {
        var root = curveEditorRoot();
        var titleField;
        if (!root) return;
        fillCurveEditorFromPayload(payload);
        root.classList.remove("is-hidden");
        root.setAttribute("aria-hidden", "false");
        titleField = root.querySelector("[data-curve-title]");
        if (titleField) {
          window.setTimeout(function () {
            titleField.focus();
            titleField.select();
          }, 0);
        }
      }

      function buildCurvePayload(templateId, sourcePool, config, selectedResource) {
        var template = curveTemplateById(templateId);
        var resources = resourcesForTemplate(templateId, sourcePool, selectedResource);
        if (!resources.length) throw new Error("当前模板缺少可用的 " + curveKindLabel(template.kind) + " 文件");
        return {
          version: 3,
          templateId: templateId,
          resources: resources.map(compactCurveResource),
          config: {
            title: config.title || "",
            xTitle: config.xTitle || "",
            xUnitLabel: config.xUnitLabel || "",
            yTitle: config.yTitle || "",
            yUnitLabel: config.yUnitLabel || "",
            y2Title: config.y2Title || "",
            y2UnitLabel: config.y2UnitLabel || "",
            xUnit: config.xUnit || "auto",
            xMin: config.xMin,
            xMax: config.xMax,
            yMin: config.yMin,
            yMax: config.yMax,
            y2Min: config.y2Min,
            y2Max: config.y2Max,
            lineWidth: clampNumber(config.lineWidth, 1.5, 6, 3.25),
            fontSize: clampNumber(config.fontSize, 12, 36, 20),
            legendLabels: normalizeLegendLabels(config.legendLabels)
          }
        };
      }

      function buildManualCurveSuite(sourcePool, config) {
        var sResources = sourcePool.filter(function (resource) { return resource.kind === "s"; });
        var nfResources = sourcePool.filter(function (resource) { return resource.kind === "nf"; });
        var pResources = sourcePool.filter(function (resource) { return resource.kind === "p"; });
        var tempSCount = sResources.filter(function (resource) { return resource.temperature != null; }).length;
        var voltSCount = sResources.filter(function (resource) { return resource.voltage != null; }).length;
        var tempNfCount = nfResources.filter(function (resource) { return resource.temperature != null; }).length;
        var tempPCount = pResources.filter(function (resource) { return resource.temperature != null; }).length;
        var payloads = [];

        function pushPayload(templateId, pool, selected) {
          payloads.push(buildCurvePayload(templateId, pool, Object.assign({}, config, { title: "" }), selected || null));
        }

        function uniqueResources(resources) {
          var seen = {};
          return resources.filter(function (resource) {
            var key = resource.id || resource.sourcePath || resource.name;
            if (seen[key]) return false;
            seen[key] = true;
            return true;
          });
        }

        uniqueResources(sResources).forEach(function (resource) {
          pushPayload("gain_vswr", [resource], resource);
        });
        if (tempSCount >= 2) {
          pushPayload("gain_temp", sourcePool, null);
          pushPayload("vswr_in_temp", sourcePool, null);
          pushPayload("vswr_out_temp", sourcePool, null);
          pushPayload("iso_temp", sourcePool, null);
        }
        if (voltSCount >= 2) {
          pushPayload("gain_voltage", sourcePool, null);
        }
        if (tempNfCount >= 2) {
          pushPayload("nf_temp", sourcePool, null);
        }
        uniqueResources(nfResources).forEach(function (resource) {
          pushPayload("nf_frequency", [resource], resource);
        });

        if (tempPCount >= 2) {
          pushPayload("p1db_temp", sourcePool, null);
        }
        uniqueResources(pResources).forEach(function (resource) {
          pushPayload("p1db_frequency", [resource], resource);
        });

        return payloads;
      }

      function sourceToCurvePayload(source, config) {
        var sourcePool;
        var selectedResource;
        var templateId;
        if (!source) throw new Error("请先加载并选择一个 S 参数文件");
        config = config || {};
        sourcePool = source.sourcePool || (curveResources.length ? curveResources.slice() : [source]);
        selectedResource = source.selectedResource || source;
        templateId = config.templateId || "auto-suite";
        if (templateId === "auto-suite") {
          if (selectedResource.kind === "nf") templateId = "nf_frequency";
          else if (selectedResource.kind === "p") templateId = "p1db_frequency";
          else templateId = "gain_vswr";
        }
        return buildCurvePayload(templateId, sourcePool, config, selectedResource);
      }

      function curveSourceFromPayload(payload) {
        var resources = (payload && payload.resources || []).map(normalizeSnpResource).filter(Boolean);
        if (!resources.length) return null;
        return {
          sourcePool: resources,
          selectedResource: resources[0]
        };
      }

      function makeSeriesFromPayload(payload) {
        var plot = createChartModel(payload);
        plot.showGrid = true;
        plot.showLegend = true;
        return plot;
      }

      function insertCurveSuite(resourceList) {
        var section;
        var target;
        var list;
        var payloads;
        var resources = resourceList || [];
        var config = defaultCurveConfig();
        if (!resources.length) {
          setCurveStatus("请先加载 SNP 文件或目录", true);
          return;
        }
        try {
          payloads = buildManualCurveSuite(resources, config);
        } catch (error) {
          setCurveStatus(error.message || "无法生成手册整组曲线", true);
          return;
        }
        if (!payloads.length) {
          setCurveStatus("未找到可生成曲线的 SNP 文件", true);
          return;
        }
        section = findTypicalCurveSection(manual) || addTypicalCurveSection(manual);
        section = upgradeTypicalCurveSection(section);
        target = section && section.querySelector("[data-curve-target]");
        list = target && target.querySelector("[data-curve-frame-list]");
        if (!list) return;
        manual.querySelectorAll("[data-curve-section]").forEach(function (existingSection) {
          if (existingSection === section) {
            list.innerHTML = "";
          } else {
            existingSection.remove();
          }
        });
        payloads.forEach(function (payload) {
          list.appendChild(makeCurveEmbed(payload));
        });
        updateCurveSectionState(section);
        bindCurveEmbeds(section);
        schedulePagination(80, { afterPaint: true });
        saveActivePage();
        setCurveStatus("已使用 " + resources.length + " 个 S 参数文件，生成 " + payloads.length + " 张曲线图", false);
      }

      function insertSelectedCurveSuite() {
        var selected = selectedCurveResources();
        if (!selected.length) {
          setCurveStatus("请先勾选要生成曲线的 S 参数文件", true);
          return;
        }
        insertCurveSuite(selected);
      }

      function makeChartSeries(resource, metric, axis, label, style, xScale) {
        var points = [];
        (resource.network.rows || []).forEach(function (row) {
          var x = Number.isFinite(row.f) ? row.f / xScale : null;
          var y = curveMetricValue(resource, row, metric);
          if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x: x, y: y });
        });
        return { label: label, metric: metric, sourceName: resource.name || resource.sourcePath || "",
          axis: axis || "left", color: style.color, dash: style.dash || [], points: points };
      }

      function createChartModel(payload) {
        var config = payload.config || {};
        var template = curveTemplateById(payload.templateId);
        var resources = (payload.resources || []).map(normalizeSnpResource).filter(Boolean);
        var legendLabels = normalizeLegendLabels(config.legendLabels);
        var xUnit = resolveFrequencyUnit(config.xUnit, resources.map(function (resource) { return resource.network; }));
        var xScale = displayFrequencyScale(xUnit);
        var series = [];
        var metric = template.metric || "gain";
        var selected;
        if (payload.templateId === "gain_vswr") {
          selected = resources[0];
          if (selected) {
            series.push(makeChartSeries(selected, "gain", "left", "Gain", { color: "#111111", dash: [] }, xScale));
            series.push(makeChartSeries(selected, "vswr_in", "right", "VSWR_in", { color: "#ff0000", dash: [16, 10] }, xScale));
            series.push(makeChartSeries(selected, "vswr_out", "right", "VSWR_out", { color: "#003cff", dash: [8, 8] }, xScale));
          }
        } else if (template.groupBy) {
          sortCurveResources(resources, template.groupBy).forEach(function (resource, index) {
            series.push(makeChartSeries(resource, metric, "left", curveLegendLabel(resource, template.groupBy), lineStyleForSeries(resource, index, template.groupBy, metric, "left"), xScale));
          });
        } else {
          selected = resources[0];
          if (selected) {
            var label = payload.templateId === "wide_gain" ? "S21" : (payload.templateId === "nf_frequency" ? "NF" : (payload.templateId === "p1db_frequency" ? "P1dB" : curveLegendLabel(selected, null)));
            series.push(makeChartSeries(selected, metric, "left", label, lineStyleForSeries(selected, 0, null, metric, "left"), xScale));
          }
        }
        if (legendLabels.length) {
          series = series.map(function (item, index) {
            return Object.assign({}, item, {
              label: legendLabels[index] || item.label
            });
          });
        }
        return {
          title: curvePayloadTitle(payload),
          xUnit: xUnit,
          xLabel: joinAxisLabel(config.xTitle, config.xUnitLabel || xUnit, template.xLabel || ("Freq(" + xUnit + ")")),
          yLabel: joinAxisLabel(config.yTitle, config.yUnitLabel, template.yLabel || "Value"),
          y2Label: joinAxisLabel(config.y2Title, config.y2UnitLabel, template.y2Label || ""),
          legend: template.legend || "right",
          dualAxis: !!template.dualAxis,
          xMin: config.xMin,
          xMax: config.xMax,
          yMin: config.yMin,
          yMax: config.yMax,
          y2Min: config.y2Min,
          y2Max: config.y2Max,
          lineWidth: clampNumber(config.lineWidth, 1.5, 6, 3.25),
          fontSize: clampNumber(config.fontSize, 12, 36, 20),
          legendLabels: legendLabels,
          series: series.filter(function (item) { return item.points.length; })
        };
      }

      function niceNumber(range, round) {
        if (!Number.isFinite(range) || range <= 0) return 1;
        var exponent = Math.floor(Math.log(range) / Math.LN10);
        var fraction = range / Math.pow(10, exponent);
        var niceFraction;
        if (round) {
          if (fraction < 1.5) niceFraction = 1;
          else if (fraction < 3) niceFraction = 2;
          else if (fraction < 7) niceFraction = 5;
          else niceFraction = 10;
        } else if (fraction <= 1) niceFraction = 1;
        else if (fraction <= 2) niceFraction = 2;
        else if (fraction <= 5) niceFraction = 5;
        else niceFraction = 10;
        return niceFraction * Math.pow(10, exponent);
      }

      function axisRange(values, minOverride, maxOverride, options) {
        var finite = values.filter(Number.isFinite);
        var min = minOverride != null ? minOverride : Math.min.apply(null, finite);
        var max = maxOverride != null ? maxOverride : Math.max.apply(null, finite);
        var pad;
        var step;
        options = options || {};
        if (!finite.length) {
          min = minOverride != null ? minOverride : 0;
          max = maxOverride != null ? maxOverride : 1;
        }
        if (min === max) {
          pad = Math.abs(min) > 1 ? Math.abs(min) * 0.05 : 1;
          min -= pad;
          max += pad;
        } else if (!options.tight) {
          pad = (max - min) * 0.05;
          if (minOverride == null) min -= pad;
          if (maxOverride == null) max += pad;
        }
        if (options.tight) return { min: min, max: max };
        if (options.floor != null && minOverride == null) min = Math.min(min, options.floor);
        if (options.ceil != null && maxOverride == null) max = Math.max(max, options.ceil);
        step = niceNumber((max - min) / 5, true);
        if (minOverride == null) min = Math.floor(min / step) * step;
        if (maxOverride == null) max = Math.ceil(max / step) * step;
        return { min: min, max: max };
      }

      function tickValues(min, max, count) {
        var range = max - min;
        var step = niceNumber(range / Math.max(1, count - 1), true);
        var first = Math.ceil(min / step) * step;
        var ticks = [];
        var value = first;
        while (value <= max + step * 0.25 && ticks.length < 20) {
          ticks.push(cleanNumber(value));
          value += step;
        }
        return ticks;
      }

      function formatAxisValue(value) {
        var abs = Math.abs(value);
        if (abs >= 10000 || (abs > 0 && abs < 0.001)) return value.toExponential(2);
        if (abs >= 100) return value.toFixed(0);
        if (abs >= 10) return value.toFixed(1).replace(/\.0$/, "");
        return value.toFixed(2).replace(/\.?0+$/, "");
      }

      function renderOriginCurveImage(payload) {
        var plot = makeSeriesFromPayload(payload);
        var fontSizes = curveFontSizes(plot.fontSize);
        var canvas = document.createElement("canvas");
        var width = 1040;
        var height = 640;
        var ctx;
        var allX = [];
        var allY = [];
        var allY2 = [];
        var xRange;
        var yRange;
        var y2Range;
        var left;
        var right;
        var top;
        var bottom;
        var plotWidth;
        var plotHeight;
        var xTicks;
        var yTicks;
        var y2Ticks;
        var maxYTickWidth = 0;
        var maxY2TickWidth = 0;
        var tickMarkLength;
        var tickLabelGap;
        var axisTitleGap;
        var xTitleBand;
        var yTitleBand;
        var y2TitleBand;
        var titleCenterY;
        var xTitleY;
        var yTitleX;
        var y2TitleX;

        canvas.width = width;
        canvas.height = height;
        ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);

        plot.series.forEach(function (series) {
          series.points.forEach(function (point) {
            allX.push(point.x);
            if (series.axis === "right") allY2.push(point.y);
            else allY.push(point.y);
          });
        });
        xRange = axisRange(allX, plot.xMin, plot.xMax, { tight: true });
        yRange = axisRange(allY, plot.yMin, plot.yMax);
        if (plot.dualAxis) {
          y2Range = axisRange(allY2, plot.y2Min, plot.y2Max, { floor: 1 });
        }
        xTicks = tickValues(xRange.min, xRange.max, 7);
        yTicks = tickValues(yRange.min, yRange.max, 7);
        y2Ticks = plot.dualAxis ? tickValues(y2Range.min, y2Range.max, 7) : [];

        ctx.font = fontSizes.tick + "px 'Times New Roman', SimSun, serif";
        yTicks.forEach(function (tick) {
          maxYTickWidth = Math.max(maxYTickWidth, ctx.measureText(formatAxisValue(tick)).width);
        });
        y2Ticks.forEach(function (tick) {
          maxY2TickWidth = Math.max(maxY2TickWidth, ctx.measureText(formatAxisValue(tick)).width);
        });

        tickMarkLength = Math.max(8, Math.round(fontSizes.tick * 0.38));
        tickLabelGap = Math.max(8, Math.round(fontSizes.tick * 0.55));
        axisTitleGap = Math.max(14, Math.round(fontSizes.axisTitle * 0.7));
        xTitleBand = plot.xLabel ? fontSizes.axisTitle + axisTitleGap : 0;
        yTitleBand = plot.yLabel ? fontSizes.axisTitle + axisTitleGap : 0;
        y2TitleBand = plot.dualAxis && plot.y2Label ? fontSizes.axisTitle + axisTitleGap : 0;

        top = Math.max(74, fontSizes.title + 32);
        bottom = Math.max(84, Math.ceil(18 + tickMarkLength + tickLabelGap + fontSizes.tick + xTitleBand));
        left = Math.max(94, Math.ceil(18 + maxYTickWidth + tickLabelGap + yTitleBand));
        right = plot.dualAxis
          ? Math.max(98, Math.ceil(18 + maxY2TickWidth + tickLabelGap + y2TitleBand))
          : 38;
        plotWidth = width - left - right;
        plotHeight = height - top - bottom;
        titleCenterY = Math.max(fontSizes.title / 2 + 10, Math.round(top * 0.52));
        xTitleY = height - Math.max(12, Math.round(fontSizes.axisTitle * 0.45));
        yTitleX = Math.max(fontSizes.axisTitle, left - maxYTickWidth - tickLabelGap - Math.round(fontSizes.axisTitle * 0.8));
        y2TitleX = width - Math.max(fontSizes.axisTitle, right - maxY2TickWidth - tickLabelGap - Math.round(fontSizes.axisTitle * 0.8));

        function toX(value) {
          return left + (value - xRange.min) / (xRange.max - xRange.min) * plotWidth;
        }

        function toY(value) {
          return top + plotHeight - (value - yRange.min) / (yRange.max - yRange.min) * plotHeight;
        }

        function toY2(value) {
          if (!y2Range) return toY(value);
          return top + plotHeight - (value - y2Range.min) / (y2Range.max - y2Range.min) * plotHeight;
        }

        ctx.fillStyle = "#111";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "bold " + fontSizes.title + "px SimSun, 'Times New Roman', serif";
        ctx.fillText(plot.title, width / 2, titleCenterY);

        ctx.fillStyle = "#fff";
        ctx.fillRect(left, top, plotWidth, plotHeight);
        if (plot.showGrid) {
          ctx.strokeStyle = "#d8d8d8";
          ctx.lineWidth = 1;
          xTicks.forEach(function (tick) {
            var x = toX(tick);
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, top + plotHeight);
            ctx.stroke();
          });
          yTicks.forEach(function (tick) {
            var y = toY(tick);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(left + plotWidth, y);
            ctx.stroke();
          });
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, plotWidth, plotHeight);
        ctx.clip();
        plot.series.forEach(function (series) {
          var started = false;
          ctx.beginPath();
          ctx.strokeStyle = series.color;
          ctx.lineWidth = plot.lineWidth;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.setLineDash(series.dash || []);
          series.points.forEach(function (point) {
            var x = toX(point.x);
            var y = series.axis === "right" ? toY2(point.y) : toY(point.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
              started = false;
              return;
            }
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
          });
          ctx.stroke();
        });
        ctx.setLineDash([]);
        ctx.restore();

        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1.8;
        ctx.strokeRect(left, top, plotWidth, plotHeight);
        ctx.fillStyle = "#111";
        ctx.font = fontSizes.tick + "px 'Times New Roman', SimSun, serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        xTicks.forEach(function (tick) {
          var x = toX(tick);
          ctx.beginPath();
          ctx.moveTo(x, top + plotHeight);
          ctx.lineTo(x, top + plotHeight + tickMarkLength);
          ctx.stroke();
          ctx.fillText(formatAxisValue(tick), x, top + plotHeight + tickMarkLength + 4);
        });
        ctx.textBaseline = "middle";
        ctx.textAlign = "right";
        yTicks.forEach(function (tick) {
          var y = toY(tick);
          ctx.beginPath();
          ctx.moveTo(left - 6, y);
          ctx.lineTo(left, y);
          ctx.stroke();
          ctx.fillText(formatAxisValue(tick), left - tickLabelGap, y);
        });
        if (plot.dualAxis) {
          ctx.textAlign = "left";
          y2Ticks.forEach(function (tick) {
            var y = toY2(tick);
            ctx.beginPath();
            ctx.moveTo(left + plotWidth, y);
            ctx.lineTo(left + plotWidth + tickMarkLength, y);
            ctx.stroke();
            ctx.fillText(formatAxisValue(tick), left + plotWidth + tickLabelGap, y);
          });
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.font = fontSizes.axisTitle + "px 'Times New Roman', SimSun, serif";
        ctx.fillText(plot.xLabel, left + plotWidth / 2, xTitleY);
        ctx.save();
        ctx.translate(yTitleX, top + plotHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = "top";
        ctx.fillText(plot.yLabel, 0, 0);
        ctx.restore();
        if (plot.dualAxis && plot.y2Label) {
          ctx.save();
          ctx.translate(y2TitleX, top + plotHeight / 2);
          ctx.rotate(Math.PI / 2);
          ctx.textBaseline = "top";
          ctx.fillText(plot.y2Label, 0, 0);
          ctx.restore();
        }

        if (plot.showLegend && plot.series.length) {
          var legendPaddingX = Math.max(14, Math.round(fontSizes.legend * 0.8));
          var legendPaddingY = Math.max(10, Math.round(fontSizes.legend * 0.6));
          var legendLineLength = Math.max(44, Math.round(fontSizes.legend * 2.35));
          var legendRowHeight = Math.max(26, fontSizes.legend + 8);
          var maxLegendTextWidth = 0;
          ctx.font = fontSizes.legend + "px 'Times New Roman', SimSun, serif";
          plot.series.forEach(function (series) {
            maxLegendTextWidth = Math.max(maxLegendTextWidth, ctx.measureText(series.label || "").width);
          });
          var legendWidth = Math.min(plotWidth - 16, Math.max(224, Math.ceil(legendPaddingX * 2 + legendLineLength + 12 + maxLegendTextWidth)));
          var legendHeight = Math.ceil(legendPaddingY * 2 + plot.series.length * legendRowHeight);
          var legendX = left + plotWidth - legendWidth - 16;
          var legendY = top + 14;
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          ctx.fillRect(legendX, legendY, legendWidth, legendHeight);
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1.2;
          ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);
          ctx.font = fontSizes.legend + "px 'Times New Roman', SimSun, serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          plot.series.forEach(function (series, index) {
            var y = legendY + legendPaddingY + legendRowHeight / 2 + index * legendRowHeight;
            ctx.strokeStyle = series.color;
            ctx.lineWidth = plot.lineWidth;
            ctx.setLineDash(series.dash || []);
            ctx.beginPath();
            ctx.moveTo(legendX + legendPaddingX, y);
            ctx.lineTo(legendX + legendPaddingX + legendLineLength, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#111";
            ctx.fillText(series.label, legendX + legendPaddingX + legendLineLength + 10, y);
          });
        }

        if (!plot.series.length) {
          ctx.fillStyle = "#777";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = fontSizes.empty + "px SimSun, serif";
          ctx.fillText("没有可绘制的曲线数据", width / 2, height / 2);
        }

        return canvas.toDataURL("image/png");
      }

      function updateCurveEmbed(embed, payload) {
        if (payload && payload.type === "image-package") {
          updateCurveEmbedImage(embed, payload);
          return;
        }
        var title = curvePayloadTitle(payload);
        var mediaHost = embed.querySelector("[data-curve-media]");
        var image = document.createElement("img");
        embed.dataset.curveName = title;
        embed.dataset.curveType = "snp-origin";
        embed.draggable = true;
        embed.querySelector(".curve-name").textContent = title;
        image.className = "curve-frame";
        image.alt = title;
        image.src = renderOriginCurveImage(payload);
        mediaHost.innerHTML = "";
        mediaHost.appendChild(image);
        writeCurvePayload(embed, payload);
      }

      function previewCurveConfigUpdate(embed, changes) {
        var payload = readCurvePayload(embed);
        if (!embed || !manual.contains(embed) || !payload || payload.type === "image-package" ||
            !changes || typeof changes !== "object") return null;
        var source = curveSourceFromPayload(payload);
        if (!source) return null;
        var config = Object.assign({}, payload.config || {}, changes, {
          templateId: changes.templateId || payload.templateId
        });
        try {
          return sourceToCurvePayload(source, config);
        } catch (error) {
          return null;
        }
      }

      function updateCurveConfig(embed, changes) {
        var payload = previewCurveConfigUpdate(embed, changes);
        if (!payload) return false;
        updateCurveEmbed(embed, payload);
        schedulePagination(80, { afterPaint: true });
        saveActivePage();
        setCurveStatus("已更新曲线设置：" + curvePayloadTitle(payload), false);
        return true;
      }

      function setCurveLineWidth(embed, lineWidth) {
        var width = Number(lineWidth);
        if (!Number.isFinite(width) || width < 1.5 || width > 6) return false;
        return updateCurveConfig(embed, { lineWidth: width });
      }

      function makeCurveEmbed(payload) {
        var embed = document.createElement("div");
        embed.className = "curve-embed";
        embed.draggable = true;
        embed.innerHTML = [
          '<div class="curve-embed-header">',
          '<span class="curve-name"></span>',
          '<button class="remove-curve" type="button" title="删除曲线" data-remove-curve>×</button>',
          "</div>",
          '<div class="curve-media" data-curve-media></div>'
        ].join("");
        updateCurveEmbed(embed, payload);
        return embed;
      }

      function insertCurvePayloads(payloads, mode) {
        var section;
        var target;
        var list;
        if (!payloads || !payloads.length) {
          setCurveStatus("没有可插入的曲线图", true);
          return;
        }
        section = findTypicalCurveSection(manual) || addTypicalCurveSection(manual);
        section = upgradeTypicalCurveSection(section);
        target = section && section.querySelector("[data-curve-target]");
        list = target && target.querySelector("[data-curve-frame-list]");
        if (!list) return;
        if (mode !== "append") {
          manual.querySelectorAll("[data-curve-section]").forEach(function (existingSection) {
            if (existingSection === section) {
              list.innerHTML = "";
            } else {
              existingSection.remove();
            }
          });
        }
        payloads.forEach(function (payload) {
          list.appendChild(makeCurveEmbed(payload));
        });
        updateCurveSectionState(section);
        bindCurveEmbeds(section);
        schedulePagination(80, { afterPaint: true });
        saveActivePage();
        setCurveStatus("已导入 " + payloads.length + " 张曲线图", false);
      }

      function insertCurveResource(resource, mode) {
        var section;
        var target;
        var list;
        var payload;
        if (!resource) {
          setCurveStatus("请先加载并选择一个 S 参数文件", true);
          return;
        }
        try {
          payload = sourceToCurvePayload(resource, defaultCurveConfig());
        } catch (error) {
          setCurveStatus(error.message || "曲线配置无效", true);
          return;
        }
        section = findTypicalCurveSection(manual) || addTypicalCurveSection(manual);
        section = upgradeTypicalCurveSection(section);
        target = section && section.querySelector("[data-curve-target]");
        list = target && target.querySelector("[data-curve-frame-list]");
        if (!list) return;
        if (mode !== "append") {
          manual.querySelectorAll("[data-curve-section]").forEach(function (existingSection) {
            if (existingSection === section) {
              list.innerHTML = "";
            } else {
              existingSection.remove();
            }
          });
        }
        list.appendChild(makeCurveEmbed(payload));
        updateCurveSectionState(section);
        bindCurveEmbeds(section);
        schedulePagination(80, { afterPaint: true });
        saveActivePage();
        setCurveStatus("已生成 Origin 风格曲线图：" + curvePayloadTitle(payload), false);
      }

      function selectCurveEmbed(embed) {
        var payload = readCurvePayload(embed);
        if (!payload) return;
        manual.querySelectorAll(".curve-embed.is-editing").forEach(function (node) {
          node.classList.remove("is-editing");
        });
        selectedCurveEmbed = embed;
        embed.classList.add("is-editing");
        openCurveEditor(payload);
        setCurveStatus("已打开曲线编辑弹窗，可调整类型、标题、坐标轴和范围。", false);
      }

      function updateSelectedCurveEmbed() {
        var payload = readCurvePayload(selectedCurveEmbed);
        var source = curveSourceFromPayload(payload);
        var updatedPayload;
        if (payload && payload.type === "image-package") {
          updateSelectedCurveImageMetadata();
          return;
        }
        if (!selectedCurveEmbed || !source) {
          setCurveStatus("请先点击手册中的曲线图", true);
          return;
        }
        try {
          updatedPayload = sourceToCurvePayload(source, readCurveConfigFromEditor());
        } catch (error) {
          setCurveStatus(error.message || "曲线配置无效", true);
          return;
        }
        updateCurveEmbed(selectedCurveEmbed, updatedPayload);
        schedulePagination(80, { afterPaint: true });
        saveActivePage();
        closeCurveEditor();
        setCurveStatus("已更新所选曲线图：" + curvePayloadTitle(updatedPayload), false);
      }

      function updateSelectedCurveImageMetadata() {
        var payload = readCurvePayload(selectedCurveEmbed);
        var config = readCurveConfigFromEditor();
        if (!selectedCurveEmbed || !payload || payload.type !== "image-package") {
          setCurveStatus("请先点击手册中的曲线包图片", true);
          return false;
        }
        payload.config = Object.assign({}, payload.config || {}, {
          title: config.title || payload.config && payload.config.title || "",
          xLabel: joinAxisLabel(config.xTitle, config.xUnitLabel, payload.config && payload.config.xLabel || ""),
          yLabel: joinAxisLabel(config.yTitle, config.yUnitLabel, payload.config && payload.config.yLabel || ""),
          y2Label: joinAxisLabel(config.y2Title, config.y2UnitLabel, payload.config && payload.config.y2Label || "")
        });
        updateCurveEmbed(selectedCurveEmbed, payload);
        schedulePagination(80, { afterPaint: true });
        saveActivePage();
        closeCurveEditor();
        setCurveStatus("已更新所选曲线图信息：" + packagePayloadTitle(payload), false);
        return true;
      }

      function importCurvePackage(payloads, mode) {
        insertCurvePayloads(payloads || [], mode || "replace");
      }

      function bindCurveListDrag(list) {
        if (!list || boundCurveLists.has(list)) return;
        boundCurveLists.add(list);
        list.addEventListener("dragover", function (event) {
          var dragging = list.querySelector(".curve-embed.is-dragging");
          var target = event.target.closest(".curve-embed");
          if (!dragging || !target || dragging === target || !list.contains(target)) return;
          event.preventDefault();
          var rect = target.getBoundingClientRect();
          var before = event.clientY < rect.top + rect.height / 2;
          list.insertBefore(dragging, before ? target : target.nextSibling);
        });
        list.addEventListener("drop", function (event) {
          event.preventDefault();
          list.querySelectorAll(".curve-embed.is-dragging").forEach(function (embed) {
            embed.classList.remove("is-dragging");
          });
          updateCurveSectionState(list.closest("[data-curve-section]"));
          schedulePagination(80, { afterPaint: true });
          saveActivePage();
        });
      }

      function bindCurveEmbeds(scope) {
        scope = scope || document;
        scope.querySelectorAll("[data-curve-section], [data-curve-target]").forEach(updateCurveSectionState);
        scope.querySelectorAll("[data-curve-frame-list]").forEach(bindCurveListDrag);
        scope.querySelectorAll(".curve-embed").forEach(function (embed) {
          embed.draggable = true;
          if (boundCurveEmbeds.has(embed)) return;
          boundCurveEmbeds.add(embed);
          embed.addEventListener("dragstart", function (event) {
            if (event.target.closest("[contenteditable='true']") || event.target.closest("[data-remove-curve]")) {
              event.preventDefault();
              return;
            }
            embed.classList.add("is-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", embed.dataset.curveName || "curve");
          });
          embed.addEventListener("dragend", function () {
            embed.classList.remove("is-dragging");
            schedulePagination(80, { afterPaint: true });
            saveActivePage();
          });
          embed.addEventListener("click", function (event) {
            if (event.target.closest("[data-remove-curve]")) return;
            selectCurveEmbed(embed);
          });
        });
        scope.querySelectorAll("[data-remove-curve]").forEach(function (button) {
          if (boundCurveRemoveButtons.has(button)) return;
          boundCurveRemoveButtons.add(button);
          button.addEventListener("click", function (event) {
            event.stopPropagation();
            var section = button.closest("[data-curve-section]");
            var embed = button.closest(".curve-embed");
            if (embed && embed === selectedCurveEmbed) {
              selectedCurveEmbed = null;
              closeCurveEditor();
            }
            if (embed) embed.remove();
            updateCurveSectionState(section);
            schedulePagination(80, { afterPaint: true });
            saveActivePage();
          });
        });
      }

      function bindCurveEditorDialog() {
        var root = curveEditorRoot();
        if (!root || root.dataset.bound === "true") return;
        root.dataset.bound = "true";
        root.addEventListener("click", function (event) {
          if (event.target.closest("[data-curve-editor-close]")) {
            closeCurveEditor();
            return;
          }
          if (event.target.closest("[data-curve-editor-apply]")) {
            updateSelectedCurveEmbed();
          }
        });
        addGlobalListener("keydown", function (event) {
          if (event.key === "Escape" && !root.classList.contains("is-hidden")) {
            closeCurveEditor();
          }
        });
      }

      function bindImageZones() {
        var scope = arguments.length > 0 && arguments[0] ? arguments[0] : document;
        scope.querySelectorAll("[data-image-zone]").forEach(function (zone) {
          updateImageZoneState(zone);
          if (boundImageZones.has(zone)) return;
          boundImageZones.add(zone);

          zone.addEventListener("click", function (event) {
            var remove = event.target.closest(".remove-image");
            var clickedItem = event.target.closest(".image-item, .image-list, .scene-svg, [data-scene-element-id]");
            var placeholder = event.target.closest(".placeholder");
            var hasExistingImage = !!zone.querySelector(".image-item, .scene-svg");
            var supportsMultipleImages = zone.dataset.multiple === "true";
            var hasGeneratedImage = !!zone.querySelector('.scene-svg, .image-item:not([data-manual-image="true"])');
            if (remove && zone.contains(remove)) {
              event.stopPropagation();
              var item = remove.closest(".image-item");
              if (item && item.classList.contains("scene-item")) {
                clearImageZone(zone);
                return;
              }
              if (item) item.remove();
              updateImageZoneState(zone);
              schedulePagination();
              saveActivePage();
              return;
            }
            if (event.target.closest("button, [data-scene-element-id], .scene-svg")) {
              return;
            }
            if (hasExistingImage && (!supportsMultipleImages || hasGeneratedImage)) {
              return;
            }
            if (clickedItem && zone.contains(clickedItem) && !placeholder && !supportsMultipleImages) {
              return;
            }
            currentImageZone = zone;
            imageInput.value = "";
            imageInput.click();
          });

          zone.addEventListener("paste", function (event) {
            var items = event.clipboardData && event.clipboardData.items;
            if (!items) return;
            var files = [];
            Array.from(items).forEach(function (item) {
              if (item.type.indexOf("image/") === 0) {
                var file = item.getAsFile();
                if (file) files.push(file);
              }
            });
            if (files.length) {
              event.preventDefault();
              readFilesIntoZone(zone, files);
            }
          });

          zone.addEventListener("dragover", function (event) {
            event.preventDefault();
            zone.classList.add("dragover");
          });

          zone.addEventListener("dragleave", function () {
            zone.classList.remove("dragover");
          });

          zone.addEventListener("drop", function (event) {
            event.preventDefault();
            zone.classList.remove("dragover");
            readFilesIntoZone(zone, event.dataTransfer.files);
          });
        });

        scope.querySelectorAll("[data-clear-image-zone]").forEach(function (button) {
          if (button.dataset.clearZoneBound === "true") return;
          button.dataset.clearZoneBound = "true";
          button.addEventListener("click", function () {
            var zoneType = button.getAttribute("data-clear-image-zone");
            var selector = ".dimension-images[data-image-zone]";
            if (zoneType === "assembly") selector = ".assembly-image[data-image-zone]";
            if (zoneType === "function_block") selector = ".function-block-image[data-image-zone], .half-panel [data-image-zone]";
            var zone = document.querySelector(selector);
            if (zone) clearImageZone(zone);
          });
        });

        if (!imageInputBound) {
          imageInputBound = true;
          imageInput.addEventListener("change", function () {
            if (currentImageZone && imageInput.files.length) {
              readFilesIntoZone(currentImageZone, imageInput.files);
            }
          });
        }
      }

      function bindPlainTextPasteForEditable() {
        addGlobalListener("paste", function (event) {
          var editable = event.target.closest('[contenteditable="true"]');
          if (!editable || editable.closest("[data-editable-table]") || editable.closest("[data-image-zone]")) return;
          var text = event.clipboardData && event.clipboardData.getData("text/plain");
          if (!text) return;
          event.preventDefault();
          document.execCommand("insertText", false, text);
        });
      }

      function bindSyncedHeaderFields(scope) {
        scope = scope || document;
        [".model", ".subtitle", ".version", ".footer"].forEach(function (selector) {
          scope.querySelectorAll(selector).forEach(function (field) {
            if (boundHeaderFields.has(field)) return;
            boundHeaderFields.add(field);
            field.addEventListener("input", function () {
              manual.querySelectorAll(selector).forEach(function (other) {
                if (other !== field) other.innerHTML = field.innerHTML;
              });
              saveActivePage();
            });
          });
        });
      }

      function selectTreeNode(node) {
        if (!node) return;
        document.querySelectorAll(".resource-tree .tree-row.is-selected").forEach(function (row) {
          row.classList.remove("is-selected");
        });
        var row = node.querySelector(":scope > .tree-row");
        if (row) row.classList.add("is-selected");
        selectedTreeNode = node;
      }

      function updateTreeToggles() {
        document.querySelectorAll(".resource-tree .tree-node").forEach(function (node) {
          var toggle = node.querySelector(":scope > .tree-row .tree-toggle");
          var childList = node.querySelector(":scope > ul");
          var hasChildren = childList && childList.children.length > 0;
          if (!toggle) return;
          toggle.classList.toggle("is-empty", !hasChildren);
          toggle.textContent = hasChildren ? (node.classList.contains("is-collapsed") ? "▸" : "▾") : "▸";
          node.classList.toggle("is-document", node.dataset.nodeKind === "document");
        });
      }

      function renderTreeNodePage(node) {
        if (!node) {
          manual.innerHTML = createBlankPageHtml("未选择目录");
          activePageId = null;
          activeTreeNode = null;
          hydrateManual();
          return;
        }
        document.querySelectorAll(".resource-tree .tree-node.is-active").forEach(function (item) {
          item.classList.remove("is-active");
        });
        node.classList.add("is-active");
        activeTreeNode = node;
        activePageId = ensurePageId(node);
        manual.innerHTML = getNodePageHtml(node);
        hydrateManual();
        schedulePagination(60, { afterPaint: true });
      }

      function openTreeNode(node, options) {
        if (!node) return;
        options = options || {};
        if (!options.skipSave) saveActivePage();
        selectTreeNode(node);
        renderTreeNodePage(node);
      }

      function initializeNodePage(node) {
        setNodePageHtml(node, createBlankPageHtml(getNodeTitle(node)));
      }

      function syncNodeTitleToPage(node) {
        if (!node) return;
        var title = getNodeTitle(node);
        if (node === activeTreeNode) {
          syncCurrentManualTitle(title);
          saveActivePage();
          return;
        }
        setNodePageHtml(node, syncPageTitleInHtml(getNodePageHtml(node), title));
      }

      function createTreeNode(name, kind) {
        var node = document.createElement("li");
        node.className = "tree-node";
        node.dataset.nodeKind = kind || "folder";
        node.innerHTML = [
          '<div class="tree-row">',
          '<button class="tree-toggle is-empty" type="button" title="展开/折叠">▸</button>',
          '<span class="tree-label" contenteditable="false"></span>',
          "</div>"
        ].join("");
        node.classList.toggle("is-document", node.dataset.nodeKind === "document");
        node.querySelector(".tree-label").textContent = name || "未命名目录";
        return node;
      }

      function getParentTreeNode(node) {
        return node && node.parentElement ? node.parentElement.closest(".tree-node") : null;
      }

      function getTemplateTargetDirectory() {
        var target = selectedTreeNode || activeTreeNode || document.querySelector(".resource-tree .tree-node");
        if (target && target.dataset.nodeKind === "document") {
          target = getParentTreeNode(target) || target;
        }
        return target;
      }

      function ensureChildList(node) {
        var list = node.querySelector(":scope > ul");
        if (!list) {
          list = document.createElement("ul");
          node.appendChild(list);
        }
        node.classList.remove("is-collapsed");
        return list;
      }

      function createUniqueChildName(parent, baseName) {
        var list = parent && parent.querySelector(":scope > ul");
        var existingNames = list ? Array.from(list.querySelectorAll(":scope > .tree-node > .tree-row .tree-label")).map(function (label) {
          return label.textContent.trim();
        }) : [];
        var name = baseName;
        var index = 1;
        while (existingNames.indexOf(name) !== -1) {
          index += 1;
          name = baseName + " " + index;
        }
        return name;
      }

      function isDirectChildOfTitle(node, title) {
        var parent = getParentTreeNode(node);
        return parent && getNodeTitle(parent) === title;
      }

      function focusTreeLabel(node) {
        var label = node && node.querySelector(":scope > .tree-row .tree-label");
        if (!label) return;
        label.setAttribute("contenteditable", "true");
        label.focus();
        var range = document.createRange();
        range.selectNodeContents(label);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }

      function addSiblingNode() {
        var tree = document.querySelector("[data-resource-tree]");
        var target = selectedTreeNode || tree.querySelector(".tree-node");
        var node = createTreeNode("新目录");
        if (target && target.parentElement) {
          target.parentElement.insertBefore(node, target.nextSibling);
        } else {
          tree.appendChild(node);
        }
        initializeNodePage(node);
        selectTreeNode(node);
        updateTreeToggles();
      }

      function addRootNode() {
        var tree = document.querySelector("[data-resource-tree]");
        if (!tree) return;
        var node = createTreeNode("新一级目录");
        tree.appendChild(node);
        initializeNodePage(node);
        selectTreeNode(node);
        updateTreeToggles();
      }

      function addChildNode() {
        var tree = document.querySelector("[data-resource-tree]");
        var target = getTemplateTargetDirectory() || tree.querySelector(".tree-node");
        if (!target) {
          addSiblingNode();
          return;
        }
        var list = ensureChildList(target);
        var node = createTreeNode("新目录");
        list.appendChild(node);
        initializeNodePage(node);
        selectTreeNode(node);
        updateTreeToggles();
      }

      function removeNodePages(node) {
        [node].concat(Array.from(node.querySelectorAll(".tree-node"))).forEach(function (item) {
          if (item.dataset.pageId) delete pageStore[item.dataset.pageId];
        });
      }

      function deleteSelectedNode() {
        if (!selectedTreeNode) return;
        saveActivePage();
        var deletingNode = selectedTreeNode;
        var deletingActiveNode = activeTreeNode && (deletingNode === activeTreeNode || deletingNode.contains(activeTreeNode));
        var parentNode = getParentTreeNode(selectedTreeNode);
        var nextNode = selectedTreeNode.nextElementSibling || selectedTreeNode.previousElementSibling || parentNode || document.querySelector(".resource-tree .tree-node");
        removeNodePages(deletingNode);
        deletingNode.remove();
        selectedTreeNode = null;
        if (nextNode && !document.documentElement.contains(nextNode)) {
          nextNode = document.querySelector(".resource-tree .tree-node");
        }
        updateTreeToggles();
        if (deletingActiveNode && nextNode) {
          openTreeNode(nextNode, { skipSave: true });
        } else if (nextNode) {
          selectTreeNode(nextNode);
        } else if (deletingActiveNode) {
          activePageId = null;
          activeTreeNode = null;
          renderTreeNodePage(null);
        } else {
          selectedTreeNode = null;
        }
      }

      function initializeResourcePages(tree) {
        var preferredNode = tree.querySelector(".tree-node.is-active") || (tree.querySelector(".tree-row.is-selected") && tree.querySelector(".tree-row.is-selected").closest(".tree-node")) || tree.querySelector(".tree-node");
        tree.querySelectorAll(".tree-label").forEach(function (label) {
          label.setAttribute("contenteditable", "false");
        });
        tree.querySelectorAll(".tree-node").forEach(function (node) {
          ensurePageId(node);
        });
        selectedTreeNode = preferredNode;
        tree.querySelectorAll(".tree-node").forEach(function (node) {
          var pageId = ensurePageId(node);
          if (node.dataset.pageHtml) {
            pageStore[pageId] = decodeStoredHtml(node.dataset.pageHtml);
            delete node.dataset.pageHtml;
            return;
          }
          var title = getNodeTitle(node);
          if (title === "PRODUCT-001") {
            setNodePageHtml(node, createOriginalManualHtml(initialManualHtml));
            return;
          }
          if (isDirectChildOfTitle(node, "低噪声放大器芯片")) {
            setNodePageTemplate(node, "manual");
            return;
          }
          setNodePageHtml(node, createBlankPageHtml(title));
        });
        if (preferredNode) openTreeNode(preferredNode, { skipSave: true });
      }

      function bindResourceTree() {
        var tree = document.querySelector("[data-resource-tree]");
        if (!tree) return;
        initializeResourcePages(tree);
        updateTreeToggles();

        tree.addEventListener("click", function (event) {
          var node = event.target.closest(".tree-node");
          if (!node || !tree.contains(node)) return;
          if (event.target.classList.contains("tree-toggle") && !event.target.classList.contains("is-empty")) {
            selectTreeNode(node);
            node.classList.toggle("is-collapsed");
            updateTreeToggles();
            return;
          }
          if (event.detail >= 3) {
            event.preventDefault();
            selectTreeNode(node);
            focusTreeLabel(node);
            return;
          }
          if (event.detail === 2) {
            event.preventDefault();
            openTreeNode(node);
            return;
          }
          selectTreeNode(node);
        });

        tree.addEventListener("keydown", function (event) {
          if (!event.target.classList.contains("tree-label")) return;
          if (event.key === "Enter") {
            event.preventDefault();
            event.target.blur();
          }
        });

        tree.addEventListener("blur", function (event) {
          if (event.target.classList.contains("tree-label") && event.target.textContent.trim() === "") {
            event.target.textContent = "未命名目录";
          }
          if (event.target.classList.contains("tree-label")) {
            syncNodeTitleToPage(event.target.closest(".tree-node"));
            event.target.setAttribute("contenteditable", "false");
          }
        }, true);

        tree.addEventListener("input", function (event) {
          if (event.target.classList.contains("tree-label") && event.target.textContent.trim() !== "") {
            syncNodeTitleToPage(event.target.closest(".tree-node"));
          }
        });

        document.getElementById("addRootNode").addEventListener("click", addRootNode);
        document.getElementById("addSiblingNode").addEventListener("click", addSiblingNode);
        document.getElementById("addChildNode").addEventListener("click", addChildNode);
        document.getElementById("renameNode").addEventListener("click", function () {
          focusTreeLabel(selectedTreeNode);
        });
        document.getElementById("deleteNode").addEventListener("click", deleteSelectedNode);
      }

      function bindManualInsertionTargets() {
        addGlobalListener("focusin", function (event) {
          var target = event.target.closest('[contenteditable="true"]');
          if (target && target.closest(".manual")) {
            lastManualEditable = target;
          }
        });
      }

      function bindManualAutosave() {
        manual.addEventListener("input", function () {
          scheduleActivePageSave();
        });
        manual.addEventListener("focusout", function (event) {
          var editable = event.target.closest('[contenteditable="true"]');
          if (editable && manual.contains(editable)) schedulePagination(250);
        });
        manual.addEventListener("paste", function (event) {
          var editable = event.target.closest('[contenteditable="true"]');
          if (!editable || editable.closest("[data-editable-table]") || editable.closest("[data-image-zone]")) return;
          window.setTimeout(function () {
            schedulePagination(650);
          }, 0);
        });
      }

      function setCaretToEnd(element) {
        var range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }

      function insertTextIntoEditable(target, text) {
        if (!target || !text) return;
        target.focus();
        var selection = window.getSelection();
        if (!selection.rangeCount || !target.contains(selection.anchorNode)) {
          setCaretToEnd(target);
        }
        document.execCommand("insertText", false, text);
      }

      function bindTemplatePanel() {
        if (window.ProductManualTemplateTools && window.ProductManualTemplateTools.bindTemplatePanel) {
          window.ProductManualTemplateTools.bindTemplatePanel(toolContext);
        }
      }

      function selectedCurveResource() {
        return curveResources[selectedCurveIndex] || null;
      }

      function renderCurveList() {
        var list = document.querySelector("[data-curve-list]");
        var status = document.querySelector("[data-curve-status]");
        var toggleAllButton = document.querySelector("[data-toggle-all-curves]");
        var selected = selectedCurveResources();
        if (!list) return;
        list.innerHTML = "";
        if (!curveResources.length) {
          var empty = document.createElement("div");
          empty.className = "curve-empty";
          empty.textContent = "未加载曲线文件";
          list.appendChild(empty);
          if (toggleAllButton) {
            toggleAllButton.disabled = true;
            toggleAllButton.setAttribute("aria-pressed", "false");
          }
          if (status) status.textContent = snpDirectoryPath;
          return;
        }
        curveResources.forEach(function (resource, index) {
          var option = document.createElement("label");
          var copy = document.createElement("span");
          var title = document.createElement("strong");
          var detail = document.createElement("small");
          var checkbox = document.createElement("input");
          var isSelected = selectedCurveIds.has(curveResourceSelectionKey(resource));
          option.className = "curve-option";
          option.dataset.curveIndex = String(index);
          copy.className = "curve-option-copy";
          checkbox.className = "curve-select-checkbox";
          checkbox.type = "checkbox";
          checkbox.checked = isSelected;
          checkbox.dataset.curveSelectIndex = String(index);
          checkbox.setAttribute("aria-label", "选择 " + resource.name);
          title.textContent = resource.name;
          detail.textContent = [
            curveKindLabel(resource.kind),
            resource.seriesLabel && resource.seriesLabel !== curveFileStem(resource.name) ? resource.seriesLabel : "",
            resourceFrequencySummary(resource)
          ].filter(Boolean).join("，");
          copy.appendChild(title);
          copy.appendChild(detail);
          option.appendChild(copy);
          option.appendChild(checkbox);
          option.classList.toggle("is-selected", isSelected);
          list.appendChild(option);
        });
        if (toggleAllButton) {
          toggleAllButton.disabled = false;
          toggleAllButton.setAttribute("aria-pressed", selected.length === curveResources.length ? "true" : "false");
        }
        if (status) status.textContent = "已加载 " + curveResources.length + " 个曲线文件，已选择 " + selected.length + " 个";
      }

      function bindCurvePanel() {
        if (window.ProductManualTemplateTools && window.ProductManualTemplateTools.bindCurvePanel) {
          window.ProductManualTemplateTools.bindCurvePanel(toolContext);
        }
      }

      function bindLayoutPanel() {
        if (window.ProductManualTemplateTools && window.ProductManualTemplateTools.bindLayoutPanel) {
          window.ProductManualTemplateTools.bindLayoutPanel(toolContext);
        }
      }

      function bindOverlayImageEditor() {
        if (window.ProductManualTemplateTools && window.ProductManualTemplateTools.bindOverlayImageEditor) {
          window.ProductManualTemplateTools.bindOverlayImageEditor(toolContext);
        }
      }

      function bindToolPanel() {
        var toolList = document.getElementById("toolList");
        if (!toolList) return;
        bindCurveEditorDialog();
        bindCurvePanel();
        bindLayoutPanel();
        bindOverlayImageEditor();
      }

      function cloneForExport() {
        clearTimeout(autosaveTimer);
        clearTimeout(paginationTimer);
        repaginateManual();
        persistStoredPages();
        var doc = document.documentElement.cloneNode(true);
        clearPersistedPageAttributes(document);
        doc.querySelectorAll(".dragover").forEach(function (node) {
          node.classList.remove("dragover");
        });
        doc.querySelectorAll("[data-curve-editor-modal], [data-snp-paste-modal]").forEach(function (dialog) {
          dialog.classList.add("is-hidden");
          dialog.setAttribute("aria-hidden", "true");
        });
        doc.querySelectorAll("script").forEach(function (script) {
          if (!script.src && !script.textContent.trim()) script.remove();
        });
        return "<!doctype html>\n" + doc.outerHTML;
      }

      function exportHtml() {
        var html = cloneForExport();
        var blob = new Blob([html], { type: "text/html;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        var model = document.querySelector(".model");
        var name = model ? model.innerText.trim().replace(/[\\/:*?\"<>|]+/g, "_") : "product_manual";
        link.href = url;
        link.download = (name || "product_manual") + "_template.html";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
      }

      function bindGlobalActions() {
        document.getElementById("exportHtml").addEventListener("click", exportHtml);
        document.getElementById("printManual").addEventListener("click", function () {
          clearTimeout(autosaveTimer);
          clearTimeout(paginationTimer);
          repaginateManual();
          saveActivePage();
          window.print();
        });
      }

      function createToolContext() {
        return {
          document: document,
          window: window,
          snpDirectoryPath: snpDirectoryPath,
          snpFileManifest: snpFileManifest,
          importFeatureFile: importFeatureFile,
          getCurveResources: function () {
            return curveResources;
          },
          setCurveResources: setCurveResources,
          appendCurveResources: appendCurveResources,
          deleteSelectedCurveResources: deleteSelectedCurveResources,
          getSelectedCurveIndex: function () {
            return selectedCurveIndex;
          },
          setSelectedCurveIndex: function (index) {
            selectedCurveIndex = Number(index) || 0;
          },
          getSelectedCurveResource: selectedCurveResource,
          getSelectedCurveResources: selectedCurveResources,
          setCurveResourceSelected: setCurveResourceSelected,
          toggleAllCurveResources: toggleAllCurveResources,
          getCurveChartModel: function (embed) {
            var payload = readCurvePayload(embed);
            return payload && payload.type !== "image-package" ? createChartModel(payload) : null;
          },
          renderCurveList: renderCurveList,
          insertCurveResource: insertCurveResource,
          insertSelectedCurveSuite: insertSelectedCurveSuite,
          updateSelectedCurveEmbed: updateSelectedCurveEmbed,
          previewCurveConfigUpdate: previewCurveConfigUpdate,
          updateCurveConfig: updateCurveConfig,
          setCurveLineWidth: setCurveLineWidth,
          importCurvePackage: importCurvePackage,
          readFeatureRows: readFeatureRows,
          setCurveStatus: setCurveStatus,
          isSupportedSnpFile: isSupportedSnpFile,
          replaceTableWithRows: replaceTableWithRows,
          replaceImageZoneImages: replaceImageZoneImages,
          ensureResizableImageItem: ensureManualImageResizeHandle,
          schedulePagination: schedulePagination,
          saveActivePage: saveActivePage,
          prepareForExport: function () {
            clearTimeout(autosaveTimer);
            clearTimeout(paginationTimer);
            repaginateManual();
            saveActivePage();
          }
        };
      }

      toolContext = createToolContext();
      window.ProductManualTemplateToolContext = toolContext;
      bindPlainTextPasteForEditable();
      bindManualImageResizing();
      bindResourceTree();
      bindManualInsertionTargets();
      bindManualAutosave();
      bindToolPanel();
      bindTemplatePanel();
      bindGlobalActions();
      window.ProductManualLegacyDispose = function () {
        globalListeners.forEach(function (item) {
          document.removeEventListener(item.type, item.handler);
        });
        globalListeners = [];
        clearTimeout(paginationTimer);
        clearTimeout(autosaveTimer);
        if (activeImageResize) {
          activeImageResize.item.classList.remove("is-resizing");
          activeImageResize = null;
        }
        document.body.classList.remove(
          "is-resizing-image",
          "is-resizing-image-width",
          "is-resizing-image-height",
          "is-resizing-image-proportional"
        );
        if (window.ProductManualTemplateToolContext === toolContext) {
          delete window.ProductManualTemplateToolContext;
        }
        toolContext = null;
      };
    }());
