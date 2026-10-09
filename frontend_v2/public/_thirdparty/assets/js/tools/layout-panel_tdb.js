(function () {
  "use strict";

  var registry = window.ProductManualTemplateTools = window.ProductManualTemplateTools || {};
  var latestLayoutResult = null;
  var selectedTdbFile = null;

  function setLayoutStatus(doc, message, isError) {
    var status = doc.querySelector("[data-layout-status]");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", !!isError);
  }

  function updateSelectedFileName(doc) {
    var input = doc.querySelector("[data-tdb-file-name]");
    if (!input) return;
    input.value = selectedTdbFile ? (selectedTdbFile.name || "") : "";
  }

  function rowsFromPadTableCsv(csvText) {
    var text = String(csvText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var rows = [];
    var cells = [];
    var current = "";
    var inQuotes = false;

    function finishCell() {
      cells.push(current);
      current = "";
    }

    function finishRow() {
      if (cells.length && cells.some(function (value) { return String(value).trim() !== ""; })) {
        rows.push(cells);
      }
      cells = [];
    }

    for (var i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (ch === "\"") {
        if (inQuotes && text.charAt(i + 1) === "\"") {
          current += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        finishCell();
      } else if (ch === "\n" && !inQuotes) {
        finishCell();
        finishRow();
      } else {
        current += ch;
      }
    }
    if (current !== "" || cells.length) {
      finishCell();
      finishRow();
    }
    return rows;
  }

  function findSectionImageZoneByTitle(doc, titleText) {
    var panels = Array.from(doc.querySelectorAll(".half-panel, .section"));
    var target = panels.find(function (panel) {
      var title = panel.querySelector(".section-title");
      return title && title.textContent.indexOf(titleText) !== -1;
    });
    return target ? target.querySelector("[data-image-zone]") : null;
  }

  function findFunctionBlockZone(doc) {
    return findSectionImageZoneByTitle(doc, "功能框图");
  }

  function findDimensionZone(doc) {
    return doc.querySelector(".dimension-images[data-image-zone]");
  }

  function findAssemblyZone(doc) {
    return doc.querySelector(".assembly-image[data-image-zone]");
  }

  function findPadDefinitionTable(doc) {
    var tables = Array.from(doc.querySelectorAll("[data-editable-table]"));
    return tables.find(function (table) {
      var block = table.closest("[data-table-block]");
      var title = block ? block.querySelector(".section-title") : null;
      return title && title.textContent.indexOf("压点") !== -1;
    }) || null;
  }

  function applyLayoutAssets(context, payload) {
    if (!payload) throw new Error("No layout payload available.");
    latestLayoutResult = payload;

    var doc = context.document;
    var functionBlockZone = findFunctionBlockZone(doc);
    var dimensionZone = findDimensionZone(doc);
    var assemblyZone = findAssemblyZone(doc);
    var padTable = findPadDefinitionTable(doc);

    if (!functionBlockZone || !dimensionZone || !assemblyZone || !padTable) {
      throw new Error("Missing function-block, dimension, assembly, or pad-table zone in the page.");
    }

    if (payload.function_block_scene && window.ProductManualTemplateTools && window.ProductManualTemplateTools.applyLayoutScene) {
      window.ProductManualTemplateTools.applyLayoutScene(context, "function_block", payload.function_block_scene);
    } else if (payload.function_block_image_data_url) {
      context.replaceImageZoneImages(functionBlockZone, [payload.function_block_image_data_url]);
    }

    if (payload.dimension_scene && window.ProductManualTemplateTools && window.ProductManualTemplateTools.applyLayoutScene) {
      window.ProductManualTemplateTools.applyLayoutScene(context, "dimension", payload.dimension_scene);
    } else if (payload.dimension_image_data_url) {
      context.replaceImageZoneImages(dimensionZone, [payload.dimension_image_data_url]);
    }

    if (payload.assembly_scene && window.ProductManualTemplateTools && window.ProductManualTemplateTools.applyLayoutScene) {
      window.ProductManualTemplateTools.applyLayoutScene(context, "assembly", payload.assembly_scene);
    } else if (payload.assembly_image_data_url) {
      context.replaceImageZoneImages(assemblyZone, [payload.assembly_image_data_url]);
    }

    context.replaceTableWithRows(padTable, rowsFromPadTableCsv(payload.pad_table_csv_text));
    if (window.ProductManualTemplateTools && window.ProductManualTemplateTools.bindOverlayImageEditor) {
      window.ProductManualTemplateTools.bindOverlayImageEditor(context);
    }
    context.schedulePagination(120, { afterPaint: true });
    context.saveActivePage();
  }

  function buildFormData(doc) {
    if (!selectedTdbFile) throw new Error("请先选择 .tdb 文件。");
    var formData = new FormData();
    formData.append("tdb_file", selectedTdbFile, selectedTdbFile.name || "layout.tdb");
    return formData;
  }

  function generateLayoutAssets(context) {
    var doc = context.document;
    var request;
    try {
      request = buildFormData(doc);
    } catch (error) {
      setLayoutStatus(doc, error && error.message ? error.message : "请选择 .tdb 文件。", true);
      return;
    }
    setLayoutStatus(doc, "正在生成功能框图、尺寸图、装配图和压点信息表…", false);
    window.ProductManualApi.generateLayoutAssets(request).then(function (payload) {
      applyLayoutAssets(context, payload);
      setLayoutStatus(doc, "功能框图、尺寸图、装配图和压点信息表已生成并回填。", false);
    }).catch(function (error) {
      setLayoutStatus(doc, error && error.message ? error.message : "Layout asset generation failed.", true);
    });
  }

  registry.bindLayoutPanel = function bindLayoutPanel(context) {
    var doc = context.document;
    var toggle = doc.getElementById("toggleLayoutPanel");
    var panel = doc.getElementById("layoutPanel");
    if (!toggle || !panel || panel.dataset.toolBound === "true") return;
    panel.dataset.toolBound = "true";

    toggle.classList.toggle("is-active", !panel.classList.contains("is-hidden"));
    toggle.addEventListener("click", function () {
      panel.classList.toggle("is-hidden");
      var isOpen = !panel.classList.contains("is-hidden");
      toggle.classList.toggle("is-active", isOpen);
      if (isOpen) panel.scrollIntoView({ block: "nearest" });
    });

    var fileInput = panel.querySelector("[data-tdb-file-input]");
    var pickButton = panel.querySelector("[data-pick-tdb-file]");
    var generateButton = panel.querySelector("[data-generate-layout-assets]");
    var applyButton = panel.querySelector("[data-apply-layout-results]");

    if (pickButton && fileInput) {
      pickButton.addEventListener("click", function () {
        fileInput.value = "";
        fileInput.click();
      });
      fileInput.addEventListener("change", function () {
        selectedTdbFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        updateSelectedFileName(doc);
        setLayoutStatus(doc, selectedTdbFile ? ("已选择文件：" + selectedTdbFile.name) : "尚未选择 .tdb 文件。", false);
      });
    }

    if (generateButton) {
      generateButton.addEventListener("click", function () {
        generateLayoutAssets(context);
      });
    }

    if (applyButton) {
      applyButton.addEventListener("click", function () {
        try {
          applyLayoutAssets(context, latestLayoutResult);
          setLayoutStatus(doc, "Re-applied the latest generated layout result.", false);
        } catch (error) {
          setLayoutStatus(doc, error && error.message ? error.message : "No generated result available.", true);
        }
      });
    }

    updateSelectedFileName(doc);
  };
}());
