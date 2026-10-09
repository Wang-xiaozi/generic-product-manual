(function () {
  "use strict";

  var TITLE_FEATURE = "\u6027\u80fd\u7279\u70b9";
  var TITLE_INTRO = "\u4ea7\u54c1\u7b80\u4ecb";
  var TITLE_DC = "\u76f4\u6d41\u7535\u53c2\u6570";
  var TITLE_MICROWAVE = "\u5fae\u6ce2\u7535\u53c2\u6570";
  var TITLE_LIMIT = "\u4f7f\u7528\u9650\u5236\u53c2\u6570";

  var FEATURE_HINT = "\u652f\u6301\u56fa\u5b9a\u683c\u5f0f .xlsx\uff1a\u6307\u6807\u3001\u5178\u578b\u503c\u3001\u6700\u5c0f\u503c\u3001\u6700\u5927\u503c\u3001\u5355\u4f4d\u3001\u7b26\u53f7\u3001\u663e\u793a\u6a21\u5757\u3001\u5907\u6ce8\uff1b\u540c\u4e00\u6307\u6807\u53ef\u5199 Vd1/Vd2 \u591a\u884c\u3002\u53ef\u9009\u589e\u52a0\uff1a\u8868\u5934\u6807\u9898/\u526f\u6807\u9898/\u7248\u672c/\u5355\u4f4d\u540d\u79f0\u3002";

  var FEATURE_FIELDS = [
    { key: "\u9891\u7387\u8303\u56f4", aliases: ["\u9891\u7387\u8303\u56f4", "\u5de5\u4f5c\u9891\u7387\u8303\u56f4"] },
    { key: "\u589e\u76ca", aliases: ["\u589e\u76ca", "\u7ebf\u6027\u589e\u76ca"] },
    { key: "\u566a\u58f0\u7cfb\u6570", aliases: ["\u566a\u58f0\u7cfb\u6570", "\u5e26\u5185\u566a\u58f0\u7cfb\u6570", "\u5185\u5e26\u566a\u58f0\u7cfb\u6570"] },
    { key: "\u8f93\u51fa1dB\u538b\u7f29\u529f\u7387", aliases: ["\u8f93\u51fa1dB\u538b\u7f29\u529f\u7387", "\u8f93\u51fa1db\u538b\u7f29\u529f\u7387", "P1dB", "P-1"] },
    { key: "\u76f4\u6d41\u4f9b\u7535", aliases: ["\u76f4\u6d41\u4f9b\u7535", "\u4f9b\u7535", "\u7535\u6e90"] },
    { key: "\u82af\u7247\u5c3a\u5bf8", aliases: ["\u82af\u7247\u5c3a\u5bf8", "\u5c3a\u5bf8"] }
  ];

  var LNA_DC_ROWS = [
    { key: "\u6f0f\u6781\u5de5\u4f5c\u7535\u538b", aliases: ["\u6f0f\u6781\u5de5\u4f5c\u7535\u538b", "\u6f0f\u6781\u7535\u538b", "\u6f0f\u6e90\u5de5\u4f5c\u7535\u538b", "\u5de5\u4f5c\u7535\u538b", "Vd"], symbol: "Vd", unit: "V" },
    { key: "\u9759\u6001\u6f0f\u6781\u7535\u6d41", aliases: ["\u9759\u6001\u6f0f\u6781\u7535\u6d41", "\u6f0f\u6781\u7535\u6d41", "\u6f0f\u7535\u6d41", "\u9759\u6001\u7535\u6d41", "Id"], symbol: "Id", unit: "mA" }
  ];

  var LNA_MICROWAVE_ROWS = [
    { key: "\u9891\u7387\u8303\u56f4", aliases: ["\u9891\u7387\u8303\u56f4", "\u5de5\u4f5c\u9891\u7387\u8303\u56f4"], symbol: "f", unit: "GHz" },
    { key: "\u589e\u76ca", aliases: ["\u589e\u76ca", "\u7ebf\u6027\u589e\u76ca"], symbol: "Gain", unit: "dB" },
    { key: "\u589e\u76ca\u5e73\u5766\u5ea6", aliases: ["\u589e\u76ca\u5e73\u5766\u5ea6", "\u589e\u76ca\u6ce2\u52a8", "Gain Flatness"], symbol: "Gain", unit: "dB" },
    { key: "\u566a\u58f0\u7cfb\u6570", aliases: ["\u566a\u58f0\u7cfb\u6570", "\u5e26\u5185\u566a\u58f0\u7cfb\u6570", "\u5185\u5e26\u566a\u58f0\u7cfb\u6570", "NF", "Nf"], symbol: "NF", unit: "dB" },
    { key: "\u8f93\u51fa1dB\u538b\u7f29\u529f\u7387", aliases: ["\u8f93\u51fa1dB\u538b\u7f29\u529f\u7387", "\u8f93\u51fa1db\u538b\u7f29\u529f\u7387", "P1dB", "P-1"], symbol: "P1dB", unit: "dBm" },
    { key: "\u8f93\u5165\u9a7b\u6ce2", aliases: ["\u8f93\u5165\u9a7b\u6ce2", "VSWR(in)", "VSWRin"], symbol: "VSWR(in)", unit: "-" },
    { key: "\u8f93\u51fa\u9a7b\u6ce2", aliases: ["\u8f93\u51fa\u9a7b\u6ce2", "VSWR(out)", "VSWRout"], symbol: "VSWR(out)", unit: "-" }
  ];

  var LNA_LIMIT_ROWS = [
    { key: "\u6700\u5927\u6f0f\u6e90\u7535\u538b", aliases: ["\u6700\u5927\u6f0f\u6e90\u7535\u538b", "\u6700\u5927\u6f0f\u504f\u538b", "\u6700\u5927\u6f0f\u6781\u7535\u538b", "\u6700\u5927\u5de5\u4f5c\u7535\u538b"], symbol: "Vd", unit: "V" },
    { key: "\u6700\u9ad8\u8f93\u5165\u529f\u7387\uff08CW\uff09", aliases: ["\u6700\u9ad8\u8f93\u5165\u529f\u7387\uff08CW\uff09", "\u6700\u9ad8\u8f93\u5165\u529f\u7387", "\u6700\u5927\u8f93\u5165\u529f\u7387", "Pp"], symbol: "Pp", unit: "dBm" },
    { key: "\u50a8\u5b58\u6e29\u5ea6", aliases: ["\u50a8\u5b58\u6e29\u5ea6", "\u5b58\u50a8\u6e29\u5ea6"], symbol: "TSTG", unit: "\u2103", rangeUnitEachSide: true },
    { key: "\u4f7f\u7528\u6e29\u5ea6", aliases: ["\u4f7f\u7528\u6e29\u5ea6", "\u5de5\u4f5c\u6e29\u5ea6"], symbol: "Top", unit: "\u2103", rangeUnitEachSide: true },
    { key: "\u6700\u9ad8\u5de5\u4f5c\u6c9f\u9053\u6e29\u5ea6", aliases: ["\u6700\u9ad8\u5de5\u4f5c\u6c9f\u9053\u6e29\u5ea6", "\u5de5\u4f5c\u6c9f\u9053\u6e29\u5ea6", "\u6c9f\u9053\u6e29\u5ea6"], symbol: "Tch", unit: "\u2103" }
  ];

  function normalizeKey(value) {
    return String(value == null ? "" : value)
      .replace(/\u00a0/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[\s:：()（）\[\]【】\-_/\\]+/g, "");
  }

  function clean(value) {
    return String(value == null ? "" : value).replace(/\u00a0/g, " ").trim();
  }

  function cleanSpec(value) {
    return clean(value).replace(/[：:]+$/g, "").trim();
  }

  function isBlank(value) {
    return cleanSpec(value) === "";
  }

  function findColumnIndex(header, aliases) {
    var wanted = (aliases || []).map(normalizeKey);
    var found = -1;
    (header || []).some(function (cell, index) {
      if (wanted.indexOf(normalizeKey(cell)) === -1) return false;
      found = index;
      return true;
    });
    return found;
  }

  function headerLooksLikeLnaSpec(row) {
    return findColumnIndex(row, ["\u6307\u6807", "\u53c2\u6570"]) !== -1 &&
      findColumnIndex(row, ["\u5178\u578b\u503c", "\u5178\u578b"]) !== -1;
  }

  function symbolIsDcVoltage(symbol) {
    return /^vd\d*$/i.test(normalizeKey(symbol || ""));
  }

  function symbolIsDcCurrent(symbol) {
    return /^id\d*$/i.test(normalizeKey(symbol || ""));
  }

  function parseManualRows(rows) {
    var cleanRows = (rows || []).map(function (row) {
      return (row || []).map(clean);
    });
    var headerIndex = -1;
    var header = [];
    var columns;
    var lastName = "";
    var data = {
      fixedFormat: false,
      params: {},
      records: []
    };

    cleanRows.some(function (row, index) {
      if (!headerLooksLikeLnaSpec(row)) return false;
      headerIndex = index;
      header = row;
      return true;
    });
    if (headerIndex === -1) return data;

    columns = {
      name: findColumnIndex(header, ["\u6307\u6807", "\u53c2\u6570"]),
      typical: findColumnIndex(header, ["\u5178\u578b\u503c", "\u5178\u578b"]),
      min: findColumnIndex(header, ["\u6700\u5c0f\u503c", "\u6700\u5c0f"]),
      max: findColumnIndex(header, ["\u6700\u5927\u503c", "\u6700\u5927"]),
      unit: findColumnIndex(header, ["\u5355\u4f4d"]),
      symbol: findColumnIndex(header, ["\u7b26\u53f7"]),
      module: findColumnIndex(header, ["\u663e\u793a\u6a21\u5757", "\u6a21\u5757"]),
      remark: findColumnIndex(header, ["\u5907\u6ce8"]),
      group: findColumnIndex(header, ["\u5206\u7ec4", "\u6761\u4ef6", "\u6d4b\u8bd5\u6761\u4ef6", "\u5de5\u4f5c\u6761\u4ef6"])
    };

    cleanRows.slice(headerIndex + 1).forEach(function (row) {
      var name = columns.name >= 0 ? cleanSpec(row[columns.name]) : "";
      var symbol = columns.symbol >= 0 ? cleanSpec(row[columns.symbol]) : "";
      var record;
      var key;
      if (!name && lastName && (symbolIsDcVoltage(symbol) || symbolIsDcCurrent(symbol))) name = lastName;
      if (!name) return;
      lastName = name;
      record = {
        name: name,
        typical: columns.typical >= 0 ? cleanSpec(row[columns.typical]) : "",
        min: columns.min >= 0 ? cleanSpec(row[columns.min]) : "",
        max: columns.max >= 0 ? cleanSpec(row[columns.max]) : "",
        unit: columns.unit >= 0 ? cleanSpec(row[columns.unit]) : "",
        symbol: symbol,
        module: columns.module >= 0 ? cleanSpec(row[columns.module]) : "",
        remark: columns.remark >= 0 ? cleanSpec(row[columns.remark]) : "",
        group: columns.group >= 0 ? cleanSpec(row[columns.group]) : ""
      };
      data.records.push(record);
      key = normalizeKey(name);
      if (!data.params[key]) data.params[key] = record;
    });

    data.fixedFormat = data.records.length > 0;
    return data;
  }

  function recordBelongsToModule(record, moduleName) {
    var moduleText = cleanSpec(record && record.module);
    if (!moduleName || !moduleText) return true;
    return normalizeKey(moduleText).indexOf(normalizeKey(moduleName)) !== -1;
  }

  function recordsByAliases(manualData, aliases, moduleName) {
    var normalizedAliases = (aliases || []).map(normalizeKey).filter(Boolean);
    var records = manualData && manualData.records ? manualData.records : [];
    return records.filter(function (record) {
      var name = normalizeKey(record && record.name);
      if (!recordBelongsToModule(record, moduleName)) return false;
      return normalizedAliases.some(function (alias) {
        return name === alias || (alias === "vd" && /^vd\d*$/.test(name)) || (alias === "id" && /^id\d*$/.test(name));
      });
    });
  }

  function paramByAliases(manualData, aliases) {
    var params = manualData && manualData.params ? manualData.params : {};
    var found = null;
    (aliases || []).some(function (alias) {
      var key = normalizeKey(alias);
      if (!params[key]) return false;
      found = params[key];
      return true;
    });
    return found;
  }

  function recordsByConfig(manualData, config, moduleName) {
    return recordsByAliases(manualData, [config.key].concat(config.aliases || []), moduleName);
  }

  function normalizeRangeText(value) {
    var text = String(value || "").trim();
    var simpleRange = /^([+]?\d+(?:\.\d+)?)\s*[-~]\s*([+]?\d+(?:\.\d+)?)$/.exec(text);
    if (simpleRange) return simpleRange[1] + "~" + simpleRange[2];
    return text.replace(/\s*[~]\s*/g, "~");
  }

  function normalizeUnitText(unit, fallback) {
    var cleaned = cleanSpec(unit);
    if (!cleaned && fallback) cleaned = fallback;
    if (!cleaned) return "";
    return cleaned.replace(/\*/g, "\u00d7");
  }

  function valueAlreadyHasUnit(value, unit) {
    if (!value || !unit || unit === "-") return false;
    return normalizeKey(value).indexOf(normalizeKey(unit)) !== -1;
  }

  function formatRangeWithUnit(value, unit) {
    var text = normalizeRangeText(cleanSpec(value));
    var normalizedUnit = normalizeUnitText(unit);
    var parts;
    if (!text) return "-";
    if (!normalizedUnit || normalizedUnit === "-" || valueAlreadyHasUnit(text, normalizedUnit)) return text;
    parts = text.split("~");
    if (parts.length === 2) return parts[0] + normalizedUnit + "~" + parts[1] + normalizedUnit;
    return text + normalizedUnit;
  }

  function formatValueWithUnit(record, valueKey, fallbackUnit, options) {
    var value = record ? record[valueKey || "typical"] : "";
    var unit = normalizeUnitText(record && record.unit, fallbackUnit);
    var text = normalizeRangeText(cleanSpec(value));
    if (!text) return "-";
    if (!unit || unit === "-" || valueAlreadyHasUnit(text, unit)) return text;
    if (options && options.rangeUnitEachSide) return formatRangeWithUnit(text, unit);
    return text + unit;
  }

  function formatLimitValue(record, fallbackUnit, options) {
    if (!record) return "-";
    if (!isBlank(record.typical)) return formatValueWithUnit(record, "typical", fallbackUnit, options);
    if (!isBlank(record.max)) return formatValueWithUnit(record, "max", fallbackUnit, options);
    if (!isBlank(record.min)) return formatValueWithUnit(record, "min", fallbackUnit, options);
    return "-";
  }

  function formatDimensionValue(record) {
    var value = record ? cleanSpec(record.typical) : "";
    var unit = normalizeUnitText(record && record.unit, "mm");
    var partUnit = unit.split(/[\u00d7xX]/)[0] || unit;
    var parts;
    if (!value) return "-";
    value = value.replace(/\*/g, "\u00d7").replace(/[xX]/g, "\u00d7");
    if (!partUnit || partUnit === "-" || valueAlreadyHasUnit(value, partUnit)) return value;
    parts = value.split("\u00d7");
    if (parts.length > 1) {
      return parts.map(function (part) {
        return part + partUnit;
      }).join("\u00d7");
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
      if (!isBlank(record[preferredKey])) {
        result = formatValueWithUnit(record, preferredKey, fallbackUnit, options);
        return true;
      }
      if (!isBlank(record[fallbackValueKey])) {
        result = formatValueWithUnit(record, fallbackValueKey, fallbackUnit, options);
        return true;
      }
      return false;
    });
    return result !== "-" ? result : (fallbackRecord ? formatValueWithUnit(fallbackRecord, fallbackValueKey, fallbackUnit, options) : "-");
  }

  function bestPlainRecordValue(manualData, aliases) {
    var record = paramByAliases(manualData, aliases);
    return cleanSpec(record && record.typical);
  }

  function headerTextContains(text, fragment) {
    var source = normalizeKey(text);
    var target = normalizeKey(fragment);
    return !!target && source.indexOf(target) !== -1;
  }

  function buildHeaderModelText(manualData) {
    var override = bestPlainRecordValue(manualData, ["\u8868\u5934\u6807\u9898", "\u624b\u518c\u6807\u9898", "\u9875\u7709\u6807\u9898", "\u624b\u518c\u578b\u53f7"]);
    var model = bestPlainRecordValue(manualData, ["\u578b\u53f7", "\u4ea7\u54c1\u578b\u53f7"]);
    var mirrorModel = bestPlainRecordValue(manualData, ["\u955c\u50cf\u578b\u53f7", "\u955c\u50cf\u4ea7\u54c1\u578b\u53f7"]);
    if (override) return override;
    if (model && mirrorModel && !headerTextContains(model, mirrorModel)) return model + "/" + mirrorModel;
    return model || mirrorModel;
  }

  function buildHeaderSubtitleText(manualData) {
    var override = bestPlainRecordValue(manualData, ["\u526f\u6807\u9898", "\u8868\u5934\u526f\u6807\u9898", "\u9875\u7709\u526f\u6807\u9898"]);
    var processType = bestPlainRecordValue(manualData, ["\u5de5\u827a\u7c7b\u578b", "\u5de5\u827a"]);
    var frequency = bestRecordValueWithUnit(manualData, ["\u9891\u7387\u8303\u56f4", "\u5de5\u4f5c\u9891\u7387\u8303\u56f4"], "typical", "typical", "GHz", { rangeUnitEachSide: true });
    var base;
    if (override) return override;
    if (!processType && (!frequency || frequency === "-")) return "";
    base = processType ? (processType + " \u4f4e\u566a\u58f0\u653e\u5927\u5668\u82af\u7247") : "\u4f4e\u566a\u58f0\u653e\u5927\u5668\u82af\u7247";
    return frequency && frequency !== "-" ? (base + ", " + frequency) : base;
  }

  function buildHeaderValues(manualData) {
    return {
      ".model": buildHeaderModelText(manualData),
      ".subtitle": buildHeaderSubtitleText(manualData),
      ".version": bestPlainRecordValue(manualData, ["\u7248\u672c", "\u7248\u672c\u53f7", "\u6587\u6863\u7248\u672c", "\u624b\u518c\u7248\u672c"]),
      ".institute": bestPlainRecordValue(manualData, ["\u5355\u4f4d\u540d\u79f0", "\u62ac\u5934\u5355\u4f4d", "\u9662\u6240", "\u673a\u6784\u540d\u79f0"])
    };
  }

  function applyHeaderValues(doc, manualData) {
    var updated = 0;
    var values = buildHeaderValues(manualData);
    Object.keys(values).forEach(function (selector) {
      var value = cleanSpec(values[selector]);
      if (!value) return;
      Array.from(doc.querySelectorAll(selector)).forEach(function (node) {
        setEditableText(node, value);
        updated += 1;
      });
    });
    return updated;
  }

  function dcVoltageRecords(manualData) {
    return recordsByConfig(manualData, LNA_DC_ROWS[0], TITLE_DC);
  }

  function dcCurrentRecords(manualData) {
    return recordsByConfig(manualData, LNA_DC_ROWS[1], TITLE_DC);
  }

  function sortedVoltageRecords(records) {
    return (records || []).slice().sort(function (left, right) {
      var leftNumber = parseFloat(String(left && left.typical || "").replace(/[^\d.+-]/g, ""));
      var rightNumber = parseFloat(String(right && right.typical || "").replace(/[^\d.+-]/g, ""));
      if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return 0;
      return leftNumber - rightNumber;
    });
  }

  function formatDirectDcSupply(record) {
    var text = cleanSpec(record && record.typical);
    if (!text) return "-";
    if (/[\\/@]/.test(text)) return text;
    return formatValueWithUnit(record, "typical", record.unit || "V");
  }

  function firstFormattedRecordValue(records, fallbackUnit) {
    var result = "-";
    (records || []).some(function (record) {
      result = formatValueWithUnit(record, "typical", fallbackUnit);
      return result !== "-";
    });
    return result;
  }

  function uniqueTexts(values) {
    var seen = {};
    var result = [];
    (values || []).forEach(function (value) {
      var text = cleanSpec(value);
      var key;
      if (!text || text === "-") return;
      key = normalizeKey(text);
      if (seen[key]) return;
      seen[key] = true;
      result.push(text);
    });
    return result;
  }

  function formatVoltageChoice(record) {
    var symbol = cleanSpec(record && record.symbol);
    var value = formatValueWithUnit(record, "typical", "V");
    if (value === "-") return symbol || "-";
    return symbol ? symbol + "=" + value : value;
  }

  function voltageChoiceRemark(records, index, record) {
    var remark = cleanSpec(record && record.remark);
    var symbols;
    if (remark) return remark;
    if (!records || records.length <= 1 || index !== 0) return "";
    symbols = uniqueTexts(records.map(function (item) { return item.symbol; })).join("\u3001");
    return (symbols || "\u5404\u8def\u7535\u538b") + " \u53ea\u5141\u8bb8\u9009\u62e9\u4e00\u4e2a\u8fdb\u884c\u52a0\u7535";
  }

  function composeDcSupplyValue(manualData) {
    var direct = paramByAliases(manualData, ["\u76f4\u6d41\u4f9b\u7535", "\u4f9b\u7535", "\u7535\u6e90"]);
    var voltages = sortedVoltageRecords(dcVoltageRecords(manualData));
    var currentText = firstFormattedRecordValue(dcCurrentRecords(manualData), "mA");
    var voltageTexts;
    if (direct && !isBlank(direct.typical)) return formatDirectDcSupply(direct);
    voltageTexts = voltages.map(function (record) {
      return formatValueWithUnit(record, "typical", "V");
    }).filter(function (text) {
      return text !== "-";
    });
    if (voltageTexts.length && currentText !== "-") return voltageTexts.join("/") + " @" + currentText;
    if (voltageTexts.length) return voltageTexts.join("/");
    return currentText;
  }

  function composeIntroDcVoltage(manualData) {
    var direct = paramByAliases(manualData, ["\u76f4\u6d41\u4f9b\u7535", "\u4f9b\u7535", "\u7535\u6e90"]);
    var voltages = dcVoltageRecords(manualData);
    var voltageText;
    if (voltages.length > 1) {
      return "\u53ef\u9009\u62e9" + voltages.map(formatVoltageChoice).filter(function (text) {
        return text !== "-";
      }).join(" \u6216 ");
    }
    if (direct && !isBlank(direct.typical)) return "\u4e3a " + formatDirectDcSupply(direct);
    voltageText = firstFormattedRecordValue(voltages, "V");
    if (voltageText !== "-") return "\u4e3a " + voltageText;
    voltageText = bestRecordValueWithUnit(manualData, ["\u6f0f\u6781\u5de5\u4f5c\u7535\u538b", "\u6f0f\u6781\u7535\u538b", "\u5de5\u4f5c\u7535\u538b", "Vd"], "typical", "typical", "V");
    return voltageText !== "-" ? "\u4e3a " + voltageText : "";
  }

  function dcConditionText(manualData) {
    var voltages = dcVoltageRecords(manualData);
    var choices = voltages.map(formatVoltageChoice).filter(function (text) {
      return text !== "-";
    });
    if (!choices.length) return "";
    return choices.length > 1 ? choices.join(" \u6216 ") : choices[0];
  }

  function sectionByTitle(doc, titleText) {
    return Array.from(doc.querySelectorAll(".section, .half-panel")).find(function (section) {
      var title = section.querySelector(":scope > .section-title");
      return title && title.textContent.indexOf(titleText) !== -1;
    }) || null;
  }

  function setSectionCondition(section, text) {
    var title = section && section.querySelector(":scope > .section-title");
    var condition = title && title.querySelector(".condition");
    if (!condition || !text) return;
    condition.textContent = "\uff08" + text + "\uff09";
  }

  function setEditableText(node, value) {
    if (!node) return;
    node.textContent = value == null ? "" : String(value);
  }

  function applyFeatureValues(doc, values) {
    var updated = 0;
    Array.from(doc.querySelectorAll("[data-feature-value]")).forEach(function (node) {
      var key = normalizeKey(node.getAttribute("data-feature-value"));
      Object.keys(values).forEach(function (rawKey) {
        if (normalizeKey(rawKey) !== key) return;
        node.textContent = values[rawKey];
        updated += 1;
      });
    });
    return updated;
  }

  function createCell(tagName, value) {
    var cell = document.createElement(tagName);
    cell.setAttribute("contenteditable", "true");
    cell.textContent = value == null ? "" : String(value);
    return cell;
  }

  function replaceManualTable(table, headers, bodyRows) {
    var thead = table.tHead || table.createTHead();
    var tbody = table.tBodies[0] || table.createTBody();
    thead.innerHTML = "";
    tbody.innerHTML = "";
    var headRow = document.createElement("tr");
    (headers || []).forEach(function (value) {
      headRow.appendChild(createCell("th", value));
    });
    thead.appendChild(headRow);
    (bodyRows || []).forEach(function (rowData) {
      var row = document.createElement("tr");
      (rowData || []).forEach(function (value) {
        row.appendChild(createCell("td", value));
      });
      tbody.appendChild(row);
    });
  }

  function blankRowsFromConfigs(configs, includeRemark) {
    return configs.map(function (config) {
      var row = [config.key, "", "", "", "", ""];
      if (includeRemark) row.push("");
      return row;
    });
  }

  function tableRowsFromConfigs(manualData, configs, includeRemark, expandMultipleRecords, moduleName) {
    var rows = [];
    configs.forEach(function (config) {
      var records = expandMultipleRecords ? recordsByConfig(manualData, config, moduleName) : [];
      if (!records.length) records = [paramByAliases(manualData, [config.key].concat(config.aliases || [])) || {}];
      records.forEach(function (record, index) {
        var displayName = record.name || config.key;
        var row = [
          index === 0 ? displayName : "",
          cleanSpec(record.symbol || config.symbol) || "-",
          isBlank(record.min) ? "-" : normalizeRangeText(record.min),
          isBlank(record.typical) ? "-" : normalizeRangeText(record.typical),
          isBlank(record.max) ? "-" : normalizeRangeText(record.max),
          cleanSpec(record.unit || config.unit) || "-"
        ];
        if (includeRemark) row.push(voltageChoiceRemark(records, index, record) || "-");
        rows.push(row);
      });
    });
    return rows;
  }

  function limitRowsFromManualData(manualData) {
    var rows = [];
    LNA_LIMIT_ROWS.forEach(function (config) {
      var records = recordsByConfig(manualData, config, TITLE_LIMIT);
      if (!records.length) records = [paramByAliases(manualData, [config.key].concat(config.aliases || [])) || {}];
      records.forEach(function (record, index) {
        var displayName = record.name || config.key;
        rows.push([
          index === 0 ? displayName : "",
          cleanSpec(record.symbol || config.symbol) || "-",
          formatLimitValue(record, record.unit || config.unit, { rangeUnitEachSide: config.rangeUnitEachSide })
        ]);
      });
    });
    return rows;
  }

  function replaceTableFromRows(table, headers, bodyRows) {
    var dataColumnIndexes = (headers || []).map(function (header, index) {
      return /\u6700\u5c0f\u503c|\u5178\u578b\u503c|\u6700\u5927\u503c|\u6781\u9650\u503c|\u5907\u6ce8/.test(cleanSpec(header)) ? index : -1;
    }).filter(function (index) {
      return index >= 0;
    });
    var rows = (bodyRows || []).filter(function (row) {
      return dataColumnIndexes.some(function (index) {
        var text = cleanSpec(row[index]);
        return text && text !== "-";
      });
    });
    replaceManualTable(table, headers, rows.length ? rows : bodyRows);
  }

  function buildFeatureData(manualData) {
    var frequency = paramByAliases(manualData, FEATURE_FIELDS[0].aliases);
    var gain = paramByAliases(manualData, FEATURE_FIELDS[1].aliases);
    var nf = paramByAliases(manualData, FEATURE_FIELDS[2].aliases);
    var p1db = paramByAliases(manualData, FEATURE_FIELDS[3].aliases);
    var size = paramByAliases(manualData, FEATURE_FIELDS[5].aliases);
    return {
      "\u9891\u7387\u8303\u56f4": formatValueWithUnit(frequency, "typical", "GHz", { rangeUnitEachSide: true }),
      "\u589e\u76ca": formatValueWithUnit(gain, "typical", "dB"),
      "\u566a\u58f0\u7cfb\u6570": formatValueWithUnit(nf, "typical", "dB"),
      "\u8f93\u51fa1dB\u538b\u7f29\u529f\u7387": formatValueWithUnit(p1db, "typical", "dBm"),
      "\u76f4\u6d41\u4f9b\u7535": composeDcSupplyValue(manualData),
      "\u82af\u7247\u5c3a\u5bf8": formatDimensionValue(size)
    };
  }

  function buildIntroText(manualData) {
    var model = bestRecordValueWithUnit(manualData, ["\u578b\u53f7", "\u4ea7\u54c1\u578b\u53f7"], "typical", "typical", "");
    var mirrorModel = bestRecordValueWithUnit(manualData, ["\u955c\u50cf\u578b\u53f7", "\u955c\u50cf\u4ea7\u54c1\u578b\u53f7"], "typical", "typical", "");
    var processType = bestRecordValueWithUnit(manualData, ["\u5de5\u827a\u7c7b\u578b", "\u5de5\u827a"], "typical", "typical", "");
    var frequency = bestRecordValueWithUnit(manualData, ["\u9891\u7387\u8303\u56f4", "\u5de5\u4f5c\u9891\u7387\u8303\u56f4"], "typical", "typical", "GHz", { rangeUnitEachSide: true });
    var gain = bestRecordValueWithUnit(manualData, ["\u7ebf\u6027\u589e\u76ca", "\u589e\u76ca"], "min", "typical", "dB");
    var noise = bestRecordValueWithUnit(manualData, ["\u5e26\u5185\u566a\u58f0\u7cfb\u6570", "\u5185\u5e26\u566a\u58f0\u7cfb\u6570", "\u566a\u58f0\u7cfb\u6570"], "max", "typical", "dB");
    var dcVoltage = composeIntroDcVoltage(manualData);
    var processPhrase = processType && processType.indexOf("\u5de5\u827a") === -1 ? ("\u91c7\u7528" + processType + "\u5de5\u827a\u5236\u4f5c") : ("\u91c7\u7528" + processType + "\u5236\u4f5c");
    return model + " \u662f\u4e00\u6b3e\u4f4e\u566a\u58f0\u653e\u5927\u5668\u82af\u7247\uff0c" + mirrorModel + " \u662f\u955c\u50cf\u7248\u672c\uff0c" + processPhrase + "\u3002\u5de5\u4f5c\u9891\u7387\u8303\u56f4\u8986\u76d6" + frequency + "\uff0c\u7ebf\u6027\u589e\u76ca\u5927\u4e8e" + gain + "\uff0c\u5e26\u5185\u566a\u58f0\u7cfb\u6570\u5c0f\u4e8e" + noise + "\u3002\u82af\u7247\u901a\u8fc7\u80cc\u9762\u901a\u5b54\u63a5\u5730\uff0c\u5355\u7535\u6e90\u5de5\u4f5c" + (dcVoltage ? ("\uff0c\u5178\u578b\u5de5\u4f5c\u7535\u538b" + dcVoltage) : "") + "\u3002\u8be5\u82af\u7247\u4e3b\u8981\u5e94\u7528\u4e8e\u5fae\u6ce2\u7cfb\u7edf\u4e2d\uff0c\u5b9e\u73b0\u4fe1\u53f7\u7684\u653e\u5927\u529f\u80fd\u3002";
  }

  function applyEnhancedManualData(context, manualData) {
    var doc = context.document || document;
    var featureSection = sectionByTitle(doc, TITLE_FEATURE);
    var introSection = sectionByTitle(doc, TITLE_INTRO);
    var dcSection = sectionByTitle(doc, TITLE_DC);
    var microwaveSection = sectionByTitle(doc, TITLE_MICROWAVE);
    var limitSection = sectionByTitle(doc, TITLE_LIMIT);
    var dcTable = dcSection && dcSection.querySelector("[data-editable-table]");
    var microwaveTable = microwaveSection && microwaveSection.querySelector("[data-editable-table]");
    var limitTable = limitSection && limitSection.querySelector("[data-editable-table]");
    var updated = 0;
    var condition = dcConditionText(manualData);

    updated += applyHeaderValues(doc, manualData);
    if (featureSection) updated += applyFeatureValues(doc, buildFeatureData(manualData));
    if (introSection) {
      setEditableText(introSection.querySelector(".intro-text"), buildIntroText(manualData));
      updated += 1;
    }
    if (microwaveSection && condition) setSectionCondition(microwaveSection, "TA = +25\u2103\uff0c" + condition);
    if (dcTable) {
      replaceTableFromRows(dcTable, ["\u6307\u6807", "\u7b26\u53f7", "\u6700\u5c0f\u503c", "\u5178\u578b\u503c", "\u6700\u5927\u503c", "\u5355\u4f4d", "\u5907\u6ce8"], tableRowsFromConfigs(manualData, LNA_DC_ROWS, true, true, TITLE_DC));
      updated += 1;
    }
    if (microwaveTable) {
      replaceTableFromRows(microwaveTable, ["\u6307\u6807", "\u7b26\u53f7", "\u6700\u5c0f\u503c", "\u5178\u578b\u503c", "\u6700\u5927\u503c", "\u5355\u4f4d"], tableRowsFromConfigs(manualData, LNA_MICROWAVE_ROWS, false, false, TITLE_MICROWAVE));
      updated += 1;
    }
    if (limitTable) {
      replaceTableFromRows(limitTable, ["\u53c2\u6570", "\u7b26\u53f7", "\u6781\u9650\u503c"], limitRowsFromManualData(manualData));
      updated += 1;
    }

    if (updated) {
      context.schedulePagination(120, { afterPaint: true });
      context.saveActivePage();
    }
    return updated;
  }

  function setStatus(message, isError) {
    var status = document.querySelector("[data-feature-import-status]");
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? "#9d1f1a" : "";
  }

  function patchFeatureHint() {
    var status = document.querySelector("[data-feature-import-status]");
    if (status) status.textContent = FEATURE_HINT;
  }

  function install(context) {
    if (!context || context.__multiVoltageFeatureImportInstalled) return;
    context.__multiVoltageFeatureImportInstalled = true;
    patchFeatureHint();
    var originalImportFeatureFile = context.importFeatureFile;
    context.importFeatureFile = function (file) {
      if (!file) return;
      setStatus("\u6b63\u5728\u8bfb\u53d6\uff1a" + file.name, false);
      context.readFeatureRows(file).then(function (rows) {
        var manualData = parseManualRows(rows);
        var updated;
        var matched;
        if (!manualData.fixedFormat) {
          originalImportFeatureFile(file);
          return;
        }
        updated = applyEnhancedManualData(context, manualData);
        matched = manualData.records.length;
        if (!updated) {
          setStatus("\u5f53\u524d\u9875\u9762\u6ca1\u6709\u53ef\u586b\u5199\u7684\u4f4e\u566a\u653e\u53c2\u6570\u533a\u57df\u3002", true);
          return;
        }
        setStatus("\u5df2\u8bc6\u522b " + matched + " \u884c\u89c4\u683c\u6570\u636e\uff0c\u5df2\u6309\u591a\u5de5\u4f5c\u7535\u538b\u89c4\u5219\u586b\u5145\u9875\u9762\u3002", false);
      }).catch(function (error) {
        setStatus(error && error.message ? error.message : "\u5bfc\u5165\u5931\u8d25", true);
      });
    };
  }

  function boot() {
    var context = window.ProductManualTemplateToolContext;
    if (!context) {
      window.setTimeout(boot, 100);
      return;
    }
    install(context);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}());
